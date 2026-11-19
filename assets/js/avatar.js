/* 아바타 마켓: 판매 중 매물 + 최근 거래 (GitHub Actions가 모은 data/avatar.json 사용) */
(function () {
  const D = window.DNF;
  const $ = (id) => document.getElementById(id);
  const PAGE = 24;

  // 게임 속 아바타 칸 배치 (위에서부터 3칸씩)
  const SLOTS = [
    { key: '모자', label: '모자' }, { key: '머리', label: '머리' }, { key: '얼굴', label: '얼굴' },
    { key: '목가슴', label: '목가슴' }, { key: '상의', label: '상의' }, { key: '허리', label: '허리' },
    { key: '하의', label: '하의' }, { key: '신발', label: '신발' }, { key: '피부', label: '피부' },
    { key: '오라', label: '오라' }, { key: '무기', label: '무기' }, { key: '__etc', label: '기타' }
  ];
  const slotOf = (part) => {
    const name = part.slotName || '';
    const hit = SLOTS.find((s) => s.key !== '__etc' && name.includes(s.key));
    return hit ? hit.key : '__etc';
  };

  let data = null;
  let mode = 'sale';
  let shown = PAGE;

  document.addEventListener('DOMContentLoaded', async () => {
    try { data = await D.getJSON('data/avatar.json'); } catch (e) { data = null; }
    // 예전 형식(rows만 있음)도 '최근 거래'로 보여줘요
    if (data && !data.sale && !data.sold && data.rows) {
      data.sold = data.rows.map((r) => ({ ...r, jobs: r.jobName ? [r.jobName] : [], date: r.soldDate, parts: (r.itemIds || []).map((id) => ({ itemId: id })) }));
      data.sale = [];
    }
    if (!data || (!(data.sale || []).length && !(data.sold || []).length)) {
      $('market-list').innerHTML = `<div class="panel">${D.emptyState('아바타 마켓 수집 전이에요', '1시간마다 자동으로 채워져요.')}</div>`;
      $('market-stats').innerHTML = D.emptyState('분석할 데이터가 없어요', '');
      return;
    }
    if (!(data.sale || []).length) mode = 'sold';
    $('market-updated').textContent = data.updatedAt ? `${D.timeLabel(data.updatedAt)} 기준` : '';
    $('market-summary').textContent = `판매 중 ${D.num((data.sale || []).length)}건 · 최근 거래 ${D.num((data.sold || []).length)}건 · 1시간마다 갱신`;

    $('market-mode').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      mode = btn.dataset.mode;
      shown = PAGE;
      syncMode();
      fillJobs();
      render();
    });
    ['f-job', 'f-rarity', 'f-sort'].forEach((id) => $(id).addEventListener('change', () => { shown = PAGE; render(); }));
    let t;
    $('f-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { shown = PAGE; render(); }, 200); });
    $('market-more').addEventListener('click', () => { shown += PAGE; render(); });
    $('market-list').addEventListener('click', (e) => {
      const card = e.target.closest('.market-card');
      if (!card || e.target.closest('a')) return;
      card.classList.toggle('open');
      card.setAttribute('aria-expanded', String(card.classList.contains('open')));
    });

    $('market-list').addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('market-card')) { e.preventDefault(); e.target.click(); }
    });

    syncMode();
    fillJobs();
    render();
    renderStats();
  });

  const rows = () => (mode === 'sale' ? data.sale : data.sold) || [];

  function syncMode() {
    $('market-mode').querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('f-sort').options[0].textContent = mode === 'sale' ? '최신 등록순' : '최근 거래순';
  }

  function fillJobs() {
    const sel = $('f-job');
    const prev = sel.value;
    const jobs = [...new Set(rows().flatMap((r) => r.jobs || []))].sort();
    sel.innerHTML = '<option value="">전체 직업</option>' + jobs.map((j) => `<option>${D.esc(j)}</option>`).join('');
    if (jobs.includes(prev)) sel.value = prev;
  }

  function filtered() {
    const job = $('f-job').value;
    const rarity = $('f-rarity').value;
    const q = $('f-q').value.trim().toLowerCase();
    const sort = $('f-sort').value;
    const list = rows().filter((r) =>
      (!job || (r.jobs || []).includes(job)) &&
      (!rarity || r.avatarRarity === rarity) &&
      (!q || (r.title || '').toLowerCase().includes(q) || (r.parts || []).some((p) => (p.itemName || '').toLowerCase().includes(q))));
    if (sort === 'low') list.sort((a, b) => a.price - b.price);
    else if (sort === 'high') list.sort((a, b) => b.price - a.price);
    else list.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.goodsNo - a.goodsNo);
    return list;
  }

  function slotGrid(parts) {
    const bySlot = {};
    (parts || []).forEach((p) => { const k = slotOf(p); (bySlot[k] = bySlot[k] || []).push(p); });
    return `<div class="av-slots" aria-hidden="true">${SLOTS.map((s) => {
      const p = (bySlot[s.key] || [])[0];
      return p && p.itemId
        ? `<span class="av-slot filled" style="${D.rarityStyle(p.itemRarity)}" title="${D.esc(p.itemName || s.label)}"><img src="${D.IMG.item(p.itemId)}" alt="" loading="lazy" width="28" height="28"></span>`
        : `<span class="av-slot"><small>${s.label}</small></span>`;
    }).join('')}</div>`;
  }

  function dateLabel(d) {
    if (!d) return '';
    const s = String(d).replace('T', ' ');
    return s.slice(5, 16).replace('-', '.');
  }

  function card(r) {
    const parts = r.parts || [];
    const rarityClass = r.avatarRarity === '상급' ? 'r-high' : r.avatarRarity === '레어' ? 'r-rare' : 'r-mix';
    return `
      <article class="market-card" tabindex="0" role="button" aria-expanded="false">
        <div class="market-main">
          ${slotGrid(parts)}
          <div class="market-info">
            <div class="market-tags">
              ${r.avatarRarity ? `<span class="av-rarity ${rarityClass}">${D.esc(r.avatarRarity)}</span>` : ''}
              ${r.avatarSet === true || r.avatarSet === 'true' ? '<span class="tag">세트</span>' : ''}
              <span class="tag">${D.esc((r.jobs || [])[0] || '공용')}${(r.jobs || []).length > 1 ? ` 외 ${r.jobs.length - 1}` : ''}</span>
              <span class="tag">${parts.length}부위</span>
            </div>
            <h3 class="market-title">${D.esc(r.title || '(제목 없음)')}</h3>
            ${(r.hashtags || []).length ? `<p class="market-hash">${r.hashtags.slice(0, 4).map((h) => `#${D.esc(h)}`).join(' ')}</p>` : ''}
            <div class="market-foot">
              <span class="market-price"><strong>${D.gold(r.price)}</strong> 골드</span>
              ${r.date ? `<small>${mode === 'sale' ? '등록' : '거래'} ${D.esc(dateLabel(r.date))}</small>` : ''}
            </div>
          </div>
        </div>
        <div class="market-detail">
          ${parts.length && parts.some((p) => p.itemName) ? `<ul class="market-parts">${parts.map((p) => `
            <li>
              <span class="item-cell" style="${D.rarityStyle(p.itemRarity)}">
                <span class="item-icon">${p.itemId ? `<img src="${D.IMG.item(p.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>
                <span style="min-width:0"><span class="item-name">${D.esc(p.itemName)}</span>
                <span class="item-sub">${D.esc(p.slotName || '')}${(p.emblems || []).length ? ` · 엠블렘 ${p.emblems.map(D.esc).join(', ')}` : ''}</span></span>
              </span>
            </li>`).join('')}</ul>` : '<p class="help">부위별 상세 정보가 없어요.</p>'}
        </div>
      </article>`;
  }

  function render() {
    const list = filtered();
    $('market-count').textContent = `${mode === 'sale' ? '판매 중' : '최근 거래'} ${D.num(list.length)}건`;
    if (!list.length) {
      $('market-list').innerHTML = `<div class="panel">${D.emptyState('조건에 맞는 매물이 없어요', '직업이나 등급 조건을 바꿔 보세요.')}</div>`;
      $('market-more').hidden = true;
      return;
    }
    $('market-list').innerHTML = list.slice(0, shown).map(card).join('');
    $('market-more').hidden = list.length <= shown;
  }

  function renderStats() {
    const sale = data.sale || [];
    const sold = data.sold || [];
    const byRarity = ['상급', '레어', '혼합'].map((k) => {
      const list = sale.filter((r) => r.avatarRarity === k).map((r) => r.price).filter((p) => p > 0).sort((a, b) => a - b);
      return { k, n: list.length, min: list[0], mid: list.length ? list[Math.floor(list.length / 2)] : 0 };
    });
    const jobCount = new Map();
    sale.forEach((r) => (r.jobs || []).forEach((j) => jobCount.set(j, (jobCount.get(j) || 0) + 1)));
    const topJobs = [...jobCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const soldAvg = sold.length ? Math.round(sold.reduce((s, r) => s + (r.price || 0), 0) / sold.length) : 0;

    $('market-stats').innerHTML = `
      ${sale.length ? `
      <table class="stat-table">
        <thead><tr><th>등급</th><th class="num">매물</th><th class="num">최저가</th><th class="num">중간가</th></tr></thead>
        <tbody>${byRarity.map((r) => `<tr><td>${r.k}</td><td class="num">${D.num(r.n)}</td><td class="num">${r.min ? D.gold(r.min) : '-'}</td><td class="num">${r.mid ? D.gold(r.mid) : '-'}</td></tr>`).join('')}</tbody>
      </table>` : ''}
      ${topJobs.length ? `<h3 class="stat-sub">매물이 많은 직업</h3>
      <ol class="mini-list">${topJobs.map(([j, n]) => `<li><span class="mini-title">${D.esc(j)}</span><span class="mini-price">${D.num(n)}건</span></li>`).join('')}</ol>` : ''}
      ${sold.length ? `<h3 class="stat-sub">최근 거래 ${D.num(sold.length)}건 평균</h3><p class="stat-big">${D.gold(soldAvg)} <small>골드</small></p>` : ''}
      <p class="help">판매 중 매물은 등급별 최신·최저가 매물을 합쳐 모은 것이라 전체 매물 수와 다를 수 있어요.</p>`;
  }
})();
