/* 던랩 공통 기능: 데이터 불러오기, 숫자 표시, 등급색, 최근 검색, 광고 */
(function () {
  const CFG = window.DNF_CONFIG || {};

  const SERVER_NAMES = {
    cain: '카인', diregie: '디레지에', siroco: '시로코', prey: '프레이',
    casillas: '카시야스', hilder: '힐더', anton: '안톤', bakal: '바칼'
  };

  const RARITY_VAR = {
    '커먼': '--rarity-common', '언커먼': '--rarity-uncommon', '레어': '--rarity-rare',
    '유니크': '--rarity-unique', '레전더리': '--rarity-legendary', '에픽': '--rarity-epic',
    '태초': '--rarity-primeval', '신화': '--rarity-mythic'
  };

  const IMG = {
    item: (id) => `https://img-api.neople.co.kr/df/items/${encodeURIComponent(id)}`,
    character: (serverId, characterId, zoom = 1) =>
      `https://img-api.neople.co.kr/df/servers/${encodeURIComponent(serverId)}/characters/${encodeURIComponent(characterId)}?zoom=${zoom}`
  };

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function num(n) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return '-';
    return Number(n).toLocaleString('ko-KR');
  }

  // 큰 금액을 "1억 2,345만" 형태로 읽기 쉽게
  function gold(n) {
    if (n === null || n === undefined) return '-';
    n = Math.round(Number(n));
    if (n >= 100000000) {
      const eok = Math.floor(n / 100000000);
      const man = Math.floor((n % 100000000) / 10000);
      return man ? `${eok}억 ${num(man)}만` : `${eok}억`;
    }
    if (n >= 10000) {
      const man = Math.floor(n / 10000);
      const rest = n % 10000;
      return rest ? `${num(man)}만 ${num(rest)}` : `${num(man)}만`;
    }
    return num(n);
  }

  function rarityStyle(rarity) {
    const v = RARITY_VAR[rarity];
    return v ? `--rc: var(${v})` : '';
  }

  function serverName(id) { return SERVER_NAMES[id] || id || ''; }

  function timeLabel(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  async function getJSON(path) {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  }

  // Cloudflare Worker를 통한 실시간 조회
  async function api(path, params = {}) {
    if (!CFG.workerUrl) {
      const err = new Error('workerUrl 미설정');
      err.code = 'NO_WORKER';
      throw err;
    }
    const url = new URL(path, CFG.workerUrl.replace(/\/?$/, '/'));
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') url.searchParams.set(k, v); });
    const res = await fetch(url.toString());
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body?.error?.message || `요청 실패 (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  function emptyState(title, text) {
    return `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;
  }

  function apiErrorMessage(err) {
    if (err && err.code === 'NO_WORKER') {
      return emptyState('실시간 조회 준비 중이에요', '캐릭터 검색 서버가 연결되면 바로 사용할 수 있어요.');
    }
    return emptyState('정보를 불러오지 못했어요', '잠시 후 다시 시도해 주세요. 게임 점검 중일 때도 조회가 안 될 수 있어요.');
  }

  /* ----- 최근 검색 (이 브라우저에만 저장) ----- */
  const RECENT_KEY = 'dnfnote.recent'; // 옛 이름이지만 바꾸면 방문자의 최근 검색 기록이 사라져서 그대로 둬요
  function getRecent() {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; }
  }
  function addRecent(entry) {
    try {
      const list = getRecent().filter((r) => !(r.serverId === entry.serverId && r.characterId === entry.characterId));
      list.unshift(entry);
      localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
    } catch (e) { /* 저장 불가 환경은 무시 */ }
  }

  function characterLink(serverId, characterId) {
    return `character.html?server=${encodeURIComponent(serverId)}&id=${encodeURIComponent(characterId)}`;
  }

  function fillServerSelect(select, includeAll = true) {
    if (!select) return;
    const opts = includeAll ? ['<option value="all">전체 서버</option>'] : [];
    Object.entries(SERVER_NAMES).forEach(([id, name]) => opts.push(`<option value="${id}">${name}</option>`));
    select.innerHTML = opts.join('');
  }

  /* ----- 광고 ----- */
  // 화면 양쪽 빈 공간의 세로 배너 (넓은 화면에서만 보여요). 모든 페이지에 자동으로 붙여요
  function addRailAds() {
    if (document.querySelector('.ad-rail')) return;
    ['left', 'right'].forEach((side) => {
      const el = document.createElement('div');
      el.className = `ad-slot ad-rail ad-rail--${side}`;
      el.dataset.ad = side === 'left' ? 'railLeft' : 'railRight';
      el.dataset.label = '광고 영역 · 세로 배너';
      el.setAttribute('aria-label', '광고');
      document.body.appendChild(el);
    });
    // 배경 그림(히어로) 아래에서 시작하고, 스크롤하면 위에 붙어 따라오다가 푸터 앞에서 멈춰요
    const place = () => {
      const rails = document.querySelectorAll('.ad-rail');
      if (!rails.length || getComputedStyle(rails[0]).display === 'none') return;
      const top0 = document.querySelector('.hero') || document.querySelector('.site-header');
      const foot = document.querySelector('.site-footer');
      const h = rails[0].offsetHeight;
      let top = Math.max(24, (top0 ? top0.getBoundingClientRect().bottom : 0) + 36);
      if (foot) top = Math.min(top, foot.getBoundingClientRect().top - 24 - h);
      rails.forEach((r) => { r.style.top = `${Math.round(top)}px`; });
    };
    window.addEventListener('scroll', place, { passive: true });
    window.addEventListener('resize', place);
    window.addEventListener('load', place);
    place();
  }

  function initAds() {
    const slots = document.querySelectorAll('[data-ad]');
    const client = CFG.adsenseClient;
    slots.forEach((el) => {
      const slotId = (CFG.adSlots || {})[el.dataset.ad];
      if (!client || !slotId) {
        el.classList.add('ad-slot--placeholder');
        el.textContent = el.dataset.label || '광고 영역';
        return;
      }
      el.innerHTML = `<ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="${esc(client)}" data-ad-slot="${esc(slotId)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    });
    if (client && document.querySelector('.adsbygoogle')) {
      const s = document.createElement('script');
      s.async = true;
      s.crossOrigin = 'anonymous';
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
      document.head.appendChild(s);
      document.querySelectorAll('.adsbygoogle').forEach(() => { (window.adsbygoogle = window.adsbygoogle || []).push({}); });
    }
  }

  /* ----- 검색 폼 공통 처리: 캐릭터 페이지로 이동 ----- */
  function bindSearchForm(form) {
    if (!form) return;
    fillServerSelect(form.querySelector('select[name="server"]'));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const server = form.querySelector('[name="server"]').value || 'all';
      const name = form.querySelector('[name="name"]').value.trim();
      if (!name) { form.querySelector('[name="name"]').focus(); return; }
      location.href = `character.html?server=${encodeURIComponent(server)}&name=${encodeURIComponent(name)}`;
    });
  }

  function renderRecentChips(container) {
    if (!container) return;
    const list = getRecent();
    if (!list.length) { container.innerHTML = '<span>검색한 캐릭터가 여기에 표시돼요</span>'; return; }
    container.innerHTML = '<span>최근 검색</span>' + list.slice(0, 5).map((r) =>
      `<a href="${characterLink(r.serverId, r.characterId)}">${esc(r.characterName)}</a>`).join('');
  }

  window.DNF = {
    CFG, SERVER_NAMES, IMG, esc, num, gold, rarityStyle, serverName, timeLabel,
    getJSON, api, emptyState, apiErrorMessage, getRecent, addRecent, characterLink,
    fillServerSelect, initAds, bindSearchForm, renderRecentChips
  };

  // 게임 이미지가 안 불러와지면 깨진 아이콘 대신 빈칸으로
  document.addEventListener('error', (e) => {
    const el = e.target;
    if (el && el.tagName === 'IMG') { el.style.visibility = 'hidden'; el.alt = ''; }
  }, true);

  document.addEventListener('DOMContentLoaded', () => {
    addRailAds();
    initAds();
    document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
  });
})();
