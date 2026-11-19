/*
 * 연구실: 명성 계산기
 * - 장착품마다 /df/items/{id}의 공식 기본 명성(fame)을 가져와 합산 (Worker 'item' 경로, 하루 캐시)
 * - 캐릭터 명성 − 기본 명성 합 = 강화·증폭·재련 등으로 붙은 명성(추정)
 * - 부위를 다른 아이템으로 바꾸면 '예상 명성 = 현재 명성 − 기존 기본 명성 + 새 기본 명성'
 */
(function () {
  const D = window.DNF;
  const $ = (id) => document.getElementById(id);
  const fameCache = {};
  let rows = [];        // { key, group, slot, item, fame, swap }
  let basic = null;

  document.addEventListener('DOMContentLoaded', () => {
    D.fillServerSelect($('fame-server'));
    $('fame-form').addEventListener('submit', (e) => { e.preventDefault(); find(); });
    $('fame-result').addEventListener('click', onClick);
    $('fame-result').addEventListener('submit', onSwapSearch);
    const p = new URLSearchParams(location.search);
    if (p.get('server') && p.get('id')) load(p.get('server'), p.get('id'));
  });

  // 아이템 기본 명성 (응답의 fame, 없으면 itemStatus의 '모험가 명성')
  async function fameOf(itemId) {
    if (!itemId) return 0;
    if (!(itemId in fameCache)) {
      fameCache[itemId] = D.api('item', { id: itemId }).then((d) => {
        if (typeof d.fame === 'number') return d.fame;
        const s = (d.itemStatus || []).find((x) => /명성/.test(x.name));
        return s ? Number(s.value) || 0 : 0;
      }).catch(() => null);
    }
    return fameCache[itemId];
  }

  async function find() {
    const server = $('fame-server').value;
    const name = $('fame-name').value.trim();
    if (!name) { $('fame-name').focus(); return; }
    $('fame-result').innerHTML = `<div class="panel loading">${D.emptyState('캐릭터를 찾는 중이에요', '')}</div>`;
    try {
      const data = await D.api('search', { server, name });
      const list = data.rows || [];
      const hit = list.find((r) => r.characterName === name) || list[0];
      if (!hit) { $('fame-result').innerHTML = `<div class="panel">${D.emptyState('캐릭터를 찾지 못했어요', '이름과 서버를 확인해 주세요.')}</div>`; return; }
      load(hit.serverId, hit.characterId);
    } catch (err) {
      $('fame-result').innerHTML = `<div class="panel">${D.apiErrorMessage(err)}</div>`;
    }
  }

  async function load(server, id) {
    $('fame-result').innerHTML = `<div class="panel loading">${D.emptyState('장착품 명성을 계산하는 중이에요', '아이템마다 공식 명성을 불러와요.')}</div>`;
    try {
      const part = (p) => D.api('character', { server, id, part: p });
      const [b, eq, av, cr] = await Promise.all([part('basic'), part('equipment'), part('avatar'), part('creature')]);
      basic = { ...b, serverId: server, characterId: id };
      rows = [];
      (eq.equipment || []).forEach((e) => rows.push({
        group: e.slotId === 'TITLE' ? '칭호' : '장비', slot: e.slotName, item: e,
        extra: [e.reinforce ? `+${e.reinforce}${e.amplificationName ? ' 증폭' : ' 강화'}` : '', e.refine ? `제련 ${e.refine}` : ''].filter(Boolean).join(' · ')
      }));
      const c = cr.creature;
      if (c && c.itemId) {
        rows.push({ group: '크리쳐', slot: '크리쳐', item: c });
        (c.artifact || []).forEach((a) => rows.push({ group: '크리쳐', slot: `${a.slotColor || ''} 아티팩트`.trim(), item: a }));
      }
      (av.avatar || []).forEach((a) => {
        rows.push({ group: '아바타', slot: a.slotName, item: a });
        (a.emblems || []).forEach((m) => { if (m.itemId) rows.push({ group: '아바타', slot: `${a.slotName} 엠블렘`, item: m }); });
      });
      rows.forEach((r, i) => { r.key = i; });
      // 동시에 너무 많이 부르지 않게 6개씩
      for (let i = 0; i < rows.length; i += 6) {
        await Promise.all(rows.slice(i, i + 6).map(async (r) => { r.fame = await fameOf(r.item.itemId); }));
      }
      history.replaceState(null, '', `lab.html?server=${encodeURIComponent(server)}&id=${encodeURIComponent(id)}#fame-calc`);
      render();
    } catch (err) {
      $('fame-result').innerHTML = `<div class="panel">${D.apiErrorMessage(err)}</div>`;
    }
  }

  const sum = (list, pick = (r) => r.fame || 0) => list.reduce((s, r) => s + pick(r), 0);

  function render() {
    const total = Number(basic.fame) || 0;
    const baseSum = sum(rows);
    const extra = total - baseSum;
    const swapped = rows.filter((r) => r.swap);
    const delta = sum(swapped, (r) => (r.swap.fame || 0) - (r.fame || 0));
    const missing = rows.filter((r) => r.fame === null).length;
    const groups = ['장비', '칭호', '크리쳐', '아바타'];

    $('fame-result').innerHTML = `
      <div class="panel panel--pad">
        <div class="report-head">
          <h3 class="side-title">${D.esc(basic.characterName)}</h3>
          <span class="lab-code">${D.esc(D.serverName(basic.serverId))} · ${D.esc(basic.jobGrowName || basic.jobName || '')}</span>
          <a class="report-date" href="${D.characterLink(basic.serverId, basic.characterId)}">캐릭터 상세 보기 ›</a>
        </div>
        <div class="result-grid">
          <div class="result-cell"><span>현재 명성</span><strong>${D.num(total)}</strong><small>게임에 표시되는 값</small></div>
          <div class="result-cell"><span>장착품 기본 명성 합</span><strong>${D.num(baseSum)}</strong><small>아이템 ${D.num(rows.length)}개 공식 값</small></div>
          <div class="result-cell"><span>그 외 명성</span><strong>${extra >= 0 ? '+' : ''}${D.num(extra)}</strong><small>강화·증폭·재련·기타 (현재 명성 − 기본 명성 합)</small></div>
          <div class="result-cell result-cost"><span>바꿔본 뒤 예상 명성</span><strong>${D.num(total + delta)}</strong>
            <small>${swapped.length ? `<span class="${delta >= 0 ? 'trend-up' : 'trend-down'}">${delta >= 0 ? '▲' : '▼'} ${D.num(Math.abs(delta))}</span> · ${swapped.length}부위 변경` : '아래에서 부위를 바꿔 보세요'}</small></div>
        </div>
        ${missing ? `<p class="help">${missing}개 아이템은 명성 정보를 불러오지 못해 0으로 계산했어요.</p>` : ''}
        ${swapped.length ? '<button type="button" class="chip" data-reset-all>모두 원래대로</button>' : ''}
      </div>
      ${groups.map((g) => {
        const list = rows.filter((r) => r.group === g);
        if (!list.length) return '';
        return `<div class="panel table-wrap">
          <table class="data-table fame-table">
            <thead><tr><th scope="col">${g}</th><th scope="col">아이템</th><th scope="col" class="num">기본 명성</th><th scope="col" class="num">바꿔보기</th></tr></thead>
            <tbody>${list.map(row).join('')}</tbody>
            <tfoot><tr><td colspan="2">${g} 합계</td><td class="num"><strong>${D.num(sum(list))}</strong></td><td></td></tr></tfoot>
          </table></div>`;
      }).join('')}
      <p class="help">기본 명성은 네오플 API의 아이템 정보 값이에요. 강화·증폭·재련·마법부여 등으로 붙는 명성은 공식 계산식이 공개되지 않아, 바꿔보기는 아이템 기본 명성 차이만 반영해요(강화 수치는 그대로라고 가정).</p>`;
  }

  function itemCell(it) {
    return `<span class="item-cell" style="${D.rarityStyle(it.itemRarity)}">
      <span class="item-icon">${it.itemId ? `<img src="${D.IMG.item(it.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>
      <span style="min-width:0"><span class="item-name">${D.esc(it.itemName || '')}</span></span></span>`;
  }

  function row(r) {
    const canSwap = r.group !== '아바타' || !/엠블렘/.test(r.slot);
    const swap = r.swap;
    return `<tr class="${swap ? 'swapped' : ''}">
      <td><small>${D.esc(r.slot || '')}</small>${r.extra ? `<br><small class="fame-extra">${D.esc(r.extra)}</small>` : ''}</td>
      <td>${itemCell(r.item)}${swap ? `<div class="fame-swap-to">→ ${itemCell(swap.item)}</div>` : ''}
        <div class="fame-search" data-search="${r.key}" hidden>
          <form class="inline-search" data-form="${r.key}">
            <input class="field field--sm" name="q" type="search" placeholder="바꿀 아이템 이름" autocomplete="off">
            <button class="btn-gold btn-gold--sm" type="submit">찾기</button>
          </form>
          <ul class="fame-cands" data-cands="${r.key}"></ul>
        </div></td>
      <td class="num">${r.fame === null ? '-' : D.num(r.fame || 0)}${swap ? `<br><strong class="${swap.fame - (r.fame || 0) >= 0 ? 'trend-up' : 'trend-down'}">${D.num(swap.fame)}</strong>` : ''}</td>
      <td class="num">${canSwap ? `<button type="button" class="chip fame-btn" data-open="${r.key}">${swap ? '다시' : '바꾸기'}</button>${swap ? ` <button type="button" class="chip fame-btn" data-undo="${r.key}">원래대로</button>` : ''}` : ''}</td>
    </tr>`;
  }

  function onClick(e) {
    const t = e.target.closest('[data-open],[data-undo],[data-pick-item],[data-reset-all]');
    if (!t) return;
    if (t.dataset.resetAll !== undefined) { rows.forEach((r) => { delete r.swap; }); render(); return; }
    if (t.dataset.open !== undefined) {
      const box = $('fame-result').querySelector(`[data-search="${t.dataset.open}"]`);
      box.hidden = !box.hidden;
      if (!box.hidden) box.querySelector('input').focus();
      return;
    }
    if (t.dataset.undo !== undefined) { delete rows[Number(t.dataset.undo)].swap; render(); return; }
    if (t.dataset.pickItem !== undefined) pickItem(Number(t.dataset.row), t.dataset.pickItem, t.dataset.name, t.dataset.rarity);
  }

  async function onSwapSearch(e) {
    const form = e.target.closest('[data-form]');
    if (!form) return;
    e.preventDefault();
    const r = rows[Number(form.dataset.form)];
    const q = form.q.value.trim();
    const ul = $('fame-result').querySelector(`[data-cands="${r.key}"]`);
    if (!q) return;
    ul.innerHTML = '<li class="help">찾는 중…</li>';
    try {
      const data = await D.api('items', { name: q });
      let list = data.rows || [];
      // 같은 종류(무기·방어구·액세서리 등)를 먼저 보여줘요
      const same = list.filter((x) => x.itemType === r.item.itemType);
      if (same.length) list = same;
      ul.innerHTML = list.length ? list.slice(0, 12).map((x) => `
        <li><button type="button" data-pick-item="${D.esc(x.itemId)}" data-row="${r.key}" data-name="${D.esc(x.itemName)}" data-rarity="${D.esc(x.itemRarity || '')}">
          ${itemCell(x)}<small>${D.esc(x.itemTypeDetail || x.itemType || '')}${x.itemAvailableLevel ? ` · Lv.${D.esc(x.itemAvailableLevel)}` : ''}</small>
        </button></li>`).join('') : '<li class="help">찾지 못했어요. 이름 앞부분으로 다시 찾아보세요.</li>';
    } catch (err) {
      ul.innerHTML = `<li class="help">${D.esc(err.message || '검색에 실패했어요')}</li>`;
    }
  }

  async function pickItem(key, itemId, itemName, itemRarity) {
    const fame = await fameOf(itemId);
    rows[key].swap = { item: { itemId, itemName, itemRarity }, fame: fame || 0 };
    render();
  }
})();
