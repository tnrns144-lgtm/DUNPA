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
    const items = [];
    for (const name of cat.items || []) {
      try {
        const data = await call('/df/auction-sold', { itemName: name, wordType: 'match', limit: 100 });
        const rows = (data.rows || []).filter((r) => r.unitPrice > 0);
        if (!rows.length) { missing.push(name); continue; }
        // 최근 24시간 거래 우선, 없으면 받은 거래 전체로 계산
        const recent = rows.filter((r) => new Date(String(r.soldDate).replace(' ', 'T') + '+09:00').getTime() >= dayAgo);
        const base = recent.length ? recent : rows;
        const qty = base.reduce((s, r) => s + (r.count || 1), 0);
        const avg = base.reduce((s, r) => s + r.unitPrice * (r.count || 1), 0) / qty;
        const prev = history[yesterday]?.[name];
        history[today][name] = Math.round(avg);
        items.push({
          itemId: rows[0].itemId,
          itemName: rows[0].itemName || name,
          itemRarity: rows[0].itemRarity,
          itemType: rows[0].itemTypeDetail || rows[0].itemType,
          avgPrice: Math.round(avg),
          minPrice: Math.min(...base.map((r) => r.unitPrice)),
          volume: qty,
          prevAvg: prev ?? null,
          changePct: prev ? ((avg - prev) / prev) * 100 : null
        });
      } catch (e) {
        missing.push(name);
        report.failed.push(`경매장 ${name}: ${e.message}`);
      }
    }
    categories.push({ id: cat.id, name: cat.name, items });
  }

  // 30일치만 보관
  const keep = Object.keys(history).sort().slice(-30);
  const trimmed = Object.fromEntries(keep.map((k) => [k, history[k]]));
  await writeJSON('data/history/auction-daily.json', trimmed);
  await writeJSON('data/auction.json', { updatedAt, categories, missing });
  report.ok.push(`경매장 시세 ${categories.reduce((s, c) => s + c.items.length, 0)}개 (거래 없음: ${missing.length}개)`);
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

/* ---------- 아바타 마켓 최근 거래 ---------- */
async function collectAvatar() {
  const data = await call('/df/avatar-market/sold', { limit: 24 });
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
for (const [label, job] of [['경매장', collectAuction], ['명성', () => collectFame(serverIds)], ['아바타', collectAvatar]]) {
  try { await job(); } catch (e) { report.failed.push(`${label}: ${e.message}`); }
}
await writeJSON('data/meta.json', { updatedAt });

console.log('수집 완료:', report.ok.join(' / ') || '없음');
if (report.failed.length) {
  console.log('실패:\n - ' + report.failed.join('\n - '));
  if (!report.ok.length) process.exit(1);
}
