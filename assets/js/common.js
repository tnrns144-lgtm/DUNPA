/* 던파랩 공통 기능: 데이터 불러오기, 숫자 표시, 등급색, 최근 검색, 광고 */
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

  /* ----- 아이템 상세 팝업: 아이템 아이콘을 누르면 게임 툴팁처럼 옆에 스펙이 나와요 ----- */
  // 사이트 어디든 img-api 아이템 이미지면 동작해요. 정보는 Worker의 'item' 경로(하루 캐시)로 받아요.
  const tipCache = {};
  let tipEl = null;
  let tipFor = null;

  function closeTip() {
    if (tipEl) tipEl.remove();
    tipEl = null;
    tipFor = null;
  }

  function tipHtml(d) {
    const status = (d.itemStatus || []).filter((s) => s && s.name);
    const explain = d.itemExplainDetail || d.itemExplain || '';
    return `
      <div class="tip-head">
        <span class="item-icon"><img src="${IMG.item(d.itemId)}" alt="" width="28" height="28"></span>
        <div class="tip-title">
          <strong class="item-name">${esc(d.itemName)}</strong>
          <small>${esc(d.itemRarity || '')}${d.itemTypeDetail || d.itemType ? ` · ${esc(d.itemTypeDetail || d.itemType)}` : ''}</small>
        </div>
        <button type="button" class="tip-close" aria-label="닫기">×</button>
      </div>
      <div class="tip-body">
        ${d.itemAvailableLevel ? `<p class="tip-line"><span>착용 레벨</span><b>Lv.${esc(d.itemAvailableLevel)}</b></p>` : ''}
        ${typeof d.fame === 'number' && d.fame ? `<p class="tip-line"><span>모험가 명성</span><b>${num(d.fame)}</b></p>` : ''}
        ${status.length ? `<dl class="tip-stats">${status.filter((s) => !/명성/.test(s.name)).map((s) => `<div><dt>${esc(s.name)}</dt><dd>${esc(typeof s.value === 'number' ? num(s.value) : s.value)}</dd></div>`).join('')}</dl>` : ''}
        ${d.setItemName ? `<p class="tip-set">${esc(d.setItemName)}</p>` : ''}
        ${explain ? `<p class="tip-explain">${esc(explain)}</p>` : ''}
        ${d.itemFlavorText ? `<p class="tip-flavor">${esc(d.itemFlavorText)}</p>` : ''}
      </div>
      <p class="tip-foot">아이템 기본 정보예요. 강화·마법부여 등 캐릭터별 수치는 포함되지 않아요.</p>`;
  }

  // 아이콘 오른쪽에 띄우고, 화면 밖으로 나가면 왼쪽·위로 옮겨요. 좁은 화면에서는 아래쪽에 고정
  function placeTip(anchor) {
    if (!tipEl) return;
    if (window.innerWidth < 640) { tipEl.classList.add('tip--sheet'); return; }
    tipEl.classList.remove('tip--sheet');
    const r = anchor.getBoundingClientRect();
    const w = tipEl.offsetWidth;
    const h = tipEl.offsetHeight;
    let left = r.right + 10;
    if (left + w > window.innerWidth - 12) left = Math.max(12, r.left - w - 10);
    let top = r.top;
    if (top + h > window.innerHeight - 12) top = Math.max(12, window.innerHeight - h - 12);
    tipEl.style.left = `${Math.round(left)}px`;
    tipEl.style.top = `${Math.round(top)}px`;
  }

  async function openTip(img) {
    const m = img.src.match(/\/df\/items\/([0-9a-f]{32})/i);
    if (!m) return;
    const id = m[1];
    if (tipFor === img) { closeTip(); return; }
    closeTip();
    tipFor = img;
    tipEl = document.createElement('div');
    tipEl.className = 'item-tip';
    tipEl.setAttribute('role', 'dialog');
    tipEl.setAttribute('aria-label', '아이템 상세 정보');
    tipEl.innerHTML = '<p class="tip-loading">아이템 정보를 불러오는 중이에요…</p>';
    document.body.appendChild(tipEl);
    placeTip(img);
    try {
      if (!tipCache[id]) tipCache[id] = api('item', { id }).catch((err) => { delete tipCache[id]; throw err; });
      const d = await tipCache[id];
      if (tipFor !== img || !tipEl) return; // 그새 다른 아이콘을 눌렀으면 무시
      tipEl.innerHTML = tipHtml(d);
      const rs = rarityStyle(d.itemRarity);
      if (rs) tipEl.setAttribute('style', rs);
      placeTip(img);
    } catch (err) {
      if (tipEl && tipFor === img) { tipEl.innerHTML = `<p class="tip-loading">${esc(err.message || '정보를 불러오지 못했어요')}</p>`; placeTip(img); }
    }
  }

  function bindItemTips() {
    // 아이콘이 있는 줄 자체가 눌리는 곳(시세 그래프·랭커 갤러리 등)보다 먼저 받아서, 아이콘 클릭은 팝업만 열어요
    document.addEventListener('click', (e) => {
      if (tipEl && tipEl.contains(e.target)) {
        if (e.target.closest('.tip-close')) closeTip();
        return;
      }
      const img = e.target.closest && e.target.closest('img');
      if (img && /img-api\.neople\.co\.kr\/df\/items\//.test(img.src)) {
        e.preventDefault();
        e.stopPropagation();
        openTip(img);
        return;
      }
      if (tipEl) closeTip();
    }, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeTip(); });
    window.addEventListener('scroll', () => { if (tipEl && tipFor && !tipEl.classList.contains('tip--sheet')) placeTip(tipFor); }, { passive: true });
    window.addEventListener('resize', () => { if (tipEl && tipFor) placeTip(tipFor); });
  }

  /* ----- 3D 장면: 히어로 배경을 여러 겹(하늘·먼 마을·연구소·앞 가로등)으로 깔고 마우스·스크롤에 따라 겹마다 다르게 움직여요 ----- */
  const SCENE_LAYERS = [
    { cls: 'l-sky', depth: 6 }, { cls: 'l-far', depth: 14 }, { cls: 'l-mid', depth: 26 }, { cls: 'l-front', depth: 44 }
  ];
  function addHeroScene() {
    const hero = document.querySelector('.hero');
    if (!hero || hero.querySelector('.hero-scene')) return;
    const scene = document.createElement('div');
    scene.className = 'hero-scene';
    scene.setAttribute('aria-hidden', 'true');
    scene.innerHTML = SCENE_LAYERS.map((l) => `<div class="scene-layer ${l.cls}"></div>`).join('');
    hero.prepend(scene);
    hero.classList.add('hero--scene');
    const layers = [...scene.children];
    let mx = 0, my = 0, ticking = false;
    const apply = () => {
      ticking = false;
      const rect = hero.getBoundingClientRect();
      if (rect.bottom < 0) return; // 화면 밖이면 계산 안 함
      const sy = Math.max(0, -rect.top);
      layers.forEach((el, i) => {
        const d = SCENE_LAYERS[i].depth;
        el.style.transform = `translate3d(${(-mx * d).toFixed(1)}px, ${(-my * d * 0.5 + sy * d * 0.012).toFixed(1)}px, 0) scale(${1 + d / 900})`;
      });
    };
    const request = () => { if (!ticking) { ticking = true; requestAnimationFrame(apply); } };
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType && e.pointerType !== 'mouse') return;
      mx = (e.clientX / window.innerWidth) * 2 - 1;
      my = (e.clientY / window.innerHeight) * 2 - 1;
      request();
    }, { passive: true });
    window.addEventListener('scroll', request, { passive: true });
    apply();
  }

  // 카드에 마우스를 올리면 살짝 기울어지는 입체 효과 (마우스에서만)
  const TILT = '.podium-card, .job-card, .look-card, .brief-card, .market-card, .quick-link, .result-cell';
  function bindTilt() {
    let cur = null;
    const reset = (el) => { if (el) el.style.transform = ''; };
    document.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const card = e.target.closest && e.target.closest(TILT);
      if (card !== cur) { reset(cur); cur = card; }
      if (!card) return;
      const r = card.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width - 0.5;
      const ny = (e.clientY - r.top) / r.height - 0.5;
      const k = r.width > 500 ? 3 : 7; // 넓은 카드는 덜 기울게
      card.style.transform = `perspective(800px) rotateX(${(-ny * k).toFixed(2)}deg) rotateY(${(nx * k).toFixed(2)}deg) translateY(-3px)`;
    }, { passive: true });
    document.addEventListener('pointerleave', () => { reset(cur); cur = null; });
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
    addHeroScene();
    addRailAds();
    initAds();
    bindItemTips();
    bindTilt();
    document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = new Date().getFullYear(); });
  });
})();
