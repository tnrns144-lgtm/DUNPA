/* 연구실: 강화·증폭·안전 강화 시뮬레이터 화면 (계산은 enhance-engine.js) */
(function () {
  const D = window.DNF;
  const E = window.EnhanceEngine;
  const $ = (id) => document.getElementById(id);

  const state = { mode: 'reinforce', part: 'weapon' };
  const tryState = { level: 10, count: 0, tickets: 0, gold: 0, dead: false, fails: 0 };
  const prices = {}; // 경매장 평균 시세 { 이름: 골드 }

  document.addEventListener('DOMContentLoaded', async () => {
    bindChips('[data-mode]', 'mode', () => { syncMode(); renderTable(); resetTry(); });
    bindChips('[data-part]', 'part', () => { renderTable(); resetTry(); });
    ['from', 'to'].forEach((id) => $(id).addEventListener('change', () => { clampLevels(); renderTable(); resetTry(); }));
    $('ticket').addEventListener('change', resetTry);
    $('sim-form').addEventListener('submit', (e) => { e.preventDefault(); runSimulation(); });
    $('try-one').addEventListener('click', () => tryOnce());
    $('try-goal').addEventListener('click', tryToGoal);
    $('try-reset').addEventListener('click', resetTry);
    // − / + 버튼으로 단계 조절
    document.querySelectorAll('[data-step]').forEach((b) => b.addEventListener('click', () => {
      const el = $(b.dataset.step);
      el.value = (parseInt(el.value, 10) || 0) + Number(b.dataset.d);
      if (b.dataset.step === 'from' && Number($('to').value) <= Number(el.value)) $('to').value = Number(el.value) + 1;
      el.dispatchEvent(new Event('change'));
    }));
    // 빠른 선택 (예: 10 → 12)
    document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
      const [a, z] = b.dataset.preset.split('-').map(Number);
      $('from').value = a;
      $('to').value = z;
      $('to').dispatchEvent(new Event('change'));
    }));

    syncMode();
    renderTable();
    resetTry();
    await loadPrices();
  });

  const rule = () => E.RULES[state.mode];
  const part = () => (rule().hasPart ? state.part : 'weapon');

  function bindChips(selector, key, onChange) {
    const chips = document.querySelectorAll(selector);
    chips.forEach((btn) => btn.addEventListener('click', () => {
      chips.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      state[key] = btn.dataset[key];
      onChange();
    }));
  }

  // 종류에 따라 보이는 입력칸을 바꿔요
  function syncMode() {
    const r = rule();
    $('part-row').hidden = !r.hasPart;
    $('ticket-row').hidden = !!r.noTicket;
    $('ticket-label').textContent = r.ticketName || '보호권';
    $('cost-custom').hidden = !!r.cost;
    $('cost-mat').hidden = state.mode !== 'amplify';
    $('cost-ticket').hidden = !!r.noTicket;
    $('cost-note').textContent = r.costNote;
    $('to').max = r.max;
    $('from').max = r.max - 1;
    if (r.max < 31 && Number($('to').value) > r.max) { $('to').value = r.max; if (Number($('from').value) >= r.max) $('from').value = r.max - 1; }
    fillTicketPrice();
  }

  function clampLevels() {
    const max = rule().max;
    let from = Math.max(0, Math.min(max - 1, parseInt($('from').value, 10) || 0));
    let to = Math.max(1, Math.min(max, parseInt($('to').value, 10) || 1));
    if (to <= from) to = Math.min(max, from + 1);
    $('from').value = from;
    $('to').value = to;
    return { from, to };
  }

  // 경매장 시세(data/auction.json의 reference·categories)에서 재료 가격을 자동으로 채워요
  async function loadPrices() {
    let data = null;
    try { data = await D.getJSON('data/auction.json'); } catch (e) { return; }
    (data.reference || []).concat((data.categories || []).flatMap((c) => c.items || [])).forEach((it) => {
      if (it.avgPrice && !(it.itemName in prices)) prices[it.itemName] = Math.round(it.avgPrice);
    });
    if (prices['무색 큐브 조각']) $('p-cube').value = prices['무색 큐브 조각'];
    if (prices['모순의 결정체']) { $('p-mat').value = prices['모순의 결정체']; $('p-mat-src').textContent = '골드/개 · 경매장 평균'; }
    fillTicketPrice();
  }

  function fillTicketPrice() {
    const name = rule().ticketName;
    const p = name && prices[name];
    $('p-ticket').value = p || 0;
    $('p-ticket-src').textContent = p ? `골드/장 · ${name} 경매장 평균` : '골드/장 · 시세 정보 없음, 직접 입력';
  }

  const num = (id) => Math.max(0, Number($(id).value) || 0);
  // n단계 시도 1회의 골드
  function goldOf(n) {
    if (!rule().cost) return num('c-gold') + num('c-cube') * num('p-cube');
    return E.attemptGold(state.mode, n, { '모순의 결정체': num('p-mat') });
  }

  function opts() {
    const { from, to } = clampLevels();
    return { mode: state.mode, part: part(), from, to, useTicket: !rule().noTicket && $('ticket').checked };
  }

  const fmtTries = (n) => (n >= 100 ? D.num(Math.round(n)) : n.toFixed(1));
  // 추정치라서 100만 골드 이상은 만 단위로 반올림해서 보여줘요
  const fmtGold = (n) => (n > 0 ? `${D.gold(n >= 1e6 ? Math.round(n / 1e4) * 1e4 : Math.round(n))} 골드` : '-');
  const partLabel = (o) => (rule().weaponOnly ? '무기' : !rule().hasPart ? '전 부위' : o.part === 'weapon' ? '무기' : '방어구·악세·특수');

  // 목표까지 드는 재료 개수 (평균). 시도 비용과 같은 방식으로 정확히 계산해요
  function matTotals(o) {
    const r = rule();
    if (!r.cost) return [];
    return r.cost(o.to).mats.map((m) => ({
      name: m.name,
      shopOnly: !!m.shopOnly,
      count: E.exact(o, (n) => (r.cost(n).mats.find((x) => x.name === m.name) || { count: 0 }).count).avgGold
    }));
  }

  function runSimulation() {
    const o = opts();
    const ex = E.exact(o, goldOf);
    const ticketGold = ex.avgTickets * num('p-ticket');
    const expCost = ex.avgGold + ticketGold;
    const budget = 3e6;
    const runs = Math.min(10000, Math.floor(budget / Math.max(1, ex.avgTries)));
    const sim = runs >= 300 ? E.simulate({ ...o, runs, maxTries: Math.ceil(ex.avgTries * 50) + 100 }) : null;
    const r = rule();
    const avgPerTry = ex.avgTries ? ex.avgGold / ex.avgTries : 0;
    const matList = matTotals(o);
    const mats = matList.filter((m) => m.shopOnly).map((m) => `${m.name} 평균 ${D.num(Math.round(m.count))}개 별도`).join('');
    const matLine = matList.length ? `<p class="help">평균 재료: ${matList.map((m) => `${m.name} ${D.num(Math.round(m.count))}개${m.shopOnly ? '(상점 재료, 골드 환산 제외)' : ''}`).join(' · ')}</p>` : '';

    $('sim-result').innerHTML = `
      <div class="report-head"><h3 class="side-title">실험 결과</h3><span class="lab-code">${o.from}${r.sign} → ${o.to}${r.sign}</span>
        <span class="report-date">${r.name} · ${partLabel(o)}${r.noTicket ? '' : o.useTicket ? ' · 보호권 사용' : ' · 보호권 없음'}</span></div>
      <div class="result-grid">
        <div class="result-cell"><span>성공 확률</span><strong>${(ex.successRate * 100).toFixed(ex.successRate < 0.01 ? 3 : 1)}%</strong><small>${r.noTicket ? '실패해도 단계가 그대로라 언젠가 반드시 성공' : o.useTicket ? '보호권이 있으면 언젠가 반드시 성공' : '파괴되기 전에 목표에 닿을 확률'}</small></div>
        <div class="result-cell"><span>평균 시도</span><strong>${fmtTries(ex.avgTries)}회</strong><small>${o.useTicket || r.noTicket ? '목표까지' : '성공 또는 파괴까지'}</small></div>
        ${o.useTicket ? `<div class="result-cell"><span>평균 보호권</span><strong>${fmtTries(ex.avgTickets)}장</strong><small>파괴될 뻔한 횟수</small></div>`
          : r.noTicket ? '' : `<div class="result-cell"><span>파괴 확률</span><strong>${((1 - ex.successRate) * 100).toFixed(1)}%</strong><small>목표 전에 장비가 사라질 확률</small></div>`}
        <div class="result-cell result-cost"><span>예상 비용 (평균)</span><strong>${fmtGold(expCost)}</strong>
          <small>${expCost > 0 ? [`시도 ${fmtGold(ex.avgGold)}`, ticketGold ? `보호권 ${fmtGold(ticketGold)}` : '', mats].filter(Boolean).join(' + ') : '비용 칸을 채우면 계산돼요'}</small></div>
      </div>
      ${matLine}
      ${sim ? `
      <div class="luck-row">
        <div><span>운 좋을 때 (절반은 이 안에)</span><strong>${fmtTries(sim.medianTries)}회</strong><small>약 ${fmtGold(sim.medianTries * avgPerTry)}</small></div>
        <div><span>운 나쁠 때 (10명 중 1명은 이보다 많이)</span><strong>${fmtTries(sim.p90Tries)}회</strong><small>약 ${fmtGold(sim.p90Tries * avgPerTry)}</small></div>
      </div>
      <p class="help">평균값은 공식 확률로 정확히 계산했고, 운 좋을 때·나쁠 때는 ${D.num(sim.runs)}번 반복 실험한 결과예요.</p>`
      : '<p class="help">시도 횟수가 너무 많은 조건이라 반복 실험은 생략하고 평균만 정확히 계산했어요.</p>'}`;
  }

  /* ---------- 직접 강화해 보기 ---------- */
  function resetTry() {
    const o = opts();
    Object.assign(tryState, { level: o.from, count: 0, tickets: 0, gold: 0, dead: false, fails: 0 });
    $('try-log').innerHTML = '';
    paintTry('', '왼쪽 조건으로 시작해요');
  }

  function curRate() {
    const r = rule();
    const n = tryState.level + 1;
    return Math.min(100, r.rate(n) + (r.bonus ? r.bonus(n) * tryState.fails : 0));
  }

  function paintTry(cls, msg) {
    const o = opts();
    $('try-level').textContent = tryState.dead ? '파괴' : `+${tryState.level}`;
    $('try-level').className = `try-level ${cls}`;
    $('try-state').textContent = msg || `${rule().name} ${tryState.level + 1}단계 성공 확률 ${curRate()}%${tryState.fails && rule().bonus ? ` (보정 +${curRate() - rule().rate(tryState.level + 1)}%p)` : ''}`;
    $('try-count').textContent = `${D.num(tryState.count)}회`;
    $('try-tickets').textContent = `${D.num(tryState.tickets)}장`;
    $('try-cost').textContent = tryState.gold > 0 ? `${D.gold(Math.round(tryState.gold))} 골드` : '0 골드';
    $('try-one').disabled = tryState.dead || tryState.level >= o.to;
    $('try-goal').disabled = $('try-one').disabled;
  }

  function log(text, cls) {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = text;
    const ol = $('try-log');
    ol.prepend(li);
    while (ol.children.length > 30) ol.lastChild.remove();
  }

  function step(o) {
    const before = tryState.level;
    const res = E.attempt(o.mode, o.part, before, o.useTicket, Math.random, tryState.fails);
    tryState.count++;
    tryState.gold += goldOf(before + 1);
    if (res.usedTicket) { tryState.tickets++; tryState.gold += num('p-ticket'); }
    tryState.fails = res.ok || res.level !== before ? 0 : tryState.fails + 1;
    tryState.dead = res.destroyed;
    tryState.level = res.level;
    return { res, before };
  }

  function tryOnce() {
    const o = opts();
    if (tryState.dead || tryState.level >= o.to) return;
    const { res, before } = step(o);
    const n = `#${tryState.count}`;
    if (res.ok) log(`${n} +${before} → +${res.level} 성공!`, 'ok');
    else if (res.destroyed) log(`${n} +${before + 1} 실패… 장비가 파괴됐어요`, 'bad');
    else if (res.usedTicket) log(`${n} +${before + 1} 실패 · 보호권 사용으로 +0`, 'bad');
    else if (res.level < before) log(`${n} +${before + 1} 실패 · +${res.level}로 하락`, 'bad');
    else log(`${n} +${before + 1} 실패 · 단계 유지`, 'meh');
    const done = tryState.level >= o.to;
    paintTry(res.ok ? (done ? 'goal' : 'ok') : 'bad', done ? `목표 달성! ${D.num(tryState.count)}번 만에 +${tryState.level}` : res.destroyed ? '장비가 파괴됐어요. 처음부터 다시 해 보세요' : '');
  }

  function tryToGoal() {
    const o = opts();
    const start = tryState.count;
    let guard = 0;
    while (!tryState.dead && tryState.level < o.to && guard < 2000000) { step(o); guard++; }
    const used = tryState.count - start;
    if (tryState.dead) log(`자동 ${D.num(used)}회 · 결국 파괴됐어요`, 'bad');
    else if (tryState.level >= o.to) log(`자동 ${D.num(used)}회 만에 +${tryState.level} 달성`, 'ok');
    else log(`자동 ${D.num(used)}회 시도 후 멈춤 (너무 오래 걸려요)`, 'meh');
    paintTry(tryState.dead ? 'bad' : tryState.level >= o.to ? 'goal' : '', tryState.level >= o.to ? `목표 달성! 총 ${D.num(tryState.count)}번 만에 +${tryState.level}` : tryState.dead ? '장비가 파괴됐어요. 처음부터 다시 해 보세요' : '');
  }

  /* ---------- 확률표 ---------- */
  function renderTable() {
    const o = opts();
    const r = rule();
    const rows = E.table(o.mode, o.part, 0, Math.max(o.to, Math.min(17, r.max)));
    const failText = (f) => f.type === 'stay' ? '단계 유지' : f.type === 'drop' ? `${f.drop}단계 하락` : '파괴 (보호권: 0단계)';
    const costText = (c) => c ? `${D.gold(c.gold)} 골드 + ${c.mats.map((m) => `${m.name} ${D.num(m.count)}개`).join(', ')}` : '공식 미공개';
    $('rate-table').innerHTML = `<table class="data-table">
      <thead><tr><th scope="col">시도 단계</th><th scope="col" class="num">성공 확률</th>${r.bonus ? '<th scope="col" class="num">실패 시 보정</th>' : ''}<th scope="col">실패하면</th><th scope="col">1회 비용</th></tr></thead>
      <tbody>${rows.map((x) => `<tr class="${x.step > o.from && x.step <= o.to ? 'in-range' : ''}">
        <td>${x.step - 1}${r.sign} → ${x.step}${r.sign}</td><td class="num"><strong>${x.rate}%</strong></td>
        ${r.bonus ? `<td class="num">${x.bonus ? `+${x.bonus}%p` : '-'}</td>` : ''}
        <td class="${x.fail.type === 'destroy' ? 'trend-up' : x.fail.type === 'drop' ? 'trend-down' : 'trend-flat'}">${failText(x.fail)}</td>
        <td class="cost-cell">${costText(x.cost)}</td></tr>`).join('')}</tbody>
    </table>`;
  }
})();
