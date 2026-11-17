/* 메인 페이지: 경매장 시세, 명성 랭킹, 아바타 마켓 (GitHub Actions가 모은 data/*.json 사용) */
(function () {
  const D = window.DNF;
  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    D.bindSearchForm($('search-form'));
    D.renderRecentChips($('recent-chips'));
    renderRecentList();
    loadAuction();
    loadFame();
    loadAvatar();
  });

  /* ---------- 내 최근 검색 ---------- */
  function renderRecentList() {
    const list = D.getRecent();
    const el = $('recent-list');
    if (!list.length) {
      el.innerHTML = '<li><span class="help" style="display:block;padding:8px 0">캐릭터를 검색하면 이 브라우저에 기록이 남아요.</span></li>';
      return;
    }
    el.innerHTML = list.slice(0, 6).map((r) => `
      <li><a href="${D.characterLink(r.serverId, r.characterId)}">
        <span>${D.esc(r.characterName)}</span><small>${D.esc(D.serverName(r.serverId))}</small>
      </a></li>`).join('');
  }

  /* ---------- 경매장 시세 ---------- */
  let auctionData = null;

  async function loadAuction() {
    try {
      auctionData = await D.getJSON('data/auction.json');
    } catch (e) {
      auctionData = null;
    }
    const cats = (auctionData?.categories || []).filter((c) => c.items && c.items.length);
    if (!cats.length) {
      $('auction-tabs').innerHTML = '';
      $('auction-table').innerHTML = D.emptyState('시세 수집 전이에요', 'API 키를 등록하면 1시간마다 자동으로 채워져요.');
      return;
    }
    $('auction-updated').textContent = auctionData.updatedAt ? `${D.timeLabel(auctionData.updatedAt)} 기준` : '';
    const tabs = $('auction-tabs');
    tabs.innerHTML = cats.map((c, i) =>
      `<button type="button" class="chip" data-cat="${D.esc(c.id)}" aria-pressed="${i === 0}">${D.esc(c.name)}</button>`).join('');
    tabs.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      tabs.querySelectorAll('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderAuction(btn.dataset.cat);
    });
    renderAuction(cats[0].id);
  }

  function trendCell(pct) {
    if (pct === null || pct === undefined || !Number.isFinite(pct)) return '<span class="trend-flat">-</span>';
    if (Math.abs(pct) < 0.05) return '<span class="trend-flat">0.0%</span>';
    const up = pct > 0;
    return `<span class="${up ? 'trend-up' : 'trend-down'}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%</span>`;
  }

  function renderAuction(catId) {
    const cat = (auctionData.categories || []).find((c) => c.id === catId);
    const items = (cat?.items || []).filter((it) => it.avgPrice);
    if (!items.length) {
      $('auction-table').innerHTML = D.emptyState('거래 내역이 없어요', '이 분류의 최근 거래가 아직 없어요.');
      return;
    }
    $('auction-table').innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th scope="col">아이템</th>
          <th scope="col" class="num">평균 거래가</th>
          <th scope="col" class="num">전일 대비</th>
          <th scope="col" class="num">최근 거래량</th>
        </tr></thead>
        <tbody>
          ${items.map((it) => `
            <tr>
              <td><div class="item-cell" style="${D.rarityStyle(it.itemRarity)}">
                <span class="item-icon">${it.itemId ? `<img src="${D.IMG.item(it.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>
                <span><span class="item-name">${D.esc(it.itemName)}</span><span class="item-sub">${D.esc(it.itemRarity || '')}${it.itemType ? ' · ' + D.esc(it.itemType) : ''}</span></span>
              </div></td>
              <td class="num"><strong>${D.gold(it.avgPrice)}</strong> <span class="gold-unit">골드</span></td>
              <td class="num">${trendCell(it.changePct)}</td>
              <td class="num" style="color:var(--text-sub)">${D.num(it.volume)}개</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  /* ---------- 명성 랭킹 ---------- */
  let fameData = null;

  async function loadFame() {
    const serverSel = $('fame-server');
    D.fillServerSelect(serverSel);
    try {
      fameData = await D.getJSON('data/fame.json');
    } catch (e) {
      fameData = null;
    }
    if (!fameData || !(fameData.all || []).length) {
      $('fame-body').innerHTML = `<div class="panel">${D.emptyState('랭킹 수집 전이에요', 'API 키를 등록하면 자동으로 채워져요.')}</div>`;
      return;
    }
    serverSel.addEventListener('change', () => { fillJobs(); renderFame(); });
    $('fame-job').addEventListener('change', renderFame);
    fillJobs();
    renderFame();
  }

  function currentFameRows() {
    const server = $('fame-server').value;
    return server === 'all' ? (fameData.all || []) : ((fameData.byServer || {})[server] || []);
  }

  function fillJobs() {
    const sel = $('fame-job');
    const prev = sel.value;
    const jobs = [...new Set(currentFameRows().map((r) => r.jobGrowName || r.jobName).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">전체 직업</option>' + jobs.map((j) => `<option>${D.esc(j)}</option>`).join('');
    if (jobs.includes(prev)) sel.value = prev;
  }

  function renderFame() {
    const job = $('fame-job').value;
    const rows = currentFameRows().filter((r) => !job || (r.jobGrowName || r.jobName) === job).slice(0, 10);
    if (!rows.length) {
      $('fame-body').innerHTML = `<div class="panel">${D.emptyState('해당하는 캐릭터가 없어요', '다른 서버나 직업을 골라보세요.')}</div>`;
      return;
    }
    const top = rows.slice(0, 3);
    const rest = rows.slice(3);
    const label = (r) => `${D.esc(r.jobGrowName || r.jobName || '')} · ${D.esc(D.serverName(r.serverId))}`;
    $('fame-body').innerHTML = `
      <div class="podium">
        ${top.map((r, i) => `
          <a class="podium-card r${i + 1}" href="${D.characterLink(r.serverId, r.characterId)}">
            <span class="medal">${i + 1}</span>
            <span class="char-portrait"><img src="${D.IMG.character(r.serverId, r.characterId, 1)}" alt="" loading="lazy"></span>
            <span class="podium-name">${D.esc(r.characterName)}</span>
            <span class="podium-sub">${label(r)}</span>
            <span class="podium-fame">${D.num(r.fame)}</span>
          </a>`).join('')}
      </div>
      ${rest.length ? `<ol class="rank-list" start="4" style="margin-top:12px">
        ${rest.map((r, i) => `
          <li><a href="${D.characterLink(r.serverId, r.characterId)}">
            <span class="rank-no">${i + 4}</span>
            <span class="rank-main"><strong>${D.esc(r.characterName)}</strong><small>${label(r)}</small></span>
            <span class="rank-fame">${D.num(r.fame)}</span>
          </a></li>`).join('')}
      </ol>` : ''}`;
  }

  /* ---------- 아바타 마켓 ---------- */
  async function loadAvatar() {
    let data = null;
    try { data = await D.getJSON('data/avatar.json'); } catch (e) { data = null; }
    const rows = data?.rows || [];
    if (!rows.length) {
      $('avatar-body').innerHTML = `<div class="panel">${D.emptyState('거래 내역 수집 전이에요', 'API 키를 등록하면 자동으로 채워져요.')}</div>`;
      return;
    }
    $('avatar-updated').textContent = data.updatedAt ? `${D.timeLabel(data.updatedAt)} 기준` : '';
    $('avatar-body').innerHTML = `<div class="avatar-grid">
      ${rows.slice(0, 8).map((r) => `
        <article class="avatar-card">
          <div class="avatar-thumb">${(r.itemIds || []).slice(0, 10).map((id) => `<img src="${D.IMG.item(id)}" alt="" loading="lazy" width="28" height="28">`).join('')}</div>
          <div class="avatar-body">
            <small>${D.esc(r.jobName || '공용')}${r.avatarRarity ? ' · ' + D.esc(r.avatarRarity) : ''}</small>
            <span class="avatar-title">${D.esc(r.title)}</span>
            <span class="avatar-price">${D.gold(r.price)} 골드</span>
          </div>
        </article>`).join('')}
    </div>`;
  }
})();
