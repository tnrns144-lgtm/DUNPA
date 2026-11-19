/* 경매장 시세 페이지: 실시간 경매장 검색 (Worker의 /auction, /auction-sold 사용)
   아이템 이름 검색 → 후보 고르기 → 현재 최저가·매물 목록 + 최근 거래 동향 그래프 */
(function () {
  const D = window.DNF;
  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('live-form');
    if (!form) return;
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = form.q.value.trim();
      if (!q) { form.q.focus(); return; }
      history.replaceState(null, '', `auction.html?q=${encodeURIComponent(q)}#live`);
      search(q);
    });
    $('live-result').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) select(b.dataset.pick);
    });
    // 아래 시세 표의 아이템 이름을 누르면 실시간 검색으로
    document.addEventListener('click', (e) => {
      const name = e.target.closest('#auction-table .item-name, #ref-table .item-name');
      if (!name) return;
      e.stopPropagation();
      form.q.value = name.textContent.trim();
      form.requestSubmit();
      $('live').scrollIntoView({ behavior: 'smooth' });
    }, true);
    const q = new URLSearchParams(location.search).get('q');
    if (q) { form.q.value = q; search(q); }
  });

  function errorBox(err) {
    if (err && err.status === 404 && /없는 주소/.test(err.message || '')) {
      return D.emptyState('실시간 검색을 준비 중이에요', '조회 서버 업데이트가 끝나면 바로 사용할 수 있어요.');
    }
    return D.apiErrorMessage(err);
  }

  async function search(q) {
    const box = $('live-result');
    box.innerHTML = `<div class="panel loading">${D.emptyState('경매장을 찾는 중이에요', '')}</div>`;
    try {
      let data = await D.api('auction', { name: q, type: 'front' });
      if (!(data.rows || []).length) data = await D.api('auction', { name: q, type: 'full' });
      const rows = data.rows || [];
      // 아이템별로 묶기
      const groups = new Map();
      rows.forEach((r) => {
        const g = groups.get(r.itemName) || { name: r.itemName, itemId: r.itemId, rarity: r.itemRarity, type: r.itemTypeDetail || r.itemType, min: Infinity, n: 0, qty: 0 };
        g.min = Math.min(g.min, r.unitPrice || Infinity);
        g.n++;
        g.qty += r.count || 1;
        groups.set(r.itemName, g);
      });
      const list = [...groups.values()];
      const exact = list.find((g) => g.name === q);
      if (exact || list.length === 1) return select((exact || list[0]).name);
      if (!list.length) {
        // 판매 중인 매물이 없어도 최근 거래 기록은 있을 수 있어요
        return select(q, true);
      }
      box.innerHTML = `<div class="panel panel--pad">
        <p class="help">"${D.esc(q)}"(으)로 시작하는 아이템 ${list.length}개가 판매 중이에요. 확인할 아이템을 골라 주세요.</p>
        <ul class="live-cands">${list.sort((a, b) => b.n - a.n).slice(0, 30).map((g) => `
          <li><button type="button" data-pick="${D.esc(g.name)}">
            <span class="item-cell" style="${D.rarityStyle(g.rarity)}"><span class="item-icon">${g.itemId ? `<img src="${D.IMG.item(g.itemId)}" alt="" loading="lazy" width="28" height="28">` : ''}</span>
            <span><span class="item-name">${D.esc(g.name)}</span><span class="item-sub">${D.esc(g.type || '')} · 매물 ${D.num(g.n)}건</span></span></span>
            <span class="live-min">최저 <b>${D.gold(g.min)}</b></span>
          </button></li>`).join('')}</ul></div>`;
    } catch (err) {
      box.innerHTML = `<div class="panel">${errorBox(err)}</div>`;
    }
  }

  async function select(name, noListing) {
    const box = $('live-result');
    box.innerHTML = `<div class="panel loading">${D.emptyState(`${D.esc(name)} 시세를 불러오는 중이에요`, '')}</div>`;
    try {
      const [live, sold] = await Promise.all([
        noListing ? Promise.resolve({ rows: [] }) : D.api('auction', { name, type: 'match' }),
        D.api('auction-sold', { name }).catch(() => ({ rows: [] }))
      ]);
      render(name, (live.rows || []).filter((r) => r.unitPrice > 0), (sold.rows || []).filter((r) => r.unitPrice > 0));
    } catch (err) {
      box.innerHTML = `<div class="panel">${errorBox(err)}</div>`;
    }
  }

  const time = (s) => new Date(String(s).replace(' ', 'T') + '+09:00').getTime();
  const hm = (s) => String(s || '').slice(5, 16).replace('-', '.');

  function render(name, live, sold) {
    const box = $('live-result');
    const first = live[0] || sold[0];
    if (!first) {
      box.innerHTML = `<div class="panel">${D.emptyState(`${D.esc(name)}`, '지금 판매 중인 매물과 최근 거래 기록이 없어요. 이름을 정확히 입력했는지 확인해 주세요.')}</div>`;
      return;
    }
    const prices = live.map((r) => r.unitPrice);
    const qty = live.reduce((s, r) => s + (r.count || 1), 0);
    const soldQty = sold.reduce((s, r) => s + (r.count || 1), 0);
    const soldAvg = soldQty ? sold.reduce((s, r) => s + r.unitPrice * (r.count || 1), 0) / soldQty : 0;
    const lowest = prices.length ? Math.min(...prices) : 0;
    const gap = lowest && soldAvg ? ((lowest - soldAvg) / soldAvg) * 100 : null;

    box.innerHTML = `
      <div class="panel panel--pad live-card">
        <div class="live-head">
          <span class="item-cell" style="${D.rarityStyle(first.itemRarity)}"><span class="item-icon">${first.itemId ? `<img src="${D.IMG.item(first.itemId)}" alt="" width="28" height="28">` : ''}</span>
          <span><span class="item-name live-name">${D.esc(first.itemName)}</span><span class="item-sub">${D.esc(first.itemRarity || '')}${first.itemTypeDetail || first.itemType ? ' · ' + D.esc(first.itemTypeDetail || first.itemType) : ''}</span></span></span>
          <span class="lab-code">LIVE</span>
        </div>
        <div class="result-grid">
          <div class="result-cell result-cost"><span>현재 최저가</span><strong>${lowest ? `${D.gold(lowest)}` : '-'}</strong><small>${lowest ? '골드 · 개당' : '판매 중인 매물 없음'}</small></div>
          <div class="result-cell"><span>판매 중</span><strong>${D.num(live.length)}건</strong><small>총 ${D.num(qty)}개</small></div>
          <div class="result-cell"><span>최근 거래 평균</span><strong>${soldAvg ? D.gold(Math.round(soldAvg)) : '-'}</strong><small>${sold.length ? `최근 ${D.num(sold.length)}건 · 개당` : '거래 기록 없음'}</small></div>
          <div class="result-cell"><span>최저가 vs 거래 평균</span><strong class="${gap === null ? '' : gap > 0 ? 'trend-up' : 'trend-down'}">${gap === null ? '-' : `${gap > 0 ? '▲' : '▼'} ${Math.abs(gap).toFixed(1)}%`}</strong><small>${gap === null ? '' : gap > 0 ? '최근 거래보다 비싸게 올라와 있어요' : '최근 거래보다 싸게 올라와 있어요'}</small></div>
        </div>
        <h3 class="live-sub">최근 거래 동향</h3>
        ${soldChart(sold)}
        <div class="live-cols">
          <div>
            <h3 class="live-sub">현재 최저가 매물</h3>
            ${live.length ? `<div class="table-wrap"><table class="data-table live-table"><thead><tr><th scope="col" class="num">개당</th><th scope="col" class="num">수량</th><th scope="col" class="num">총액</th><th scope="col">옵션</th><th scope="col">만료</th></tr></thead><tbody>
              ${live.slice(0, 10).map((r) => `<tr><td class="num"><strong>${D.gold(r.unitPrice)}</strong></td><td class="num">${D.num(r.count || 1)}</td><td class="num">${D.gold(r.price || r.unitPrice * (r.count || 1))}</td>
                <td>${[r.reinforce ? `+${r.reinforce}${r.amplificationName ? ' 증폭' : ''}` : '', r.refine ? `제련 ${r.refine}` : ''].filter(Boolean).join(' · ') || '-'}</td><td>${D.esc(hm(r.expireDate))}</td></tr>`).join('')}
            </tbody></table></div>` : '<p class="help">지금 판매 중인 매물이 없어요.</p>'}
          </div>
          <div>
            <h3 class="live-sub">최근 거래 기록</h3>
            ${sold.length ? `<div class="table-wrap"><table class="data-table live-table"><thead><tr><th scope="col">거래 시각</th><th scope="col" class="num">개당</th><th scope="col" class="num">수량</th></tr></thead><tbody>
              ${sold.slice(0, 10).map((r) => `<tr><td>${D.esc(hm(r.soldDate))}</td><td class="num"><strong>${D.gold(r.unitPrice)}</strong></td><td class="num">${D.num(r.count || 1)}</td></tr>`).join('')}
            </tbody></table></div>` : '<p class="help">최근 거래 기록이 없어요.</p>'}
          </div>
        </div>
        <p class="help">경매장 정보는 검색할 때 바로 조회해요(1~2분 동안은 같은 결과를 보여줘요). 실제 구매 전에는 게임에서 다시 확인해 주세요.</p>
      </div>`;
  }

  // 최근 거래를 시간 순서로: 점 = 거래 1건, 선 = 최근 10건 이동 평균
  function soldChart(sold) {
    const pts = sold.map((r) => ({ t: time(r.soldDate), v: r.unitPrice, s: r.soldDate })).filter((p) => p.t).sort((a, b) => a.t - b.t);
    if (pts.length < 2) return '<p class="help">거래 기록이 2건 이상 있어야 그래프가 나와요.</p>';
    const W = 720, H = 200, L = 70, R = 14, T = 14, B = 28;
    const vals = pts.map((p) => p.v).sort((a, b) => a - b);
    // 너무 튀는 값 때문에 그래프가 납작해지지 않게 위·아래 5%를 기준선으로
    let lo = vals[Math.floor(vals.length * 0.05)], hi = vals[Math.ceil(vals.length * 0.95) - 1];
    if (lo === hi) { lo *= 0.95; hi *= 1.05; }
    const pad = (hi - lo) * 0.15; lo = Math.max(0, lo - pad); hi += pad;
    const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1;
    const x = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - T - B);
    const ma = pts.map((p, i) => { const a = pts.slice(Math.max(0, i - 9), i + 1); return a.reduce((s, q) => s + q.v, 0) / a.length; });
    const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(ma[i]).toFixed(1)}`).join(' ');
    const ticks = [hi, (hi + lo) / 2, lo];
    const labels = [pts[0], pts[Math.floor(pts.length / 2)], pts[pts.length - 1]];
    return `<div class="price-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="최근 거래 ${pts.length}건 개당 가격 그래프">
      ${ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="axis" x="${L - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${D.gold(Math.round(t))}</text>`).join('')}
      ${pts.map((p) => `<circle class="dot dot--trade" cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="2.6"><title>${hm(p.s)} · ${D.gold(p.v)} 골드</title></circle>`).join('')}
      <path class="line" d="${line}"/>
      ${labels.map((p) => `<text class="axis" x="${x(p.t).toFixed(1)}" y="${H - 8}" text-anchor="middle">${hm(p.s)}</text>`).join('')}
    </svg><p class="help">점 = 거래 1건, 선 = 최근 10건 평균 · 점에 마우스를 올리면 시각과 가격이 보여요.</p></div>`;
  }
})();
