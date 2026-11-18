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
  }

  async function loadTab(server, id, part) {
    const panel = $('panel');
    panel.innerHTML = `<div class="panel loading">${D.emptyState('불러오는 중이에요', '')}</div>`;
    try {
      const key = `${server}/${id}/${part}`;
      cache[key] = cache[key] || await D.api('character', { server, id, part });
      panel.innerHTML = RENDER[part](cache[key]);
    } catch (err) {
      panel.innerHTML = `<div class="panel">${D.apiErrorMessage(err)}</div>`;
    }
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
