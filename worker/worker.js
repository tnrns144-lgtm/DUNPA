/**
 * 던랩 실시간 조회 중계 서버 (Cloudflare Workers, 무료)
 * ------------------------------------------------------------
 * 브라우저에 API 키가 노출되지 않도록, 사이트는 이 Worker에 요청하고
 * Worker가 키를 붙여 네오플 API에 대신 물어봐요.
 *
 * 필요한 설정 (Cloudflare 대시보드 → Worker → Settings → Variables and Secrets)
 *   NEOPLE_API_KEY  (Secret)  : 네오플에서 발급받은 API 키
 *   ALLOWED_ORIGIN  (Text)    : 사이트 주소. 예) https://계정이름.github.io  (여러 개면 쉼표로 구분)
 *
 * 제공하는 주소
 *   /search?server=all&name=캐릭터명
 *   /character?server=cain&id=캐릭터ID&part=basic|equipment|avatar|creature|status
 *   /items?name=아이템명
 *   /item?id=아이템ID
 */

const API = 'https://api.neople.co.kr';
const SERVERS = new Set(['all', 'cain', 'diregie', 'siroco', 'prey', 'casillas', 'hilder', 'anton', 'bakal']);
const PARTS = {
  basic: '',
  equipment: '/equip/equipment',
  avatar: '/equip/avatar',
  creature: '/equip/creature',
  status: '/status'
};
const ID_RE = /^[0-9a-f]{32}$/i;
const CACHE_SECONDS = { search: 120, character: 120, items: 3600, item: 86400 };

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = !allowed.length || allowed.includes(origin) || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
  return {
    'Access-Control-Allow-Origin': ok ? (origin || '*') : allowed[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}

function json(body, status, headers, maxAge = 0) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
      ...headers
    }
  });
}

function fail(message, status, headers) {
  return json({ error: { message } }, status, headers);
}

function buildUpstream(route, q) {
  if (route === 'search') {
    const server = q.get('server') || 'all';
    const name = (q.get('name') || '').trim();
    if (!SERVERS.has(server)) return { error: '서버 값이 올바르지 않아요.' };
    if (!name || name.length > 20) return { error: '캐릭터 이름을 확인해 주세요.' };
    return { path: `/df/servers/${server}/characters`, params: { characterName: name, wordType: 'match', limit: 30 } };
  }
  if (route === 'character') {
    const server = q.get('server');
    const id = q.get('id') || '';
    const part = q.get('part') || 'basic';
    if (!SERVERS.has(server) || server === 'all') return { error: '서버 값이 올바르지 않아요.' };
    if (!ID_RE.test(id)) return { error: '캐릭터 ID가 올바르지 않아요.' };
    if (!(part in PARTS)) return { error: '조회 항목이 올바르지 않아요.' };
    return { path: `/df/servers/${server}/characters/${id}${PARTS[part]}`, params: {} };
  }
  if (route === 'items') {
    const name = (q.get('name') || '').trim();
    if (!name || name.length > 30) return { error: '아이템 이름을 확인해 주세요.' };
    return { path: '/df/items', params: { itemName: name, wordType: 'front', limit: 30 } };
  }
  if (route === 'item') {
    const id = q.get('id') || '';
    if (!ID_RE.test(id)) return { error: '아이템 ID가 올바르지 않아요.' };
    return { path: `/df/items/${id}`, params: {} };
  }
  return null;
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return fail('GET 요청만 받아요.', 405, cors);
    if (!env.NEOPLE_API_KEY) return fail('서버에 API 키가 설정되지 않았어요.', 500, cors);

    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/+|\/+$/g, '');
    if (route === '' || route === 'health') return json({ ok: true }, 200, cors);

    const target = buildUpstream(route, url.searchParams);
    if (!target) return fail('없는 주소예요.', 404, cors);
    if (target.error) return fail(target.error, 400, cors);

    const upstream = new URL(target.path, API);
    Object.entries(target.params).forEach(([k, v]) => upstream.searchParams.set(k, String(v)));
    const maxAge = CACHE_SECONDS[route] || 60;

    // 키가 빠진 주소로 캐시해서 같은 요청은 네오플에 다시 묻지 않아요
    const cacheKey = new Request(upstream.toString(), { method: 'GET' });
    const cache = caches.default;
    let res = await cache.match(cacheKey);
    if (!res) {
      upstream.searchParams.set('apikey', env.NEOPLE_API_KEY);
      const r = await fetch(upstream.toString(), { headers: { Accept: 'application/json' } });
      const text = await r.text();
      if (!r.ok) {
        let message = '게임 서버에서 정보를 받지 못했어요.';
        if (r.status === 404) message = '찾는 정보가 없어요.';
        if (r.status === 503) message = '게임 점검 중이라 조회할 수 없어요.';
        if (r.status === 429) message = '요청이 많아 잠시 후 다시 시도해 주세요.';
        return fail(message, r.status === 404 ? 404 : 502, cors);
      }
      res = new Response(text, {
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` }
      });
      ctx.waitUntil(cache.put(cacheKey, res.clone()));
    }
    const body = await res.text();
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}`, ...cors }
    });
  }
};
