// 던랩 데이터 수집 스크립트
// GitHub Actions가 1시간마다 실행해요. 직접 실행하려면:
//   NEOPLE_API_KEY=발급받은키 node scripts/collect.mjs
// Node.js 18 이상 필요 (fetch 내장)

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = process.env.NEOPLE_API_BASE || 'https://api.neople.co.kr';
const KEY = process.env.NEOPLE_API_KEY;

if (!KEY) {
  console.error('NEOPLE_API_KEY 환경 변수가 없어요. GitHub 저장소 Settings → Secrets and variables → Actions에 등록해 주세요.');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(path, params = {}) {
  const url = new URL(path, API);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v); });
  url.searchParams.set('apikey', KEY);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url);
    if (res.ok) { await sleep(120); return res.json(); }
    const body = await res.text();
    // 429(요청 과다)·5xx는 잠시 쉬고 다시 시도
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(1500 * attempt); continue; }
    throw new Error(`${path} → ${res.status} ${body.slice(0, 200)}`);
  }
}

async function readJSON(rel, fallback) {
  try { return JSON.parse(await readFile(join(ROOT, rel), 'utf8')); } catch { return fallback; }
}
async function writeJSON(rel, data) {
  const file = join(ROOT, rel);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 1) + '\n');
}

// 한국 시간 기준 날짜 (YYYY-MM-DD)
function kstDate(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const now = new Date();
const updatedAt = now.toISOString();
const report = { ok: [], failed: [] };

/* ---------- 서버 목록 ---------- */
async function collectServers() {
  const data = await call('/df/servers');
  await writeJSON('data/servers.json', { updatedAt, rows: data.rows || [] });
  return (data.rows || []).map((r) => r.serverId);
}

/* ---------- 경매장 시세 ---------- */
// 거래 기록 묶음(rows)을 아이템별 시세 한 줄로 정리
function summarize(rows, history, today, yesterday, dayAgo) {
  const recent = rows.filter((r) => new Date(String(r.soldDate).replace(' ', 'T') + '+09:00').getTime() >= dayAgo);
  const base = recent.length ? recent : rows;
  const qty = base.reduce((s, r) => s + (r.count || 1), 0);
  const avg = base.reduce((s, r) => s + r.unitPrice * (r.count || 1), 0) / qty;
  const name = rows[0].itemName;
  const prev = history[yesterday]?.[name];
  history[today][name] = Math.round(avg);
  return {
    itemId: rows[0].itemId,
    itemName: name,
    itemRarity: rows[0].itemRarity,
    itemType: rows[0].itemTypeDetail || rows[0].itemType,
    avgPrice: Math.round(avg),
    minPrice: Math.min(...base.map((r) => r.unitPrice)),
    volume: qty,
    prevAvg: prev ?? null,
    changePct: prev ? ((avg - prev) / prev) * 100 : null
  };
}

async function collectAuction() {
  const config = await readJSON('config/tracked-items.json', { categories: [] });
  const history = await readJSON('data/history/auction-daily.json', {});
  const today = kstDate(now);
  const yesterday = kstDate(new Date(now.getTime() - 24 * 3600 * 1000));
  const dayAgo = now.getTime() - 24 * 3600 * 1000;
  const missing = [];
  history[today] = history[today] || {};

  const categories = [];
  for (const cat of config.categories || []) {
    const picked = new Map();   // itemName → 시세 한 줄
    const limit = cat.top || 6;

    // 1) 이름을 정확히 적은 아이템 (항상 먼저 보여줌)
    for (const name of cat.items || []) {
      try {
        const data = await call('/df/auction-sold', { itemName: name, wordType: 'match', limit: 100 });
        const rows = (data.rows || []).filter((r) => r.unitPrice > 0);
        if (!rows.length) { missing.push(name); continue; }
        picked.set(rows[0].itemName, summarize(rows, history, today, yesterday, dayAgo));
      } catch (e) {
        missing.push(name);
        report.failed.push(`경매장 ${name}: ${e.message}`);
      }
    }

    // 2) 키워드가 들어간 아이템 중 거래량이 많은 것을 자동으로 채움
    const pool = new Map();     // itemName → rows
    for (const word of cat.keywords || []) {
      if (picked.size >= limit) break;
      try {
        const data = await call('/df/auction-sold', { itemName: word, wordType: 'full', limit: 100 });
        for (const r of data.rows || []) {
          if (!(r.unitPrice > 0) || picked.has(r.itemName)) continue;
          if (!pool.has(r.itemName)) pool.set(r.itemName, []);
          pool.get(r.itemName).push(r);
        }
      } catch (e) {
        report.failed.push(`경매장 키워드 ${word}: ${e.message}`);
      }
    }
    const ranked = [...pool.values()]
      .map((rows) => ({ rows, qty: rows.reduce((s, r) => s + (r.count || 1), 0) }))
      .sort((a, b) => b.rows.length - a.rows.length || b.qty - a.qty);
    for (const { rows } of ranked) {
      if (picked.size >= limit) break;
      picked.set(rows[0].itemName, summarize(rows, history, today, yesterday, dayAgo));
    }

    categories.push({ id: cat.id, name: cat.name, items: [...picked.values()] });
  }

  // 화면에는 안 나오지만 연구실(강화 시뮬레이터) 비용 계산에 쓰는 재료 시세
  const reference = [];
  for (const name of config.reference || []) {
    try {
      const data = await call('/df/auction-sold', { itemName: name, wordType: 'match', limit: 100 });
      const rows = (data.rows || []).filter((r) => r.unitPrice > 0);
      if (rows.length) reference.push(summarize(rows, history, today, yesterday, dayAgo));
      else missing.push(name);
    } catch (e) {
      missing.push(name);
    }
  }

  // API가 먹통이라 하나도 못 받았으면, 기존 시세를 빈 값으로 덮어쓰지 않고 그대로 둬요
  if (!categories.some((c) => c.items.length) && !reference.length) throw new Error('시세를 하나도 받지 못해 기존 데이터를 유지해요');

  // 30일치만 보관
  const keep = Object.keys(history).sort().slice(-30);
  const trimmed = Object.fromEntries(keep.map((k) => [k, history[k]]));
  await writeJSON('data/history/auction-daily.json', trimmed);
  await writeJSON('data/auction.json', { updatedAt, categories, reference, missing });
  report.ok.push(`경매장 시세 ${categories.reduce((s, c) => s + c.items.length, 0)}개 (이름 못 찾음: ${missing.length}개)`);
}

/* ---------- 명성 랭킹 ---------- */
function pickChar(r) {
  return {
    serverId: r.serverId, characterId: r.characterId, characterName: r.characterName,
    level: r.level, jobName: r.jobName, jobGrowName: r.jobGrowName, fame: r.fame
  };
}

async function collectFame(serverIds) {
  const all = await call('/df/servers/all/characters-fame', { limit: 200 });
  const byServer = {};
  for (const id of serverIds) {
    try {
      const data = await call(`/df/servers/${id}/characters-fame`, { limit: 50 });
      byServer[id] = (data.rows || []).map(pickChar);
    } catch (e) {
      report.failed.push(`명성 ${id}: ${e.message}`);
    }
  }
  await writeJSON('data/fame.json', { updatedAt, all: (all.rows || []).map(pickChar), byServer });
  report.ok.push(`명성 랭킹 전체 ${(all.rows || []).length}명`);
}

/* ---------- 랭커 트렌드 (하루 1번) ---------- */
// 명성 상위 캐릭터들이 장착한 칭호·크리쳐·오라·무기 아바타를 세어서 많이 쓰는 순서로 저장해요.
async function collectTrends() {
  const prev = await readJSON('data/trends.json', null);
  const age = prev?.updatedAt ? now - new Date(prev.updatedAt) : Infinity;
  if (process.env.FORCE_TRENDS !== '1' && age < 20 * 3600 * 1000) {
    report.ok.push('랭커 트렌드 건너뜀 (하루 1번)');
    return;
  }

  const fame = await readJSON('data/fame.json', null);
  const chars = (fame?.all || []).filter((c) => c.serverId && c.characterId);
  if (!chars.length) throw new Error('명성 데이터가 없어요');

  const counters = { title: new Map(), creature: new Map(), aura: new Map(), weapon: new Map() };
  // 랭커 룩 갤러리: 장착품마다 실제로 쓰는 랭커 목록 (명성 높은 순으로 들어와요)
  const wearers = { title: new Map(), creature: new Map(), aura: new Map(), weapon: new Map() };
  let who = null;
  const add = (key, item) => {
    if (!item || !item.itemName) return;
    const map = counters[key];
    const cur = map.get(item.itemName) || { itemId: item.itemId || '', itemName: item.itemName, itemRarity: item.itemRarity || '', count: 0 };
    cur.count++;
    map.set(item.itemName, cur);
    if (who) {
      const list = wearers[key].get(item.itemName) || [];
      if (list.length < 12) list.push(who);
      wearers[key].set(item.itemName, list);
    }
  };
  const isSlot = (s, id, name) => s.slotId === id || s.slotName === name;
  // 클론 아바타가 있으면 겉으로 보이는 클론 쪽을 셉니다.
  // 단, '레어 무기 클론 아바타' 같은 이름 없는 공용 클론이면 원래 아바타를 셉니다.
  const look = (a) => (a.clone && a.clone.itemName && !/클론 아바타/.test(a.clone.itemName) ? a.clone : a);

  let sample = 0;
  let failed = 0;
  for (const c of chars) {
    const base = `/df/servers/${c.serverId}/characters/${c.characterId}`;
    try {
      const [eq, av, cr] = await Promise.all([
        call(`${base}/equip/equipment`),
        call(`${base}/equip/avatar`),
        call(`${base}/equip/creature`)
      ]);
      sample++;
      who = { serverId: c.serverId, characterId: c.characterId, characterName: c.characterName, jobGrowName: c.jobGrowName || c.jobName, fame: c.fame };
      add('title', (eq.equipment || []).find((e) => isSlot(e, 'TITLE', '칭호')));
      const avatars = av.avatar || [];
      const aura = avatars.find((a) => isSlot(a, 'AURORA', '오라'));
      const weapon = avatars.find((a) => isSlot(a, 'WEAPON', '무기'));
      if (aura) add('aura', look(aura));
      if (weapon) add('weapon', look(weapon));
      add('creature', cr.creature);
    } catch (e) {
      failed++;
    }
  }

  if (!sample) throw new Error('랭커 장착 정보를 하나도 받지 못했어요');

  // 관측 일지: 날짜별 전체 사용 수를 30일 보관하고, 직전 기록과 비교해 변화량을 계산해요
  const KEYS = Object.keys(counters);
  const counts = Object.fromEntries(KEYS.map((k) => [k, Object.fromEntries([...counters[k].values()].map((v) => [v.itemName, v.count]))]));
  const today = kstDate(now);
  const history = await readJSON('data/history/trends-daily.json', {});
  const prevDate = Object.keys(history).filter((d) => d < today).sort().pop() || null;
  const prevCounts = prevDate ? history[prevDate].counts : null;
  history[today] = { sample, counts };
  const keepDays = Object.keys(history).sort().slice(-30);
  await writeJSON('data/history/trends-daily.json', Object.fromEntries(keepDays.map((d) => [d, history[d]])));

  const withChange = (key, item) => {
    if (!prevCounts) return item;
    const before = prevCounts[key]?.[item.itemName];
    return before === undefined ? { ...item, isNew: true } : { ...item, delta: item.count - before };
  };
  const top = (key) => [...counters[key].values()].sort((a, b) => b.count - a.count).slice(0, 10).map((it) => withChange(key, it));

  // 직전 기록보다 사용자가 가장 많이 늘어난 장착품 (분류 상관없이 5개)
  const risers = prevCounts
    ? KEYS.flatMap((k) => [...counters[k].values()].map((it) => ({ category: k, ...withChange(k, it) })))
      .map((it) => ({ ...it, gain: it.isNew ? it.count : it.delta }))
      .filter((it) => it.gain > 0)
      .sort((a, b) => b.gain - a.gain || b.count - a.count)
      .slice(0, 5)
    : [];

  await writeJSON('data/trends.json', {
    updatedAt, sample, prevDate,
    title: top('title'), creature: top('creature'), aura: top('aura'), weapon: top('weapon'),
    risers,
    // 순위(TOP 10)에 든 장착품만 착용 랭커 목록을 남겨요 (랭커 룩 갤러리)
    wearers: Object.fromEntries(KEYS.map((k) => [k, Object.fromEntries(top(k).map((it) => [it.itemName, wearers[k].get(it.itemName) || []]))])),
    counts  // 캐릭터 연구 보고서에서 '랭커 몇 %가 쓰는지' 찾을 때 사용
  });
  report.ok.push(`랭커 트렌드 ${sample}명`);
  if (failed) report.failed.push(`랭커 트렌드 조회 실패 ${failed}명`);
}

/* ---------- 아바타 마켓 (판매 중 매물 + 최근 거래) ---------- */
// API 응답 필드 이름이 문서에 다 나와 있지 않아서, 있을 법한 이름을 여러 개 받아 둬요.
function pickGoods(r) {
  // 이름을 모르는 항목은 'date'·'hash'가 들어간 키를 찾아 써요
  const dateKey = Object.keys(r).find((k) => /date/i.test(k) && r[k]);
  const hashKey = Object.keys(r).find((k) => /hash/i.test(k) && Array.isArray(r[k]));
  const tags = (hashKey && r[hashKey]) || [];
  return {
    goodsNo: r.goodsNo,
    title: r.title || '',
    price: r.price,
    jobs: (r.jobs || []).map((j) => j.jobName).filter(Boolean).concat(r.jobName && !r.jobs ? [r.jobName] : []),
    avatarRarity: r.avatarRarity || '',
    avatarSet: r.avatarSet ?? null,
    date: r.soldDate || r.regDate || (dateKey ? String(r[dateKey]) : ''),
    hashtags: tags.map((h) => (typeof h === 'string' ? h : h.hashtag || h.name || '')).filter(Boolean),
    parts: (r.avatar || []).map((a) => ({
      itemId: a.itemId || '', itemName: a.itemName || '', slotName: a.slotName || '', itemRarity: a.itemRarity || '',
      emblems: (a.emblems || []).map((e) => e.itemName).filter(Boolean)
    }))
  };
}

async function collectAvatar() {
  // 판매 중: 등급(상급·레어·혼합) × (최신 등록순, 낮은 가격순)으로 여러 번 받아 합쳐요 (한 번에 최대 50개라서)
  const sale = new Map();
  let firstKeys = null;
  for (const rarity of ['상급', '레어', '혼합']) {
    for (const sort of ['goodsNo:desc', 'price:asc']) {
      try {
        const data = await call('/df/avatar-market/sale', { limit: 50, sort, q: `avatarRarity:${rarity}` });
        for (const r of data.rows || []) {
          if (!firstKeys) firstKeys = Object.keys(r).join(',');
          if (!sale.has(r.goodsNo)) sale.set(r.goodsNo, pickGoods(r));
        }
      } catch (e) {
        report.failed.push(`아바타 판매 ${rarity}/${sort}: ${e.message}`);
      }
    }
  }

  // 최근 거래
  let sold = [];
  try {
    const data = await call('/df/avatar-market/sold', { limit: 50, sort: 'goodsNo:desc' });
    sold = (data.rows || []).map(pickGoods).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.goodsNo - a.goodsNo));
  } catch (e) {
    report.failed.push(`아바타 거래: ${e.message}`);
  }

  if (!sale.size && !sold.length) throw new Error('아바타 마켓 데이터를 받지 못했어요');
  const saleRows = [...sale.values()].sort((a, b) => b.goodsNo - a.goodsNo);
  await writeJSON('data/avatar.json', { updatedAt, sale: saleRows, sold });
  report.ok.push(`아바타 마켓 판매 ${saleRows.length}건 / 거래 ${sold.length}건`);
  if (firstKeys) console.log('아바타 판매 응답 필드:', firstKeys); // 필드 확인용 (Actions 로그)
}

/* ---------- 검색엔진용 브리핑 (index.html에 직접 써 넣는 글) ---------- */
// 메인 화면 내용은 브라우저에서 자바스크립트로 채워져서, 구글이 처음 읽는 HTML에는 글이 거의 없어요.
// 그래서 매시간 모은 데이터로 '오늘의 연구 브리핑' 문장을 만들어 HTML 원본에 넣어요. (화면에도 그대로 보여요)
const SERVER_KO = { cain: '카인', diregie: '디레지에', siroco: '시로코', prey: '프레이', casillas: '카시야스', hilder: '힐더', anton: '안톤', bakal: '바칼' };
const escHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function goldKo(n) {
  n = Math.round(Number(n) || 0);
  if (n >= 1e8) { const e = Math.floor(n / 1e8); const m = Math.floor((n % 1e8) / 1e4); return `${e}억${m ? ` ${m.toLocaleString('ko-KR')}만` : ''}`; }
  if (n >= 1e4) { const m = Math.floor(n / 1e4); const r = n % 1e4; return `${m.toLocaleString('ko-KR')}만${r ? ` ${r.toLocaleString('ko-KR')}` : ''}`; }
  return n.toLocaleString('ko-KR');
}

async function writeBrief() {
  const [auction, fame, trends, avatar] = await Promise.all([
    readJSON('data/auction.json', null), readJSON('data/fame.json', null), readJSON('data/trends.json', null), readJSON('data/avatar.json', null)
  ]);
  const kst = new Date(now.getTime() + 9 * 3600 * 1000);
  const when = `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${kst.getUTCHours()}시`;
  const cards = [];
  const card = (title, code, href, inner) =>
    `<article class="brief-card"><h3><span class="brief-code">${code}</span>${title}</h3>${inner}<a class="brief-more" href="${href}">자세히 보기 ›</a></article>`;
  const chg = (p) => (Number.isFinite(p) && Math.abs(p) >= 0.05
    ? `<span class="brief-chg ${p > 0 ? 'up' : 'down'}">${p > 0 ? '▲' : '▼'}${Math.abs(p).toFixed(1)}%</span>`
    : '<span class="brief-chg">-</span>');

  // 1) 경매장 시세: 분류별 2개씩 표
  const items = (auction?.categories || []).flatMap((c) => (c.items || []).slice(0, 2).map((it) => ({ ...it, cat: c.name }))).filter((it) => it.avgPrice);
  if (items.length) {
    cards.push(card('경매장 시세', 'LAB-01', '#auction',
      `<p class="brief-note">평균 거래가 · 전일 대비</p><table class="brief-table"><tbody>${items.map((it) =>
        `<tr><td><span class="brief-cat">${escHtml(it.cat)}</span>${escHtml(it.itemName)}</td><td class="num">${goldKo(it.avgPrice)} 골드</td><td class="num">${chg(it.changePct)}</td></tr>`).join('')}</tbody></table>`));
  }

  // 2) 명성 랭킹: 1~3위 + 최다 직업 + 서버별 1위
  const all = fame?.all || [];
  if (all.length) {
    const tops = Object.entries(fame.byServer || {}).filter(([, list]) => list && list[0])
      .map(([id, list]) => `<span>${escHtml(SERVER_KO[id] || id)} <b>${escHtml(list[0].characterName)}</b></span>`);
    const jobs = new Map();
    all.forEach((c) => { const j = c.jobGrowName || c.jobName; if (j) jobs.set(j, (jobs.get(j) || 0) + 1); });
    const [topJob, topN] = [...jobs.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    cards.push(card('명성 랭킹', 'LAB-02', '#fame',
      `<ol class="brief-rank">${all.slice(0, 3).map((c, i) =>
        `<li><span class="brief-medal r${i + 1}">${i + 1}</span><span class="brief-who"><strong>${escHtml(c.characterName)}</strong><small>${escHtml(SERVER_KO[c.serverId] || c.serverId)} · ${escHtml(c.jobGrowName || c.jobName)}</small></span><span class="num">명성 ${Number(c.fame).toLocaleString('ko-KR')}</span></li>`).join('')}</ol>`
      + (topJob ? `<p class="brief-line"><span>랭커 최다 직업</span><strong>${escHtml(topJob)} ${(topN / all.length * 100).toFixed(1)}%</strong></p>` : '')
      + (tops.length ? `<p class="brief-note">서버별 1위</p><p class="brief-chips">${tops.join('')}</p>` : '')));
  }

  // 3) 랭커 트렌드: 분류별 1위 + 급상승
  if (trends?.sample) {
    const label = { title: '칭호', creature: '크리쳐', aura: '오라', weapon: '무기 아바타' };
    const rows = Object.keys(label).filter((k) => (trends[k] || [])[0]).map((k) =>
      `<div><dt>${label[k]}</dt><dd>${escHtml(trends[k][0].itemName)}<b>${Math.round(trends[k][0].count / trends.sample * 100)}%</b></dd></div>`);
    const rise = (trends.risers || [])[0];
    const riseRow = rise ? `<div class="brief-rise"><dt>급상승</dt><dd>${escHtml(label[rise.category] || '')} · ${escHtml(rise.itemName)}<b>${rise.isNew ? 'NEW' : `▲${rise.delta}`}</b></dd></div>` : '';
    if (rows.length) cards.push(card('랭커 트렌드', 'LAB-03', '#trend', `<p class="brief-note">랭커가 가장 많이 쓰는 장착품 · 사용 비율</p><dl class="brief-dl">${rows.join('')}${riseRow}</dl>`));
  }

  // 4) 아바타 마켓: 숫자 타일
  const sale = avatar?.sale || [];
  const sold = avatar?.sold || [];
  if (sale.length || sold.length) {
    const low = (r) => {
      const p = sale.filter((x) => x.avatarRarity === r && x.price > 0).map((x) => x.price);
      return p.length ? `<div><span>${r} 최저가</span><strong>${goldKo(Math.min(...p))}</strong></div>` : '';
    };
    cards.push(card('아바타 마켓', 'LAB-04', 'avatar.html',
      `<div class="brief-stats"><div><span>판매 중 매물</span><strong>${sale.length.toLocaleString('ko-KR')}건</strong></div>${['상급', '레어', '혼합'].map(low).join('')}</div>`
      + (sold[0] ? `<p class="brief-line"><span>최근 거래</span><strong>${escHtml(sold[0].title)} · ${goldKo(sold[0].price)} 골드</strong></p>` : '')));
  }

  if (!cards.length) return;
  const html = `
    <section class="section brief" id="brief" aria-labelledby="brief-title">
      <div class="section-head"><h2 id="brief-title">오늘의 연구 브리핑</h2><span class="lab-code">BRIEF</span><span class="rule" aria-hidden="true"></span><span class="meta">${when} 기준</span></div>
      <p class="brief-intro">${when} 기준으로 던랩이 네오플 오픈 API에서 모은 던전앤파이터 경매장 시세, 명성 랭킹, 랭커 장착품, 아바타 마켓 요약이에요.</p>
      <div class="brief-grid">
        ${cards.join('\n        ')}
      </div>
      <p class="job-links"><a class="chip" href="reports.html">주간 연구 리포트 ›</a><a class="chip" href="jobs.html">직업별 랭커 세팅 ›</a></p>
    </section>
    `;
  const file = join(ROOT, 'index.html');
  let page;
  try { page = await readFile(file, 'utf8'); } catch { return; }
  const re = /(<!-- AUTO-BRIEF:START[^>]*-->)[\s\S]*?(\s*<!-- AUTO-BRIEF:END -->)/;
  if (!re.test(page)) { report.failed.push('브리핑: index.html에 표시(AUTO-BRIEF)가 없어요'); return; }
  const nl = page.includes('\r\n') ? '\r\n' : '\n';
  page = page.replace(re, (_, a, b) => a + html.replace(/\n/g, nl) + b);
  await writeFile(file, page);

  // 사이트맵의 메인·아바타 마켓 날짜를 오늘로 (구글이 새 내용이 있다는 걸 알 수 있게)
  const smFile = join(ROOT, 'sitemap.xml');
  try {
    let sm = await readFile(smFile, 'utf8');
    const today = kstDate(now);
    for (const loc of ['https://tnrns144-lgtm.github.io/DUNPA/', 'https://tnrns144-lgtm.github.io/DUNPA/avatar.html']) {
      const block = new RegExp(`(<loc>${loc.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}</loc>)(\\s*<lastmod>[^<]*</lastmod>)?`);
      sm = sm.replace(block, (_, l) => `${l}${nl}    <lastmod>${today}</lastmod>`);
    }
    await writeFile(smFile, sm);
  } catch { /* 사이트맵이 없으면 건너뜀 */ }
  report.ok.push('브리핑 갱신');
}

/* ---------- 직업별 랭커 세팅 (하루 1번) ---------- */
// /df/jobs로 전직 목록을 받고, 전직마다 명성 상위 랭커를 최대 JOB_SAMPLE명 골라 장착품을 집계해요.
// 명성 검색은 한 번에 '최고 명성 기준 2,000 범위'만 돌려줘서, 랭커가 모자라면 범위를 아래로 옮겨 가며 다시 찾아요.
const JOB_SAMPLE = 10;
const JOB_WINDOWS = 12;   // 범위를 아래로 옮기는 최대 횟수 (API 호출을 무료 범위 안으로 제한)

// 전직 ID(jobGrowId)는 직업마다 겹쳐요(예: 웨펀마스터와 넨마스터가 같은 ID). 그래서 페이지 이름은 직업 ID + 전직 ID 앞부분으로 만들어요
const jobPageId = (j) => `${String(j.jobId).slice(0, 8)}-${String(j.id).slice(0, 8)}`;

function lastGrow(g) { let x = g; while (x && x.next) x = x.next; return x || g; }

async function collectJobs() {
  const prev = await readJSON('data/jobs.json', null);
  const age = prev?.updatedAt ? now - new Date(prev.updatedAt) : Infinity;
  if (process.env.FORCE_TRENDS !== '1' && age < 20 * 3600 * 1000) { report.ok.push('직업 연구 건너뜀 (하루 1번)'); return; }

  const fame = await readJSON('data/fame.json', null);
  const topFame = Number(fame?.all?.[0]?.fame) || 0;
  if (!topFame) throw new Error('명성 데이터가 없어요');
  const jobsRes = await call('/df/jobs');
  const grows = [];
  for (const j of jobsRes.rows || []) {
    for (const g of j.rows || []) {
      if (!g.jobGrowId) continue;
      grows.push({ jobId: j.jobId, jobName: j.jobName, jobGrowId: g.jobGrowId, growName: g.jobGrowName, finalName: lastGrow(g).jobGrowName || g.jobGrowName });
    }
  }
  if (!grows.length) throw new Error('직업 목록이 비어 있어요');

  const isSlot = (s, id, name) => s.slotId === id || s.slotName === name;
  const look = (a) => (a.clone && a.clone.itemName && !/클론 아바타/.test(a.clone.itemName) ? a.clone : a);
  const topN = (map, n) => [...map.values()].sort((a, b) => b.count - a.count).slice(0, n);
  const out = [];
  let failed = 0;

  for (const g of grows) {
    // 1) 이 전직의 명성 상위 랭커 찾기
    const found = new Map();
    let max = topFame;
    for (let w = 0; w < JOB_WINDOWS && found.size < JOB_SAMPLE && max > 0; w++) {
      try {
        const res = await call('/df/servers/all/characters-fame', {
          jobId: g.jobId, jobGrowId: g.jobGrowId, isAllJobGrow: 'true', maxFame: max, minFame: Math.max(0, max - 2000), limit: 200
        });
        for (const r of res.rows || []) if (!found.has(r.characterId)) found.set(r.characterId, pickChar(r));
      } catch (e) { failed++; break; }
      max -= 2001;
    }
    const rankers = [...found.values()].sort((a, b) => b.fame - a.fame).slice(0, JOB_SAMPLE);
    if (!rankers.length) continue;

    // 2) 랭커마다 장비·아바타·크리쳐 조회해서 집계
    const counters = { title: new Map(), creature: new Map(), aura: new Map(), weapon: new Map() };
    const sets = new Map();
    const add = (key, item) => {
      if (!item || !item.itemName) return;
      const cur = counters[key].get(item.itemName) || { itemId: item.itemId || '', itemName: item.itemName, itemRarity: item.itemRarity || '', count: 0 };
      cur.count++;
      counters[key].set(item.itemName, cur);
    };
    let sample = 0;
    for (const c of rankers) {
      const base = `/df/servers/${c.serverId}/characters/${c.characterId}`;
      try {
        const [eq, av, cr] = await Promise.all([call(`${base}/equip/equipment`), call(`${base}/equip/avatar`), call(`${base}/equip/creature`)]);
        sample++;
        const equip = eq.equipment || [];
        add('title', equip.find((e) => isSlot(e, 'TITLE', '칭호')));
        // 세트 이름에는 이미지가 없어서, 그 세트의 대표 장비(상의 우선) 아이콘을 함께 기록해요
        const pieces = new Map();
        const PREFER = ['JACKET', 'SHOULDER', 'PANTS', 'SHOES', 'WAIST', 'AMULET', 'WRIST', 'RING', 'SUPPORT', 'MAGIC_STON', 'EARRING', 'WEAPON'];
        equip.forEach((e) => {
          if (!e.setItemName) return;
          const p = pieces.get(e.setItemName) || { n: 0, rep: null };
          p.n++;
          const rank = (x) => { const i = PREFER.indexOf(x?.slotId); return i < 0 ? 99 : i; };
          if (e.itemId && (!p.rep || rank(e) < rank(p.rep))) p.rep = e;
          pieces.set(e.setItemName, p);
        });
        pieces.forEach((p, name) => {
          if (p.n < 2) return;
          const s = sets.get(name) || { itemName: name, itemId: p.rep?.itemId || '', itemRarity: p.rep?.itemRarity || '', count: 0 };
          if (!s.itemId && p.rep?.itemId) { s.itemId = p.rep.itemId; s.itemRarity = p.rep.itemRarity || ''; }
          s.count++;
          sets.set(name, s);
        });
        const avatars = av.avatar || [];
        const aura = avatars.find((a) => isSlot(a, 'AURORA', '오라'));
        const weapon = avatars.find((a) => isSlot(a, 'WEAPON', '무기'));
        if (aura) add('aura', look(aura));
        if (weapon) add('weapon', look(weapon));
        add('creature', cr.creature);
      } catch (e) { failed++; }
    }
    // 최종 전직 이름은 실제 랭커들이 가장 많이 가진 이름으로
    const names = new Map();
    rankers.forEach((c) => { if (c.jobGrowName) names.set(c.jobGrowName, (names.get(c.jobGrowName) || 0) + 1); });
    const finalName = [...names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || g.finalName;
    out.push({
      id: g.jobGrowId, jobId: g.jobId, jobName: g.jobName, growName: g.growName, finalName, sample,
      topFame: rankers[0].fame, avgFame: Math.round(rankers.reduce((s, c) => s + c.fame, 0) / rankers.length),
      rankers, sets: topN(sets, 5),
      title: topN(counters.title, 3), creature: topN(counters.creature, 3), aura: topN(counters.aura, 3), weapon: topN(counters.weapon, 3)
    });
  }

  if (!out.length) throw new Error('직업별 랭커를 하나도 찾지 못했어요');
  await writeJSON('data/jobs.json', { updatedAt, jobs: out });
  report.ok.push(`직업 연구 ${out.length}개 전직`);
  if (failed) report.failed.push(`직업 연구 조회 실패 ${failed}건`);
}

/* ---------- 직업 연구 정적 페이지 생성 (jobs.html 목록 + jobs/전직ID.html) ---------- */
// 검색엔진이 바로 읽을 수 있게 내용을 HTML에 직접 써 넣어요. 머리글·바닥글은 jobs.html의 것을 그대로 가져와요.
async function writeJobPages() {
  const data = await readJSON('data/jobs.json', null);
  if (!data?.jobs?.length) return;
  const listFile = join(ROOT, 'jobs.html');
  let list;
  try { list = await readFile(listFile, 'utf8'); } catch { return; }
  const nl = list.includes('\r\n') ? '\r\n' : '\n';
  const BASE = 'https://tnrns144-lgtm.github.io/DUNPA/';
  const IMG_ITEM = (id) => `https://img-api.neople.co.kr/df/items/${encodeURIComponent(id)}`;
  const IMG_CHAR = (s, id) => `https://img-api.neople.co.kr/df/servers/${s}/characters/${id}?zoom=1`;
  const kst = new Date(new Date(data.updatedAt).getTime() + 9 * 3600 * 1000);
  const when = `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일`;
  const jobs = [...data.jobs].sort((a, b) => b.topFame - a.topFame);
  const fameKo = (n) => Number(n).toLocaleString('ko-KR');

  // 목록 페이지 본문: 직업군별로 묶어서 카드
  const groups = new Map();
  jobs.forEach((j) => { if (!groups.has(j.jobName)) groups.set(j.jobName, []); groups.get(j.jobName).push(j); });
  const listHtml = `
    <section class="section" aria-labelledby="jobs-title">
      <div class="section-head"><h2 id="jobs-title">전직별 랭커 세팅</h2><span class="lab-code">LAB-05</span><span class="rule" aria-hidden="true"></span><span class="meta">${when} 기준</span></div>
      <p class="brief-intro">${when} 기준으로 ${jobs.length}개 전직의 명성 상위 랭커 장착 데이터를 분석했어요. 직업을 누르면 많이 쓰는 세트 장비·칭호·크리쳐·오라·무기 아바타와 랭커 모습을 볼 수 있어요.</p>
      ${[...groups.entries()].map(([group, list]) => `
      <div class="job-group">
        <h3 class="job-group-title">${escHtml(group)}</h3>
        <div class="job-grid">
          ${list.map((j) => `<a class="job-card job-card--img" href="jobs/${jobPageId(j)}.html">
            ${j.rankers[0] ? `<span class="job-card-img"><img src="${IMG_CHAR(j.rankers[0].serverId, j.rankers[0].characterId)}" alt="" loading="lazy"></span>` : ''}
            <strong>${escHtml(j.finalName)}</strong>
            <small>${escHtml(j.growName)} 계열 · 최고 명성 ${fameKo(j.topFame)}</small>
            ${j.sets[0] ? `<span class="job-card-set">인기 세트 · ${escHtml(j.sets[0].itemName)}</span>` : ''}
          </a>`).join('')}
        </div>
      </div>`).join('')}
    </section>
    `;
  const re = /(<!-- AUTO-JOBS:START[^>]*-->)[\s\S]*?(\s*<!-- AUTO-JOBS:END -->)/;
  if (!re.test(list)) { report.failed.push('직업 연구: jobs.html에 표시(AUTO-JOBS)가 없어요'); return; }
  list = list.replace(re, (_, a, b) => a + listHtml.replace(/\n/g, nl) + b);
  await writeFile(listFile, list);

  // 상세 페이지: jobs.html의 머리글·바닥글을 재사용하고, <base href="../">로 경로를 맞춰요
  const header = (list.match(/<header class="site-header">[\s\S]*?<\/header>/) || [''])[0];
  const footer = (list.match(/<footer class="site-footer">[\s\S]*?<\/footer>/) || [''])[0];
  const itemRow = (it, total) => `<li><span class="item-cell"><span class="item-icon">${it.itemId ? `<img src="${IMG_ITEM(it.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span><span class="item-name">${escHtml(it.itemName)}</span></span><b>${total ? Math.round(it.count / total * 100) : 0}%</b></li>`;
  const block = (title, arr, total) => `<article class="brief-card"><h3>${title}</h3>${arr.length ? `<ul class="job-items">${arr.map((it) => itemRow(it, total)).join('')}</ul>` : '<p class="help">데이터가 없어요</p>'}</article>`;
  await mkdir(join(ROOT, 'jobs'), { recursive: true });
  {
    const { readdir, unlink } = await import('node:fs/promises');
    const keep = new Set(jobs.map((j) => `${jobPageId(j)}.html`));
    for (const f of await readdir(join(ROOT, 'jobs'))) if (f.endsWith('.html') && !keep.has(f)) await unlink(join(ROOT, 'jobs', f));
  }
  for (const j of jobs) {
    const siblings = jobs.filter((x) => x.jobName === j.jobName && jobPageId(x) !== jobPageId(j));
    const desc = `던전앤파이터 ${j.finalName}(${j.jobName}) 랭커 세팅: 명성 상위 랭커들이 많이 쓰는 세트 장비${j.sets[0] ? `(${j.sets[0].itemName} 등)` : ''}, 칭호, 크리쳐, 오라, 무기 아바타를 매일 분석해요.`;
    const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="../">
<title>${escHtml(j.finalName)} 랭커 세팅 (${escHtml(j.jobName)}) · 직업 연구 · 던랩</title>
<meta name="description" content="${escHtml(desc)}">
<meta name="theme-color" content="#070C11">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=JetBrains+Mono:wght@400;700&family=Noto+Sans+KR:wght@400;500;700&display=swap">
<link rel="stylesheet" href="assets/css/theme.css">
<link rel="stylesheet" href="assets/css/style.css">
<link rel="canonical" href="${BASE}jobs/${jobPageId(j)}.html">
</head>
<body>

${header}

<section class="hero hero--compact hero--job">
  ${j.rankers[0] ? `<a class="hero-champion" href="character.html?server=${j.rankers[0].serverId}&amp;id=${j.rankers[0].characterId}" title="${escHtml(j.finalName)} 명성 1위 ${escHtml(j.rankers[0].characterName)}"><img src="${IMG_CHAR(j.rankers[0].serverId, j.rankers[0].characterId).replace('zoom=1', 'zoom=2')}" alt="${escHtml(j.finalName)} 명성 1위 ${escHtml(j.rankers[0].characterName)}"><span>명성 1위 · ${escHtml(j.rankers[0].characterName)}</span></a>` : ''}
  <div class="hero-inner">
    <p class="eyebrow">JOB RESEARCH · ${escHtml(j.jobName)}</p>
    <h1 class="hero-title">${escHtml(j.finalName)} 랭커 세팅</h1>
    <p class="hero-sub">명성 상위 랭커들의 장착품을 ${when} 기준으로 분석했어요</p>
  </div>
</section>

<div class="container jobs-wrap">
  <main>
    <section class="section">
      <div class="section-head"><h2>세팅 요약</h2><span class="lab-code">${escHtml(j.growName)}</span><span class="rule" aria-hidden="true"></span><span class="meta">${when} 기준</span></div>
      <p class="brief-intro">${escHtml(j.finalName)}(${escHtml(j.jobName)}) 명성 상위 랭커들의 최고 명성은 ${fameKo(j.topFame)}, 평균 명성은 ${fameKo(j.avgFame)}이에요. 비율은 조사한 랭커 가운데 해당 장착품을 쓰는 비율이에요.</p>
      <div class="brief-grid">
        ${block('많이 쓰는 세트 장비', j.sets, j.sample)}
        ${block('칭호', j.title, j.sample)}
        ${block('크리쳐', j.creature, j.sample)}
        ${block('오라 · 무기 아바타', [...j.aura.slice(0, 2), ...j.weapon.slice(0, 2)], j.sample)}
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>${escHtml(j.finalName)} 랭커</h2><span class="lab-code">LOOK</span><span class="rule" aria-hidden="true"></span></div>
      <div class="look-grid">
        ${j.rankers.map((c) => `<a class="look-card" href="character.html?server=${c.serverId}&amp;id=${c.characterId}">
          <span class="look-img"><img src="${IMG_CHAR(c.serverId, c.characterId)}" alt="${escHtml(c.characterName)}" loading="lazy"></span>
          <strong>${escHtml(c.characterName)}</strong>
          <small>${escHtml(SERVER_KO[c.serverId] || c.serverId)}</small>
          <small class="look-fame">${fameKo(c.fame)}</small>
        </a>`).join('')}
      </div>
    </section>
    <section class="section">
      <div class="section-head"><h2>다른 직업 보기</h2><span class="rule" aria-hidden="true"></span></div>
      <p class="job-links">${siblings.map((x) => `<a class="chip" href="jobs/${jobPageId(x)}.html">${escHtml(x.finalName)}</a>`).join('')}<a class="chip" href="jobs.html">전체 직업 목록 ›</a></p>
    </section>
  </main>
</div>

${footer}

<script src="assets/js/config.js"></script>
<script src="assets/js/common.js"></script>
</body>
</html>
`;
    await writeFile(join(ROOT, 'jobs', `${jobPageId(j)}.html`), page);
  }

  // 사이트맵에 직업 페이지 목록 갱신
  const smFile = join(ROOT, 'sitemap.xml');
  try {
    let sm = await readFile(smFile, 'utf8');
    const snl = sm.includes('\r\n') ? '\r\n' : '\n';
    const today = kstDate(now);
    const urls = [`${BASE}jobs.html`, ...jobs.map((j) => `${BASE}jobs/${jobPageId(j)}.html`)]
      .map((u) => `  <url>${snl}    <loc>${u}</loc>${snl}    <lastmod>${today}</lastmod>${snl}    <changefreq>daily</changefreq>${snl}    <priority>0.7</priority>${snl}  </url>`).join(snl);
    const block = `  <!-- AUTO-JOBS:START -->${snl}${urls}${snl}  <!-- AUTO-JOBS:END -->`;
    sm = /  <!-- AUTO-JOBS:START -->[\s\S]*?<!-- AUTO-JOBS:END -->/.test(sm)
      ? sm.replace(/  <!-- AUTO-JOBS:START -->[\s\S]*?<!-- AUTO-JOBS:END -->/, block)
      : sm.replace('</urlset>', `${block}${snl}</urlset>`);
    await writeFile(smFile, sm);
  } catch { /* 사이트맵이 없으면 건너뜀 */ }
  report.ok.push(`직업 페이지 ${jobs.length}개 생성`);
}

/* ---------- 주간 연구 리포트 (reports.html 목록 + reports/YYYY-Www.html) ---------- */
// 이번 주(월~일, 한국 시간) 리포트는 매번 다시 쓰고, 지난 주 리포트는 손대지 않아 그대로 보관돼요.
function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;            // 월=0 … 일=6
  const monday = new Date(d.getTime() - day * 86400000);
  const thursday = new Date(monday.getTime() + 3 * 86400000);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((thursday - jan4) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  const iso = (t) => new Date(t).toISOString().slice(0, 10);
  return { id: `${year}-W${String(week).padStart(2, '0')}`, year, week, start: iso(monday), end: iso(monday.getTime() + 6 * 86400000) };
}

async function writeWeeklyReport() {
  const listFile = join(ROOT, 'reports.html');
  let list;
  try { list = await readFile(listFile, 'utf8'); } catch { return; }
  const nl = list.includes('\r\n') ? '\r\n' : '\n';
  const BASE = 'https://tnrns144-lgtm.github.io/DUNPA/';
  const today = kstDate(now);
  const wk = isoWeek(today);
  const [auctionHist, trendHist, fame, trends, jobsData, auction] = await Promise.all([
    readJSON('data/history/auction-daily.json', {}), readJSON('data/history/trends-daily.json', {}),
    readJSON('data/fame.json', null), readJSON('data/trends.json', null), readJSON('data/jobs.json', null), readJSON('data/auction.json', null)
  ]);
  const inWeek = (d) => d >= wk.start && d <= wk.end;
  const md = (d) => `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;

  // 1) 시세 변화: 주 첫 기록 vs 마지막 기록
  const aDays = Object.keys(auctionHist).filter(inWeek).sort();
  const idOf = new Map((auction?.categories || []).flatMap((c) => c.items || []).concat(auction?.reference || []).map((it) => [it.itemName, it.itemId]));
  let movers = [];
  if (aDays.length >= 2) {
    const names = new Set(aDays.flatMap((d) => Object.keys(auctionHist[d])));
    movers = [...names].map((name) => {
      const vals = aDays.map((d) => auctionHist[d][name]).filter((v) => v > 0);
      if (vals.length < 2) return null;
      return { name, first: vals[0], last: vals[vals.length - 1], pct: (vals[vals.length - 1] - vals[0]) / vals[0] * 100 };
    }).filter((m) => m && Math.abs(m.pct) >= 0.05);
  }
  const risers = [...movers].sort((a, b) => b.pct - a.pct).filter((m) => m.pct > 0).slice(0, 5);
  const fallers = [...movers].sort((a, b) => a.pct - b.pct).filter((m) => m.pct < 0).slice(0, 5);

  // 2) 랭커 장착품 변화: 주 첫 관측 vs 마지막 관측
  const tDays = Object.keys(trendHist).filter(inWeek).sort();
  const label = { title: '칭호', creature: '크리쳐', aura: '오라', weapon: '무기 아바타' };
  let gearUp = [];
  if (tDays.length >= 2) {
    const a = trendHist[tDays[0]].counts || {};
    const b = trendHist[tDays[tDays.length - 1]].counts || {};
    gearUp = Object.keys(label).flatMap((k) => Object.entries(b[k] || {}).map(([name, n]) => ({ k, name, n, d: n - ((a[k] || {})[name] || 0) })))
      .filter((x) => x.d > 0).sort((x, y) => y.d - x.d).slice(0, 5);
  }

  if (!aDays.length && !tDays.length) return; // 이번 주 데이터가 아직 없음

  const IMG_ITEM = (id) => `https://img-api.neople.co.kr/df/items/${encodeURIComponent(id)}`;
  const icon = (id) => (id ? `<span class="item-icon"><img src="${IMG_ITEM(id)}" alt="" loading="lazy" width="28" height="28"></span>` : '');
  const moverRow = (m) => `<tr><td><span class="item-cell">${icon(idOf.get(m.name))}<span class="item-name">${escHtml(m.name)}</span></span></td><td class="num">${goldKo(m.first)} → ${goldKo(m.last)}</td><td class="num"><span class="brief-chg ${m.pct > 0 ? 'up' : 'down'}">${m.pct > 0 ? '▲' : '▼'}${Math.abs(m.pct).toFixed(1)}%</span></td></tr>`;
  const table = (rows) => rows.length ? `<table class="brief-table"><tbody>${rows.map(moverRow).join('')}</tbody></table>` : '<p class="help">이번 주에는 해당하는 변화가 아직 없어요.</p>';
  const all = fame?.all || [];
  const topJobs = [...(jobsData?.jobs || [])].sort((a, b) => b.topFame - a.topFame).slice(0, 5);
  const range = `${md(wk.start)} ~ ${md(wk.end)}`;
  const ongoing = today <= wk.end;
  // 이름 뒤 조사가 어색해지지 않게 '이름(변화)' 꼴로 써요
  const leadParts = [];
  if (risers[0]) leadParts.push(`경매장 최대 상승은 ${escHtml(risers[0].name)}(▲${risers[0].pct.toFixed(1)}%)`);
  if (fallers[0]) leadParts.push(`최대 하락은 ${escHtml(fallers[0].name)}(▼${Math.abs(fallers[0].pct).toFixed(1)}%)`);
  if (gearUp[0]) leadParts.push(`랭커 장착품 중 가장 많이 늘어난 것은 ${label[gearUp[0].k]} ${escHtml(gearUp[0].name)}(▲${gearUp[0].d}명)`);
  const lead = leadParts.length ? `이번 주 ${leadParts.join(', ')}이에요.` : '이번 주 데이터를 모으는 중이에요.';

  const body = `
    <section class="section">
      <div class="section-head"><h2>${wk.year}년 ${wk.week}주차 요약</h2><span class="lab-code">${wk.id}</span><span class="rule" aria-hidden="true"></span><span class="meta">${range}${ongoing ? ' · 진행 중' : ''}</span></div>
      <p class="brief-intro">${range} 던전앤파이터 주간 연구 리포트예요. ${lead}${ongoing ? ' 이번 주가 끝날 때까지 매일 갱신돼요.' : ''}</p>
      <div class="brief-grid">
        <article class="brief-card"><h3><span class="brief-code">UP</span>시세 상승 TOP 5</h3><p class="brief-note">주 첫 기록 → 마지막 기록 평균 거래가</p>${table(risers)}</article>
        <article class="brief-card"><h3><span class="brief-code">DOWN</span>시세 하락 TOP 5</h3><p class="brief-note">주 첫 기록 → 마지막 기록 평균 거래가</p>${table(fallers)}</article>
        <article class="brief-card"><h3><span class="brief-code">GEAR</span>랭커 장착품 변화</h3><p class="brief-note">이번 주 사용 인원이 가장 많이 늘어난 장착품</p>${gearUp.length ? `<dl class="brief-dl">${gearUp.map((x) => `<div><dt>${label[x.k]}</dt><dd>${escHtml(x.name)}<b>▲${x.d}명</b></dd></div>`).join('')}</dl>` : '<p class="help">관측이 이틀 이상 쌓이면 변화가 나와요.</p>'}
          ${trends?.sample ? `<p class="brief-note">현재 1위 · ${Object.keys(label).filter((k) => (trends[k] || [])[0]).map((k) => `${label[k]} ${escHtml(trends[k][0].itemName)}`).join(' · ')}</p>` : ''}</article>
        <article class="brief-card"><h3><span class="brief-code">FAME</span>명성 랭킹</h3>${all.length ? `<ol class="brief-rank">${all.slice(0, 3).map((c, i) => `<li><span class="brief-medal r${i + 1}">${i + 1}</span><span class="brief-who"><strong>${escHtml(c.characterName)}</strong><small>${escHtml(SERVER_KO[c.serverId] || c.serverId)} · ${escHtml(c.jobGrowName || c.jobName)}</small></span><span class="num">명성 ${Number(c.fame).toLocaleString('ko-KR')}</span></li>`).join('')}</ol>` : ''}
          ${topJobs.length ? `<p class="brief-note">최고 명성이 높은 직업</p><p class="brief-chips">${topJobs.map((j) => `<a href="jobs/${jobPageId(j)}.html"><span>${escHtml(j.finalName)} <b>${Number(j.topFame).toLocaleString('ko-KR')}</b></span></a>`).join('')}</p>` : ''}</article>
      </div>
      <p class="job-links"><a class="chip" href="reports.html">지난 리포트 목록 ›</a><a class="chip" href="index.html">오늘의 시세 보기 ›</a><a class="chip" href="jobs.html">직업 연구 ›</a></p>
    </section>`;

  // 상세 페이지 (reports.html의 머리글·바닥글 재사용)
  const header = (list.match(/<header class="site-header">[\s\S]*?<\/header>/) || [''])[0];
  const footer = (list.match(/<footer class="site-footer">[\s\S]*?<\/footer>/) || [''])[0];
  const title = `${wk.year}년 ${wk.week}주차 던파 주간 리포트 (${range})`;
  const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="../">
<title>${title} · 던랩</title>
<meta name="description" content="${escHtml(`${range} 던전앤파이터 주간 리포트: 경매장 시세 상승·하락 TOP 5, 랭커 장착품 변화, 명성 랭킹 요약.`)}">
<meta name="theme-color" content="#070C11">
<link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Black+Han+Sans&family=JetBrains+Mono:wght@400;700&family=Noto+Sans+KR:wght@400;500;700&display=swap">
<link rel="stylesheet" href="assets/css/theme.css">
<link rel="stylesheet" href="assets/css/style.css">
<link rel="canonical" href="${BASE}reports/${wk.id}.html">
</head>
<body>

${header}

<section class="hero hero--compact">
  <div class="hero-inner">
    <p class="eyebrow">WEEKLY REPORT · ${wk.id}</p>
    <h1 class="hero-title">${wk.year}년 ${wk.week}주차 리포트</h1>
    <p class="hero-sub">${range} 아라드 데이터 정리</p>
  </div>
</section>

<div class="container jobs-wrap">
  <main>${body}
  </main>
</div>

${footer}

<script src="assets/js/config.js"></script>
<script src="assets/js/common.js"></script>
</body>
</html>
`;
  await mkdir(join(ROOT, 'reports'), { recursive: true });
  await writeFile(join(ROOT, 'reports', `${wk.id}.html`), page);

  // 목록 페이지 (보관된 모든 주차, 최신순)
  const { readdir } = await import('node:fs/promises');
  const ids = (await readdir(join(ROOT, 'reports'))).filter((f) => /^\d{4}-W\d{2}\.html$/.test(f)).map((f) => f.slice(0, -5)).sort().reverse();
  const listHtml = `
    <section class="section">
      <div class="section-head"><h2>리포트 목록</h2><span class="lab-code">ARCHIVE</span><span class="rule" aria-hidden="true"></span></div>
      <div class="job-grid">
        ${ids.map((id) => {
          const [y, w] = id.split('-W');
          return `<a class="job-card" href="reports/${id}.html"><strong>${y}년 ${Number(w)}주차</strong><small>${id === wk.id ? `${range} · 진행 중` : id}</small></a>`;
        }).join('')}
      </div>
    </section>
    `;
  const re = /(<!-- AUTO-REPORTS:START[^>]*-->)[\s\S]*?(\s*<!-- AUTO-REPORTS:END -->)/;
  if (re.test(list)) {
    list = list.replace(re, (_, a, b) => a + listHtml.replace(/\n/g, nl) + b);
    await writeFile(listFile, list);
  }

  // 사이트맵
  const smFile = join(ROOT, 'sitemap.xml');
  try {
    let sm = await readFile(smFile, 'utf8');
    const snl = sm.includes('\r\n') ? '\r\n' : '\n';
    const urls = [`${BASE}reports.html`, ...ids.map((id) => `${BASE}reports/${id}.html`)]
      .map((u) => `  <url>${snl}    <loc>${u}</loc>${snl}    <lastmod>${today}</lastmod>${snl}    <changefreq>weekly</changefreq>${snl}    <priority>0.6</priority>${snl}  </url>`).join(snl);
    const block = `  <!-- AUTO-REPORTS:START -->${snl}${urls}${snl}  <!-- AUTO-REPORTS:END -->`;
    const rx = /  <!-- AUTO-REPORTS:START -->[\s\S]*?<!-- AUTO-REPORTS:END -->/;
    sm = rx.test(sm) ? sm.replace(rx, block) : sm.replace('</urlset>', `${block}${snl}</urlset>`);
    await writeFile(smFile, sm);
  } catch { /* 사이트맵이 없으면 건너뜀 */ }
  report.ok.push(`주간 리포트 ${wk.id}`);
}

/* ---------- 실행 ---------- */
let serverIds = ['cain', 'diregie', 'siroco', 'prey', 'casillas', 'hilder', 'anton', 'bakal'];
try { serverIds = await collectServers(); } catch (e) { report.failed.push(`서버 목록: ${e.message}`); }
for (const [label, job] of [['경매장', collectAuction], ['명성', () => collectFame(serverIds)], ['트렌드', collectTrends], ['직업', collectJobs], ['아바타', collectAvatar]]) {
  try { await job(); } catch (e) { report.failed.push(`${label}: ${e.message}`); }
}
try { await writeBrief(); } catch (e) { report.failed.push('브리핑: ' + e.message); }
try { await writeJobPages(); } catch (e) { report.failed.push('직업 페이지: ' + e.message); }
try { await writeWeeklyReport(); } catch (e) { report.failed.push('주간 리포트: ' + e.message); }
await writeJSON('data/meta.json', { updatedAt });

console.log('수집 완료:', report.ok.join(' / ') || '없음');
if (report.failed.length) {
  console.log('실패:\n - ' + report.failed.join('\n - '));
  if (!report.ok.length) process.exit(1);
}
