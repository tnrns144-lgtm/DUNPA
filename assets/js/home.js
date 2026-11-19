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
    bindPriceChart();
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
            <tr class="price-row" data-item="${D.esc(it.itemName)}" tabindex="0" role="button" aria-expanded="false" title="눌러서 30일 시세 그래프 보기">
              <td><div class="item-cell" style="${D.rarityStyle(it.itemRarity)}">
                <span class="item-icon">${it.itemId ? `<img src="${D.IMG.item(it.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>
                <span><span class="item-name">${D.esc(it.itemName)}</span><span class="item-sub">${D.esc(it.itemRarity || '')}${it.itemType ? ' · ' + D.esc(it.itemType) : ''}</span></span>
              </div></td>
              <td class="num"><strong>${D.gold(it.avgPrice)}</strong> <span class="gold-unit">골드</span></td>
              <td class="num">${trendCell(it.changePct)}</td>
              <td class="num" style="color:var(--text-sub)">${D.num(it.volume)}개</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <p class="help price-hint">아이템을 누르면 최근 30일 시세 그래프가 펼쳐져요.</p>`;
  }

  /* ---------- 경매장 시세 그래프 (data/history/auction-daily.json: 날짜별 평균가) ---------- */
  let priceHistory = null;
  async function getHistory() {
    if (!priceHistory) priceHistory = D.getJSON('data/history/auction-daily.json').catch(() => ({}));
    return priceHistory;
  }

  function bindPriceChart() {
    const box = $('auction-table');
    const toggle = async (row) => {
      if (!row) return;
      const next = row.nextElementSibling;
      if (next && next.classList.contains('price-chart-row')) {
        next.remove();
        row.setAttribute('aria-expanded', 'false');
        return;
      }
      box.querySelectorAll('.price-chart-row').forEach((r) => { r.previousElementSibling?.setAttribute('aria-expanded', 'false'); r.remove(); });
      const tr = document.createElement('tr');
      tr.className = 'price-chart-row';
      tr.innerHTML = `<td colspan="4">${D.emptyState('그래프를 그리는 중이에요', '')}</td>`;
      row.after(tr);
      row.setAttribute('aria-expanded', 'true');
      const hist = await getHistory();
      const name = row.dataset.item;
      const points = Object.keys(hist).sort().map((d) => ({ d, v: hist[d][name] })).filter((p) => p.v > 0);
      tr.firstElementChild.innerHTML = priceChart(name, points);
    };
    box.addEventListener('click', (e) => toggle(e.target.closest('.price-row')));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { const row = e.target.closest('.price-row'); if (row) { e.preventDefault(); toggle(row); } }
    });
  }

  // 외부 라이브러리 없이 SVG로 꺾은선 그래프를 그려요
  function priceChart(name, points) {
    if (points.length < 2) {
      return `<div class="price-chart">${D.emptyState('기록이 더 쌓여야 그래프가 나와요', `${D.esc(name)}의 시세 기록이 ${points.length}일치예요. 매일 한 칸씩 늘어나 최대 30일까지 보여줘요.`)}</div>`;
    }
    const W = 640, H = 180, L = 64, R = 12, T = 14, B = 26;
    const vals = points.map((p) => p.v);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min *= 0.95; max *= 1.05; }
    const pad = (max - min) * 0.12;
    min = Math.max(0, min - pad); max += pad;
    const x = (i) => L + (i / (points.length - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - min) / (max - min)) * (H - T - B);
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${line} L${x(points.length - 1).toFixed(1)},${H - B} L${x(0).toFixed(1)},${H - B} Z`;
    const ticks = [max, (max + min) / 2, min];
    const first = vals[0], last = vals[vals.length - 1];
    const diff = ((last - first) / first) * 100;
    const hi = Math.max(...vals), lo = Math.min(...vals);
    const label = (d) => d.slice(5).replace('-', '.');
    const step = Math.max(1, Math.ceil(points.length / 6));
    return `<div class="price-chart">
      <div class="price-chart-head">
        <strong>${D.esc(name)}</strong>
        <span>${points.length}일 변화 <b class="${diff >= 0 ? 'trend-up' : 'trend-down'}">${diff >= 0 ? '▲' : '▼'} ${Math.abs(diff).toFixed(1)}%</b></span>
        <span>최고 <b>${D.gold(hi)}</b></span><span>최저 <b>${D.gold(lo)}</b></span>
      </div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${D.esc(name)} 최근 ${points.length}일 평균 거래가 그래프">
        ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${D.gold(Math.round(t))}</text>`).join('')}
        <path class="area" d="${area}"/>
        <path class="line" d="${line}"/>
        ${points.map((p, i) => `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3"><title>${label(p.d)} · ${D.gold(p.v)} 골드</title></circle>`).join('')}
        ${points.map((p, i) => (i % step === 0 || i === points.length - 1) ? `<text class="axis" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${label(p.d)}</text>` : '').join('')}
      </svg>
      <p class="help">하루 평균 거래가 기준 · 점에 마우스를 올리면 날짜별 가격이 보여요.</p>
    </div>`;
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
    // 전체 인원 대비 비율로 표시. 상위 9개 직업 + 나머지는 '기타'로 묶어 합계가 100%가 되게 해요
    const total = rows.length;
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 9);
    const rest = sorted.slice(9);
    const restN = rest.reduce((s, [, n]) => s + n, 0);
    const max = top.length ? top[0][1] : 1;
    const pct = (n) => `${(n / total * 100).toFixed(1)}%`;
    el.innerHTML = `<ol class="bar-list">
      ${top.map(([job, n]) => `
        <li title="${D.esc(job)} ${D.num(n)}명">
          <span class="bar-name">${D.esc(job)}</span>
          <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${(n / max * 100).toFixed(1)}%"></span></span>
          <span class="bar-count">${pct(n)}</span>
        </li>`).join('')}
      ${restN ? `
        <li class="bar-rest" title="${rest.map(([j, n]) => `${j} ${n}명`).join(', ')}">
          <span class="bar-name">기타 ${D.num(rest.length)}개 직업</span>
          <span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.min(100, restN / max * 100).toFixed(1)}%"></span></span>
          <span class="bar-count">${pct(restN)}</span>
        </li>` : ''}
    </ol>`;
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
    renderTrendLog();
    const tabs = TREND_TABS.filter((t) => (trendData?.[t.id] || []).length);
    if (!tabs.length) {
      $('trend-tabs').innerHTML = '';
      $('trend-list').innerHTML = D.emptyState('트렌드 수집 전이에요', '하루 한 번 자동으로 채워져요.');
      $('look-gallery').innerHTML = D.emptyState('갤러리 준비 중이에요', '랭커 트렌드가 모이면 착용 랭커 모습이 나와요.');
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
    bindLookPicker();
    renderTrend(tabs[0].id);
  }

  // 직전 관측 대비 변화 표시 (▲ 늘어남 / ▼ 줄어듦 / NEW 새로 등장)
  function changeBadge(it) {
    if (it.isNew) return '<span class="chg chg-new">NEW</span>';
    if (it.delta > 0) return `<span class="chg chg-up">▲${it.delta}</span>`;
    if (it.delta < 0) return `<span class="chg chg-down">▼${-it.delta}</span>`;
    return '';
  }

  function renderTrendLog() {
    const el = $('trend-log');
    if (!trendData) {
      el.innerHTML = D.emptyState('관측 데이터가 아직 없어요', '하루 한 번 자동으로 채워져요.');
      return;
    }
    if (!trendData.prevDate) {
      el.innerHTML = D.emptyState('관측 기록을 쌓는 중이에요', '내일부터 전날과 비교해 랭커 장착품이 어떻게 바뀌었는지 여기에 기록돼요.');
      return;
    }
    const risers = trendData.risers || [];
    const label = Object.fromEntries(TREND_TABS.map((t) => [t.id, t.name]));
    const since = trendData.prevDate.slice(5).replace('-', '.');
    if (!risers.length) {
      el.innerHTML = D.emptyState('조용한 하루였어요', `${since} 관측 이후 랭커 장착품에 눈에 띄는 변화가 없어요.`);
      return;
    }
    el.innerHTML = `<p class="help">${since} 관측 대비, 랭커 사이에서 가장 많이 늘어난 장착품</p>
      <ol class="use-list">
        ${risers.map((it) => `
          <li>
            <span class="lab-code">${D.esc(label[it.category] || '')}</span>
            <div class="item-cell" style="${D.rarityStyle(it.itemRarity)}">
              <span class="item-icon">${it.itemId ? `<img src="${D.IMG.item(it.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>
              <span style="min-width:0"><span class="item-name">${D.esc(it.itemName)}</span><span class="item-sub">현재 ${D.num(it.count)}명 사용</span></span>
            </div>
            <span class="use-count">${changeBadge(it)}</span>
          </li>`).join('')}
      </ol>`;
  }

  function renderTrend(id) {
    const list = trendData?.[id] || [];
    const sample = trendData?.sample || 0;
    const hasWearers = !!trendData?.wearers?.[id];
    $('trend-list').innerHTML = `<ol class="use-list${hasWearers ? ' use-list--pick' : ''}">
      ${list.map((it, i) => `
        <li${hasWearers ? ` tabindex="0" role="button" data-pick="${i}" aria-pressed="${i === 0}"` : ''}>
          <span class="rank-no">${i + 1}</span>
          <div class="item-cell" style="${D.rarityStyle(it.itemRarity)}">
            <span class="item-icon">${it.itemId ? `<img src="${D.IMG.item(it.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>
            <span style="min-width:0"><span class="item-name">${D.esc(it.itemName)}</span><span class="item-sub">${D.esc(it.itemRarity || '')}</span></span>
          </div>
          <span class="use-count">${changeBadge(it)} <strong>${D.num(it.count)}명</strong>${sample ? `<br>${(it.count / sample * 100).toFixed(0)}%` : ''}</span>
        </li>`).join('')}
    </ol>
    ${hasWearers ? '<p class="help">누르면 본문 랭커 룩 갤러리에 착용 랭커가 나와요</p>' : ''}`;
    renderLook(id, 0);
  }

  /* ---------- 랭커 룩 갤러리: 이 장착품을 실제로 쓰는 랭커들의 모습 ---------- */
  function bindLookPicker() {
    const box = $('trend-list');
    const pick = (li) => {
      if (!li) return;
      box.querySelectorAll('[data-pick]').forEach((x) => x.setAttribute('aria-pressed', String(x === li)));
      const tab = document.querySelector('#trend-tabs [aria-pressed="true"]');
      renderLook(tab ? tab.dataset.trend : 'title', Number(li.dataset.pick));
    };
    box.addEventListener('click', (e) => pick(e.target.closest('[data-pick]')));
    box.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { const li = e.target.closest('[data-pick]'); if (li) { e.preventDefault(); pick(li); } }
    });
  }

  function renderLook(id, index) {
    const el = $('look-gallery');
    if (!el) return;
    const item = (trendData?.[id] || [])[index];
    const people = item ? (trendData?.wearers?.[id]?.[item.itemName] || []) : [];
    if (!item || !people.length) {
      el.innerHTML = D.emptyState('갤러리 준비 중이에요', '다음 랭커 트렌드 수집(하루 한 번)부터 착용 랭커 모습이 나와요.');
      return;
    }
    const label = (TREND_TABS.find((t) => t.id === id) || {}).name || '';
    el.innerHTML = `
      <div class="look-head">
        <span class="item-cell" style="${D.rarityStyle(item.itemRarity)}">
          <span class="item-icon">${item.itemId ? `<img src="${D.IMG.item(item.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>
          <span style="min-width:0"><span class="item-name">${D.esc(item.itemName)}</span><span class="item-sub">${D.esc(label)} · 랭커 ${D.num(item.count)}명 착용${people.length < item.count ? ` · 명성 높은 ${people.length}명 표시` : ''}</span></span>
        </span>
      </div>
      <div class="look-grid">
        ${people.map((p) => `
          <a class="look-card" href="${D.characterLink(p.serverId, p.characterId)}">
            <span class="look-img"><img src="${D.IMG.character(p.serverId, p.characterId, 1)}" alt="${D.esc(p.characterName)}" loading="lazy"></span>
            <strong>${D.esc(p.characterName)}</strong>
            <small>${D.esc(p.jobGrowName || '')}</small>
            <small class="look-fame">${D.esc(D.serverName(p.serverId))} · ${D.num(p.fame)}</small>
          </a>`).join('')}
      </div>`;
  }

  /* ---------- 아바타 마켓 최근 거래 (한 줄 목록) ---------- */
  async function loadAvatar() {
    let data = null;
    try { data = await D.getJSON('data/avatar.json'); } catch (e) { data = null; }
    const rows = data?.sold || data?.rows || [];
    const el = $('avatar-recent');
    if (!rows.length) {
      el.innerHTML = '<li><span class="help">최근 거래 내역이 없어요.</span></li>';
      return;
    }
    el.innerHTML = rows.slice(0, 5).map((r) => `
      <li>
        <small>${D.esc((r.date || r.soldDate || '').slice(5, 10).replace('-', '.'))}</small>
        <small>${D.esc((r.jobs && r.jobs[0]) || r.jobName || '공용')}</small>
        <span class="mini-title">${D.esc(r.title)}</span>
        <span class="mini-price">${D.gold(r.price)} 골드</span>
      </li>`).join('');
  }
})();
