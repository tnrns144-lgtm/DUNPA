/* 캐릭터 페이지: 검색 결과 → 상세(기본 정보, 장비, 아바타, 크리쳐, 능력치). Worker를 통해 실시간 조회 */
(function () {
  const D = window.DNF;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const main = () => $('char-main');

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('search-form');
    D.bindSearchForm(form);
    if (params.get('server')) form.querySelector('[name="server"]').value = params.get('server');
    if (params.get('name')) form.querySelector('[name="name"]').value = params.get('name');
    renderRecent();

    if (params.get('id') && params.get('server')) showDetail(params.get('server'), params.get('id'));
    else if (params.get('name')) showSearch(params.get('server') || 'all', params.get('name'));
  });

  function renderRecent() {
    const list = D.getRecent();
    $('recent-list').innerHTML = list.length
      ? list.slice(0, 8).map((r) => `<li><a href="${D.characterLink(r.serverId, r.characterId)}"><span>${D.esc(r.characterName)}</span><small>${D.esc(D.serverName(r.serverId))}</small></a></li>`).join('')
      : '<li><span class="help" style="display:block;padding:8px 0">캐릭터를 검색하면 이 브라우저에 기록이 남아요.</span></li>';
  }

  function sectionHead(title, meta = '') {
    return `<div class="section-head"><h1>${D.esc(title)}</h1><span class="rule" aria-hidden="true"></span>${meta ? `<span class="meta">${D.esc(meta)}</span>` : ''}</div>`;
  }

  /* ---------- 검색 결과 ---------- */
  async function showSearch(server, name) {
    document.title = `${name} 검색 결과 · 던랩`;
    main().innerHTML = `<section class="section">${sectionHead(`"${name}" 검색 결과`)}<div class="panel loading">${D.emptyState('찾는 중이에요', '')}</div></section>`;
    try {
      const data = await D.api('search', { server, name });
      const rows = data.rows || [];
      if (!rows.length) {
        main().innerHTML = `<section class="section">${sectionHead(`"${name}" 검색 결과`)}<div class="panel">${D.emptyState('캐릭터를 찾지 못했어요', '이름을 정확히 입력했는지, 서버가 맞는지 확인해 주세요.')}</div></section>`;
        return;
      }
      main().innerHTML = `<section class="section">${sectionHead(`"${name}" 검색 결과`, `${rows.length}명`)}
        <div class="char-results">
          ${rows.map((r) => `
            <a class="char-card" href="${D.characterLink(r.serverId, r.characterId)}">
              <span class="char-portrait"><img src="${D.IMG.character(r.serverId, r.characterId, 1)}" alt="" loading="lazy"></span>
              <strong>${D.esc(r.characterName)}</strong>
              <small>${D.esc(D.serverName(r.serverId))} · Lv.${D.esc(r.level)}</small>
              <small>${D.esc(r.jobGrowName || r.jobName)}</small>
              ${r.fame ? `<span class="tag tag--gold">명성 ${D.num(r.fame)}</span>` : ''}
            </a>`).join('')}
        </div></section>`;
    } catch (err) {
      main().innerHTML = `<section class="section">${sectionHead(`"${name}" 검색 결과`)}<div class="panel">${D.apiErrorMessage(err)}</div></section>`;
    }
  }

  /* ---------- 상세 ---------- */
  const TABS = [
    { id: 'equipment', label: '장착 장비' },
    { id: 'avatar', label: '아바타' },
    { id: 'creature', label: '크리쳐' },
    { id: 'status', label: '능력치' }
  ];
  const cache = {};

  async function showDetail(server, id) {
    main().innerHTML = `<div class="panel loading">${D.emptyState('캐릭터 정보를 불러오는 중이에요', '')}</div>`;
    let basic;
    try {
      basic = await D.api('character', { server, id, part: 'basic' });
    } catch (err) {
      main().innerHTML = `<div class="panel">${D.apiErrorMessage(err)}</div>`;
      return;
    }
    document.title = `${basic.characterName} · 던랩`;
    D.addRecent({ serverId: server, characterId: id, characterName: basic.characterName });
    renderRecent();

    main().innerHTML = `
      <section class="panel char-head">
        <span class="char-portrait"><img src="${D.IMG.character(server, id, 2)}" alt="${D.esc(basic.characterName)} 캐릭터 이미지"></span>
        <div class="char-head-info">
          <h1>${D.esc(basic.characterName)}</h1>
          <div class="char-meta">
            <span class="tag">${D.esc(D.serverName(server))}</span>
            <span class="tag">Lv.${D.esc(basic.level)}</span>
            <span class="tag">${D.esc(basic.jobGrowName || basic.jobName)}</span>
            ${basic.fame ? `<span class="tag tag--gold">명성 ${D.num(basic.fame)}</span>` : ''}
          </div>
          <p class="help">${basic.adventureName ? `모험단 ${D.esc(basic.adventureName)}` : ''}${basic.guildName ? ` · 길드 ${D.esc(basic.guildName)}` : ''}</p>
        </div>
      </section>
      <section class="panel panel--pad report" id="report" aria-live="polite"></section>
      <section class="section" style="gap:0">
        <div class="tabs" role="tablist" aria-label="캐릭터 정보">
          ${TABS.map((t, i) => `<button type="button" class="tab" role="tab" id="tab-${t.id}" aria-controls="panel" aria-selected="${i === 0}" data-tab="${t.id}">${t.label}</button>`).join('')}
        </div>
        <div class="tab-panel" id="panel" role="tabpanel" aria-labelledby="tab-equipment"></div>
      </section>
      <div class="ad-slot ad-bottom" data-ad="bottom" data-label="광고 영역 · 본문 하단 가로 배너"></div>`;
    D.initAds();

    const tablist = main().querySelector('.tabs');
    tablist.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab]');
      if (!btn) return;
      tablist.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      $('panel').setAttribute('aria-labelledby', btn.id);
      loadTab(server, id, btn.dataset.tab);
    });
    loadTab(server, id, 'equipment');
    renderReport(server, id, basic);
  }

  // 같은 정보를 탭과 연구 보고서가 함께 쓰므로 한 번만 조회해요 (실패하면 다음에 다시 시도)
  function getPart(server, id, part) {
    const key = `${server}/${id}/${part}`;
    if (!cache[key]) cache[key] = D.api('character', { server, id, part }).catch((err) => { delete cache[key]; throw err; });
    return cache[key];
  }

  async function loadTab(server, id, part) {
    const panel = $('panel');
    panel.innerHTML = `<div class="panel loading">${D.emptyState('불러오는 중이에요', '')}</div>`;
    try {
      panel.innerHTML = RENDER[part](await getPart(server, id, part));
    } catch (err) {
      panel.innerHTML = `<div class="panel">${D.apiErrorMessage(err)}</div>`;
    }
  }

  /* ---------- 캐릭터 연구 보고서: 랭커 데이터와 비교 ---------- */
  const isSlot = (s, slotId, name) => s.slotId === slotId || s.slotName === name;
  // 수집 스크립트와 같은 기준: 겉모습 클론이 있으면 클론, 이름 없는 공용 클론이면 원래 아바타
  const look = (a) => (a.clone && a.clone.itemName && !/클론 아바타/.test(a.clone.itemName) ? a.clone : a);

  function judgeSlot(key, label, item, trends) {
    const sample = trends?.sample || 0;
    const top = trends?.[key] || [];
    const counts = trends?.counts?.[key] || Object.fromEntries(top.map((t) => [t.itemName, t.count]));
    const leader = top[0];
    const leaderText = leader ? `랭커 1위: ${leader.itemName} (${sample ? Math.round(leader.count / sample * 100) : 0}%)` : '';
    if (!item || !item.itemName) {
      return { label, item: null, verdict: '장착 안 함', grade: 'low', score: 0, sub: leaderText };
    }
    const n = counts[item.itemName] || 0;
    const pct = sample ? Math.round(n / sample * 100) : 0;
    const rank = top.findIndex((t) => t.itemName === item.itemName) + 1;
    if (rank === 1) return { label, item, verdict: '랭커 1위 선택과 같음', grade: 'best', score: 1, sub: `랭커 ${pct}%가 사용` };
    if (rank > 1) return { label, item, verdict: `랭커 인기 ${rank}위`, grade: 'good', score: 0.85, sub: `랭커 ${pct}%가 사용 · ${leaderText}` };
    if (n > 0) return { label, item, verdict: '희귀한 선택', grade: 'mid', score: 0.5, sub: `랭커 ${n}명만 사용 · ${leaderText}` };
    return { label, item, verdict: trends?.counts ? '랭커 사용 기록 없음' : '랭커 TOP 10 밖', grade: 'mid', score: 0.25, sub: leaderText };
  }

  function famePosition(basic, server, fame) {
    const all = [...(fame?.all || [])].sort((a, b) => b.fame - a.fame);
    const srv = [...((fame?.byServer || {})[server] || [])].sort((a, b) => b.fame - a.fame);
    const my = Number(basic.fame) || 0;
    if (!my || !all.length) return { verdict: '명성 정보 없음', grade: 'low', sub: '' };
    const lowest = all[all.length - 1].fame;
    const srvText = srv.length && my >= srv[srv.length - 1].fame
      ? `${D.serverName(server)} 서버 약 ${srv.filter((r) => r.fame > my).length + 1}위`
      : '';
    if (my >= lowest) {
      const rank = all.filter((r) => r.fame > my).length + 1;
      return { verdict: `전체 서버 약 ${rank}위`, grade: rank <= 10 ? 'best' : 'good', sub: srvText || '명성 랭킹 안' };
    }
    const pct = Math.floor(my / lowest * 100);
    return {
      verdict: `랭커 기준선의 ${pct}%`, grade: pct >= 90 ? 'good' : pct >= 70 ? 'mid' : 'low',
      sub: [srvText, `기준선 = 랭킹 커트라인 명성 ${D.num(lowest)}`].filter(Boolean).join(' · ')
    };
  }

  function jobPosition(basic, fame) {
    const all = fame?.all || [];
    const job = basic.jobGrowName || basic.jobName;
    if (!all.length || !job) return { verdict: '-', grade: 'low', sub: '' };
    const counts = new Map();
    all.forEach((r) => { const j = r.jobGrowName || r.jobName; if (j) counts.set(j, (counts.get(j) || 0) + 1); });
    const n = counts.get(job) || 0;
    if (!n) return { verdict: '랭커 중 없음', grade: 'mid', sub: '랭커 중에 같은 직업이 없는 희귀 직업이에요' };
    const rank = [...counts.values()].filter((v) => v > n).length + 1;
    return { verdict: `직업 점유 ${rank}위`, grade: rank <= 3 ? 'best' : 'good', sub: `랭커 중 같은 직업 ${n}명` };
  }

  function syncComment(p) {
    if (p >= 80) return '랭커 세팅과 거의 같아요';
    if (p >= 55) return '랭커와 취향이 비슷해요';
    if (p >= 30) return '개성 있는 세팅이에요';
    return '나만의 길을 연구 중이에요';
  }

  async function renderReport(server, id, basic) {
    const el = $('report');
    if (!el) return;
    el.innerHTML = `<div class="report-head"><h2 class="side-title">캐릭터 연구 보고서</h2><span class="lab-code">ANALYZING…</span></div>${D.emptyState('랭커 데이터와 비교하는 중이에요', '')}`;
    const safe = (p) => p.catch(() => null);
    const [trends, fame, eq, av, cr] = await Promise.all([
      safe(D.getJSON('data/trends.json')), safe(D.getJSON('data/fame.json')),
      safe(getPart(server, id, 'equipment')), safe(getPart(server, id, 'avatar')), safe(getPart(server, id, 'creature'))
    ]);
    if (!trends) {
      el.innerHTML = `<div class="report-head"><h2 class="side-title">캐릭터 연구 보고서</h2></div>${D.emptyState('랭커 데이터를 준비 중이에요', '하루 한 번 모으는 랭커 트렌드가 생기면 비교 결과가 나와요.')}`;
      return;
    }
    const avatars = av?.avatar || [];
    const aura = avatars.find((a) => isSlot(a, 'AURORA', '오라'));
    const weapon = avatars.find((a) => isSlot(a, 'WEAPON', '무기'));
    const slots = [
      judgeSlot('title', '칭호', (eq?.equipment || []).find((e) => isSlot(e, 'TITLE', '칭호')), trends),
      judgeSlot('creature', '크리쳐', cr?.creature, trends),
      judgeSlot('aura', '오라', aura && look(aura), trends),
      judgeSlot('weapon', '무기 아바타', weapon && look(weapon), trends)
    ];
    const sync = Math.round(slots.reduce((s, r) => s + r.score, 0) / slots.length * 100);
    const famePos = famePosition(basic, server, fame);
    const jobPos = jobPosition(basic, fame);
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' });

    const row = (label, main, r) => `
      <div class="report-row grade-${r.grade}">
        <span class="report-label">${D.esc(label)}</span>
        <div class="report-main">${main}${r.sub ? `<small>${D.esc(r.sub)}</small>` : ''}</div>
        <span class="report-verdict">${D.esc(r.verdict)}</span>
      </div>`;
    const itemMain = (it) => it
      ? `<span class="item-cell" style="${D.rarityStyle(it.itemRarity)}"><span class="item-icon">${it.itemId ? `<img src="${D.IMG.item(it.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span><span class="item-name">${D.esc(it.itemName)}</span></span>`
      : '<span class="report-empty">없음</span>';

    el.innerHTML = `
      <div class="report-head">
        <h2 class="side-title">캐릭터 연구 보고서</h2>
        <span class="lab-code">REPORT #${D.esc(id.slice(0, 6).toUpperCase())}</span>
        <span class="report-date">${D.esc(today)} · 랭커 ${D.num(trends.sample || 0)}명 표본</span>
        <a class="chip report-link" href="lab.html?server=${encodeURIComponent(server)}&id=${encodeURIComponent(id)}#fame-calc">명성 계산기로 분석 ›</a>
      </div>
      <div class="report-body">
        <div class="sync-box">
          <span class="sync-label">랭커 싱크로율</span>
          <span class="sync-value">${sync}<small>%</small></span>
          <span class="sync-bar" aria-hidden="true"><span style="width:${sync}%"></span></span>
          <span class="sync-comment">${syncComment(sync)}</span>
          <span class="help">칭호·크리쳐·오라·무기 아바타가 랭커들의 선택과 얼마나 비슷한지 계산했어요.</span>
        </div>
        <div class="report-rows">
          ${row('명성', `<strong class="report-num">${D.num(basic.fame || 0)}</strong>`, famePos)}
          ${row('직업', `<strong>${D.esc(basic.jobGrowName || basic.jobName || '-')}</strong>`, jobPos)}
          ${slots.map((s) => row(s.label, itemMain(s.item), s)).join('')}
        </div>
      </div>`;
  }

  function itemIcon(itemId, rarity) {
    return `<span class="item-icon" style="${D.rarityStyle(rarity)}">${itemId ? `<img src="${D.IMG.item(itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>`;
  }

  const RENDER = {
    equipment(data) {
      const list = data.equipment || [];
      if (!list.length) return `<div class="panel">${D.emptyState('장착한 장비가 없어요', '')}</div>`;
      return `<div class="slot-grid">${list.map((e) => {
        const extra = [
          e.reinforce ? `+${e.reinforce}${e.amplificationName ? ' 증폭' : ' 강화'}` : '',
          e.refine ? `제련 ${e.refine}` : '',
          e.itemGradeName ? `${e.itemGradeName}` : ''
        ].filter(Boolean).join(' · ');
        return `<div class="slot" style="${D.rarityStyle(e.itemRarity)}">
          ${itemIcon(e.itemId, e.itemRarity)}
          <div class="slot-body">
            <small>${D.esc(e.slotName)}</small>
            <span class="item-name">${D.esc(e.itemName)}</span>
            ${extra ? `<span class="slot-extra">${D.esc(extra)}</span>` : ''}
            ${e.setItemName ? `<span class="slot-extra">${D.esc(e.setItemName)}</span>` : ''}
          </div>
        </div>`;
      }).join('')}</div>`;
    },

    avatar(data) {
      const list = data.avatar || [];
      if (!list.length) return `<div class="panel">${D.emptyState('장착한 아바타가 없어요', '')}</div>`;
      return `<div class="slot-grid">${list.map((a) => `
        <div class="slot" style="${D.rarityStyle(a.itemRarity)}">
          ${itemIcon(a.itemId, a.itemRarity)}
          <div class="slot-body">
            <small>${D.esc(a.slotName)}</small>
            <span class="item-name">${D.esc(a.itemName)}</span>
            ${a.clone && a.clone.itemName ? `<span class="slot-extra">클론: ${D.esc(a.clone.itemName)}</span>` : ''}
            ${a.optionAbility ? `<span class="slot-extra">${D.esc(a.optionAbility)}</span>` : ''}
            ${(a.emblems || []).length ? `<span class="slot-extra">엠블렘: ${a.emblems.map((m) => D.esc(m.itemName)).join(', ')}</span>` : ''}
          </div>
        </div>`).join('')}</div>`;
    },

    creature(data) {
      const c = data.creature;
      if (!c || !c.itemName) return `<div class="panel">${D.emptyState('장착한 크리쳐가 없어요', '')}</div>`;
      const artifacts = c.artifact || [];
      return `<div class="slot-grid">
        <div class="slot" style="${D.rarityStyle(c.itemRarity)}">
          ${itemIcon(c.itemId, c.itemRarity)}
          <div class="slot-body"><small>크리쳐</small><span class="item-name">${D.esc(c.itemName)}</span></div>
        </div>
        ${artifacts.map((a) => `
          <div class="slot" style="${D.rarityStyle(a.itemRarity)}">
            ${itemIcon(a.itemId, a.itemRarity)}
            <div class="slot-body"><small>${D.esc(a.slotColor ? a.slotColor + ' 아티팩트' : '아티팩트')}</small><span class="item-name">${D.esc(a.itemName)}</span></div>
          </div>`).join('')}
      </div>`;
    },

    status(data) {
      const list = data.status || [];
      if (!list.length) return `<div class="panel">${D.emptyState('능력치 정보가 없어요', '')}</div>`;
      return `<div class="panel panel--pad"><div class="stat-grid">${list.map((s) => `
        <div class="stat-row"><span>${D.esc(s.name)}</span><span>${typeof s.value === 'number' ? D.num(s.value) : D.esc(s.value)}</span></div>`).join('')}
      </div></div>`;
    }
  };
})();
