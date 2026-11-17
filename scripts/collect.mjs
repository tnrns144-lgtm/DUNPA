// 던파노트 데이터 수집 스크립트
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

  // 30일치만 보관
  const keep = Object.keys(history).sort().slice(-30);
  const trimmed = Object.fromEntries(keep.map((k) => [k, history[k]]));
  await writeJSON('data/history/auction-daily.json', trimmed);
  await writeJSON('data/auction.json', { updatedAt, categories, missing });
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
  const add = (key, item) => {
    if (!item || !item.itemName) return;
    const map = counters[key];
    const cur = map.get(item.itemName) || { itemId: item.itemId || '', itemName: item.itemName, itemRarity: item.itemRarity || '', count: 0 };
    cur.count++;
    map.set(item.itemName, cur);
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

  const top = (map) => [...map.values()].sort((a, b) => b.count - a.count).slice(0, 10);
  await writeJSON('data/trends.json', {
    updatedAt, sample,
    title: top(counters.title), creature: top(counters.creature),
    aura: top(counters.aura), weapon: top(counters.weapon)
  });
  report.ok.push(`랭커 트렌드 ${sample}명`);
  if (failed) report.failed.push(`랭커 트렌드 조회 실패 ${failed}명`);
}

/* ---------- 아바타 마켓 최근 거래 ---------- */
async function collectAvatar() {
  // 최근 거래부터 받기 (정렬 조건이 거부되면 기본 순서로 다시 받기)
  let data;
  try {
    data = await call('/df/avatar-market/sold', { limit: 50, sort: 'goodsNo:desc' });
  } catch (e) {
    report.failed.push(`아바타 정렬: ${e.message}`);
    data = await call('/df/avatar-market/sold', { limit: 50 });
  }
  // 받은 결과도 거래일 최신순으로 한 번 더 정렬
  data.rows = (data.rows || []).sort((a, b) => String(b.soldDate).localeCompare(String(a.soldDate)) || (b.goodsNo - a.goodsNo)).slice(0, 24);
  const rows = (data.rows || []).map((r) => ({
    goodsNo: r.goodsNo,
    title: r.title,
    price: r.price,
    jobName: (r.jobs && r.jobs[0] && r.jobs[0].jobName) || r.jobName || '',
    avatarRarity: r.avatarRarity || '',
    soldDate: r.soldDate,
    itemIds: (r.avatar || []).map((a) => a.itemId).filter(Boolean)
  }));
  await writeJSON('data/avatar.json', { updatedAt, rows });
  report.ok.push(`아바타 마켓 ${rows.length}건`);
}

/* ---------- 실행 ---------- */
let serverIds = ['cain', 'diregie', 'siroco', 'prey', 'casillas', 'hilder', 'anton', 'bakal'];
try { serverIds = await collectServers(); } catch (e) { report.failed.push(`서버 목록: ${e.message}`); }
for (const [label, job] of [['경매장', collectAuction], ['명성', () => collectFame(serverIds)], ['트렌드', collectTrends], ['아바타', collectAvatar]]) {
  try { await job(); } catch (e) { report.failed.push(`${label}: ${e.message}`); }
}
await writeJSON('data/meta.json', { updatedAt });

console.log('수집 완료:', report.ok.join(' / ') || '없음');
if (report.failed.length) {
  console.log('실패:\n - ' + report.failed.join('\n - '));
  if (!report.ok.length) process.exit(1);
}
