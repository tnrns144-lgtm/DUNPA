/* 메인 페이지: 경매장 시세, 명성 랭킹, 랭커 트렌드, 아바타 거래 (GitHub Actions가 모은 data/*.json 사용) */
(function () {
  const D = window.DNF;
  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    D.bindSearchForm($('search-form'));
    D.renderRecentChips($('recent-chips'));
    renderRecentList();
    loadAuction();
    loadFame();
    loadTrends();
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
    renderJobDist();
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

  /* ---------- 랭커 트렌드: 직업 분포 (명성 데이터로 계산) ---------- */
  function renderJobDist() {
    const el = $('job-dist');
    const rows = fameData?.all || [];
    if (!rows.length) {
      el.innerHTML = D.emptyState('랭킹 수집 전이에요', '명성 랭킹이 모이면 자동으로 계산돼요.');
      return;
    }
    const counts = new Map();
    rows.forEach((r) => {
      const job = r.jobGrowName || r.jobName;
      if (job) counts.set(job, (counts.get(job) || 0) + 1);
    });
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    const max = top.length ? top[0][1] : 1;
    el.innerHTML = `<ol class="bar-list">
      ${top.map(([job, n]) => `
        <li>
          <span class="bar-name" title="${D.esc(job)}">${D.esc(job)}</span>
          <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${(n / max * 100).toFixed(1)}%"></span></span>
          <span class="bar-count">${D.num(n)}명</span>
        </li>`).join('')}
    </ol>
    <p class="help">상위 ${D.num(rows.length)}명 중 직업별 인원</p>`;
  }

  /* ---------- 랭커 트렌드: 장착품 순위 (data/trends.json) ---------- */
  const TREND_TABS = [
    { id: 'title', name: '칭호' },
    { id: 'creature', name: '크리쳐' },
    { id: 'aura', name: '오라' },
    { id: 'weapon', name: '무기 아바타' }
  ];
  let trendData = null;

  async function loadTrends() {
    try { trendData = await D.getJSON('data/trends.json'); } catch (e) { trendData = null; }
    const tabs = TREND_TABS.filter((t) => (trendData?.[t.id] || []).length);
    if (!tabs.length) {
      $('trend-tabs').innerHTML = '';
      $('trend-list').innerHTML = D.emptyState('트렌드 수집 전이에요', '하루 한 번 자동으로 채워져요.');
      return;
    }
    $('trend-updated').textContent = trendData.updatedAt ? `${D.timeLabel(trendData.updatedAt)} 기준` : '';
    const tabsEl = $('trend-tabs');
    tabsEl.innerHTML = tabs.map((t, i) =>
      `<button type="button" class="chip" data-trend="${t.id}" aria-pressed="${i === 0}">${D.esc(t.name)}</button>`).join('');
    tabsEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-trend]');
      if (!btn) return;
      tabsEl.querySelectorAll('[data-trend]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      renderTrend(btn.dataset.trend);
    });
    renderTrend(tabs[0].id);
  }

  function renderTrend(id) {
    const list = trendData?.[id] || [];
    const sample = trendData?.sample || 0;
    $('trend-list').innerHTML = `<ol class="use-list">
      ${list.map((it, i) => `
        <li>
          <span class="rank-no">${i + 1}</span>
          <div class="item-cell" style="${D.rarityStyle(it.itemRarity)}">
            <span class="item-icon">${it.itemId ? `<img src="${D.IMG.item(it.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>
            <span style="min-width:0"><span class="item-name">${D.esc(it.itemName)}</span><span class="item-sub">${D.esc(it.itemRarity || '')}</span></span>
          </div>
          <span class="use-count"><strong>${D.num(it.count)}명</strong>${sample ? `<br>${(it.count / sample * 100).toFixed(0)}%` : ''}</span>
        </li>`).join('')}
    </ol>
    ${sample ? `<p class="help">조사한 랭커 ${D.num(sample)}명 기준</p>` : ''}`;
  }

  /* ---------- 아바타 마켓 최근 거래 (한 줄 목록) ---------- */
  async function loadAvatar() {
    let data = null;
    try { data = await D.getJSON('data/avatar.json'); } catch (e) { data = null; }
    const rows = data?.rows || [];
    const el = $('avatar-recent');
    if (!rows.length) {
      el.innerHTML = '<li><span class="help">최근 거래 내역이 없어요.</span></li>';
      return;
    }
    el.innerHTML = rows.slice(0, 5).map((r) => `
      <li>
        <small>${D.esc((r.soldDate || '').slice(5).replace('-', '.'))}</small>
        <small>${D.esc(r.jobName || '공용')}</small>
        <span class="mini-title">${D.esc(r.title)}</span>
        <span class="mini-price">${D.gold(r.price)} 골드</span>
      </li>`).join('');
  }
})();
