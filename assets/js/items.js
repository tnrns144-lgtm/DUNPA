/* 아이템 사전: 이름 검색 → 상세 정보 (Worker를 통해 실시간 조회) */
(function () {
  const D = window.DNF;
  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('item-form');
    const q = new URLSearchParams(location.search).get('q');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.q.value.trim();
      if (!name) { form.q.focus(); return; }
      history.replaceState(null, '', `items.html?q=${encodeURIComponent(name)}`);
      search(name);
    });
    if (q) { form.q.value = q; search(q); }
  });

  async function search(name) {
    document.title = `${name} · 아이템 사전 · 던랩`;
    $('result-title').textContent = `"${name}" 검색 결과`;
    $('result-count').textContent = '';
    const box = $('item-results');
    box.innerHTML = `<div class="loading">${D.emptyState('찾는 중이에요', '')}</div>`;
    try {
      const data = await D.api('items', { name });
      const rows = data.rows || [];
      $('result-count').textContent = rows.length ? `${rows.length}개` : '';
      if (!rows.length) {
        box.innerHTML = D.emptyState('아이템을 찾지 못했어요', '이름을 다시 확인하거나 더 짧게 입력해 보세요.');
        return;
      }
      box.innerHTML = `<ul class="item-list">${rows.map((r) => `
        <li><button type="button" data-id="${D.esc(r.itemId)}">
          <span class="item-cell" style="${D.rarityStyle(r.itemRarity)}">
            <span class="item-icon"><img src="${D.IMG.item(r.itemId)}" alt="" loading="lazy" width="28" height="28"></span>
            <span><span class="item-name">${D.esc(r.itemName)}</span>
            <span class="item-sub">${D.esc(r.itemRarity || '')}${r.itemTypeDetail || r.itemType ? ' · ' + D.esc(r.itemTypeDetail || r.itemType) : ''}${r.itemAvailableLevel ? ' · Lv.' + D.esc(r.itemAvailableLevel) : ''}</span></span>
          </span>
        </button></li>`).join('')}</ul>`;
      box.querySelector('.item-list').addEventListener('click', (e) => {
        const btn = e.target.closest('[data-id]');
        if (!btn) return;
        box.querySelectorAll('[data-id]').forEach((b) => b.setAttribute('aria-current', String(b === btn)));
        detail(btn.dataset.id);
      });
    } catch (err) {
      box.innerHTML = D.apiErrorMessage(err);
    }
  }

  async function detail(id) {
    const box = $('item-detail');
    box.innerHTML = `<div class="loading">${D.emptyState('불러오는 중이에요', '')}</div>`;
    if (window.matchMedia('(max-width: 900px)').matches) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    try {
      const it = await D.api('item', { id });
      const stats = (it.itemStatus || []).map((s) => `<div class="stat-row"><span>${D.esc(s.name)}</span><span>${D.esc(s.value)}</span></div>`).join('');
      box.innerHTML = `
        <div class="item-detail" style="${D.rarityStyle(it.itemRarity)}">
          <div class="item-detail-head">
            <span class="item-icon"><img src="${D.IMG.item(it.itemId)}" alt="" width="42" height="42"></span>
            <div><h2 class="item-name" style="margin:0;font-size:18px">${D.esc(it.itemName)}</h2>
            <span class="item-sub">${D.esc(it.itemRarity || '')}${it.itemTypeDetail || it.itemType ? ' · ' + D.esc(it.itemTypeDetail || it.itemType) : ''}${it.itemAvailableLevel ? ' · Lv.' + D.esc(it.itemAvailableLevel) : ''}</span></div>
          </div>
          ${stats ? `<div>${stats}</div>` : ''}
          ${it.itemExplain ? `<p class="item-explain">${D.esc(it.itemExplain)}</p>` : ''}
          ${it.itemFlavorText ? `<p class="item-explain" style="color:var(--text-dim)">${D.esc(it.itemFlavorText)}</p>` : ''}
          ${it.setItemName ? `<span class="tag">${D.esc(it.setItemName)}</span>` : ''}
        </div>`;
    } catch (err) {
      box.innerHTML = D.apiErrorMessage(err);
    }
  }
})();
