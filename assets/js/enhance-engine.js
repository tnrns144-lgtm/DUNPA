/*
 * 강화·증폭 계산 엔진 (화면과 분리해서 Node로도 검산할 수 있게 만든 순수 계산 코드)
 * 출처 (규칙이 바뀌면 RULES만 고치면 돼요)
 *   강화 확률  https://df.nexon.com/probability?no=139
 *   증폭 확률  https://df.nexon.com/probability?no=140
 *   강화 규칙·안전 강화 비용  https://df.nexon.com/guide?no=710 (2026-03-19)
 *   증폭 규칙  https://df.nexon.com/guide?no=727 (2025-07-03)
 *   증폭 비용  https://df.nexon.com/community/news/seriashop/556 (2025-04-17, 10증 이상 구간 공식 표)
 */
(function (root) {
  const SAFE_CORES = [29, 30, 31, 32, 59, 66, 72, 80, 90, 105, 356, 1108];
  const SAFE_GOLD = [180360, 180360, 180360, 180360, 359265, 400300, 432948, 481989, 546593, 633275, 2153040, 6704400];

  const RULES = {
    reinforce: {
      name: '강화', sign: '강', max: 31, hasPart: true, ticketName: '장비 보호권',
      // n단계를 '시도'할 때(n-1 → n) 성공 확률(%)
      rate(n) {
        const t = { 5: 80, 6: 70, 7: 60, 8: 50, 9: 40, 10: 30, 11: 25, 12: 15, 13: 14, 14: 13, 15: 12, 16: 11 };
        return n <= 4 ? 100 : (t[n] ?? 10);
      },
      // 실패하면: stay(유지) / drop(하락) / destroy(파괴)
      fail(n, part) {
        if (n <= 10) return { type: 'stay' };
        if (part === 'weapon' && n <= 12) return { type: 'drop', drop: 3 };
        return { type: 'destroy' };
      },
      cost: null, // 일반 강화 비용은 공식 미공개 → 사용자가 입력
      costNote: '일반 강화의 단계별 골드·재료는 공식 공개 자료가 없어요. 게임에서 확인한 1회 비용을 넣으면 예상 비용을 계산해 드려요.'
    },
    amplify: {
      name: '증폭', sign: '증', max: 31, hasPart: false, ticketName: '증폭 보호권',
      rate(n) {
        const t = { 5: 80, 6: 70, 7: 60, 8: 70, 9: 60, 10: 50, 11: 40, 12: 30 };
        return n <= 4 ? 100 : (t[n] ?? 20);
      },
      fail(n) {
        if (n <= 7) return { type: 'stay' };
        if (n <= 10) return { type: 'drop', drop: 3 };
        return { type: 'destroy' };
      },
      // 1회 418,880골드 + 모순의 결정체(목표 단계 수만큼)
      cost: (n) => ({ gold: 418880, mats: [{ name: '모순의 결정체', count: n }] }),
      costNote: '증폭 1회 비용: 418,880골드 + 모순의 결정체(목표 단계 수만큼). 공식 증폭권 안내(10증 이상 구간) 기준이고, 그 아래 단계도 같은 규칙으로 계산했어요.'
    },
    safe: {
      name: '안전 강화', sign: '강', max: 12, hasPart: false, weaponOnly: true, noTicket: true,
      rate(n) {
        const t = { 5: 80, 6: 70, 7: 60, 8: 50, 9: 40, 10: 30, 11: 8, 12: 3 };
        return n <= 4 ? 100 : t[n];
      },
      // 실패할 때마다 다음 시도 확률이 오르는 폭(%p). 성공하면 초기화
      bonus(n) { return n <= 4 ? 0 : n <= 10 ? 5 : n === 11 ? 2 : 1; },
      fail() { return { type: 'stay' }; },
      cost: (n) => ({ gold: SAFE_GOLD[n - 1], mats: [{ name: '라이언 코어', count: SAFE_CORES[n - 1], shopOnly: true }] }),
      costNote: '안전 강화(무기 전용, 12강까지)는 실패해도 단계가 그대로이고, 실패할수록 다음 확률이 올라요. 단계별 골드·라이언 코어는 공식 가이드 표 기준이에요(라이언 코어는 상점 재료라 골드 환산에서 빠져요).'
    }
  };

  const rateWithBonus = (rule, n, fails) => Math.min(100, rule.rate(n) + (rule.bonus ? rule.bonus(n) * fails : 0));

  // 한 번 시도. fails = 이번 단계에서 연속 실패한 횟수(안전 강화 보정용)
  function attempt(mode, part, level, useTicket, rng = Math.random, fails = 0) {
    const rule = RULES[mode];
    const target = level + 1;
    if (rng() * 100 < rateWithBonus(rule, target, fails)) return { ok: true, level: target, destroyed: false, usedTicket: false };
    const f = rule.fail(target, part);
    if (f.type === 'stay') return { ok: false, level, destroyed: false, usedTicket: false };
    if (f.type === 'drop') return { ok: false, level: Math.max(0, level - f.drop), destroyed: false, usedTicket: false };
    if (useTicket && !rule.noTicket) return { ok: false, level: 0, destroyed: false, usedTicket: true };
    return { ok: false, level, destroyed: true, usedTicket: false };
  }

  // 1회 시도 비용을 골드로 환산. prices: { 재료이름: 골드 }, custom: 일반 강화 사용자 입력 골드
  function attemptGold(mode, n, prices = {}, custom = 0) {
    const rule = RULES[mode];
    if (!rule.cost) return custom;
    const c = rule.cost(n);
    return c.gold + c.mats.reduce((s, m) => s + (m.shopOnly ? 0 : m.count * (prices[m.name] || 0)), 0);
  }

  /*
   * 반복 실험으로 분포(중간값, 상위 10%)를 냅니다.
   * opts: { mode, part, from, to, useTicket, runs, maxTries }
   */
  function simulate(opts, rng = Math.random) {
    const { mode, part, from, to, useTicket, runs = 10000, maxTries = 100000 } = opts;
    const tries = [];
    let success = 0;
    let destroyed = 0;
    let tickets = 0;
    for (let r = 0; r < runs; r++) {
      let level = from;
      let t = 0;
      let fails = 0;
      let dead = false;
      while (level < to && t < maxTries) {
        const res = attempt(mode, part, level, useTicket, rng, fails);
        t++;
        fails = res.ok ? 0 : fails + 1;
        if (res.usedTicket) tickets++;
        if (res.destroyed) { dead = true; break; }
        if (res.level !== level && !res.ok) fails = 0;
        level = res.level;
      }
      tries.push(t);
      if (dead) destroyed++;
      else if (level >= to) success++;
    }
    const sorted = [...tries].sort((a, b) => a - b);
    const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
      runs,
      successRate: success / runs,
      destroyRate: destroyed / runs,
      avgTries: tries.reduce((s, v) => s + v, 0) / runs,
      medianTries: pick(0.5),
      p90Tries: pick(0.9),
      avgTickets: tickets / runs
    };
  }

  /*
   * 정확한 기대값 (반복 실험 없이 계산)
   * 반환: { avgTries, avgTickets, successRate, avgGold(시도 비용 합), steps }
   * goldOf(n): n단계 시도 1회의 골드
   */
  function exact(opts, goldOf = () => 0) {
    const { mode, part, from, to, useTicket } = opts;
    const rule = RULES[mode];
    if (from >= to) return { avgTries: 0, avgTickets: 0, successRate: 1, avgGold: 0 };

    // 안전 강화: 실패해도 단계가 그대로라 단계마다 따로 계산하면 정확해요
    if (rule.bonus) {
      let tries = 0;
      let gold = 0;
      for (let n = from + 1; n <= to; n++) {
        let reach = 1;
        let e = 0;
        for (let j = 1; reach > 1e-12 && j < 1000; j++) {
          const p = rateWithBonus(rule, n, j - 1) / 100;
          e += reach; // j번째 시도까지 갈 확률만큼 시도 횟수가 늘어요
          reach *= 1 - p;
        }
        tries += e;
        gold += e * goldOf(n);
      }
      return { avgTries: tries, avgTickets: 0, successRate: 1, avgGold: gold };
    }

    // 일반 강화·증폭: 단계 사이를 오가므로 연립방정식으로 풀어요
    // V(l) = c(l) + p·V(l+1) + (1-p)·V(실패 후 단계)
    const n = to;
    const next = (l) => {
      const f = rule.fail(l + 1, part);
      if (f.type === 'stay') return { to: l, ticket: 0 };
      if (f.type === 'drop') return { to: Math.max(0, l - f.drop), ticket: 0 };
      return useTicket ? { to: 0, ticket: 1 } : { to: -1, ticket: 0 };
    };
    function solve(costOf, ticketCost, terminalSuccess) {
      const A = Array.from({ length: n }, () => new Array(n).fill(0));
      const b = new Array(n).fill(0);
      for (let l = 0; l < n; l++) {
        const p = rule.rate(l + 1) / 100;
        const nx = next(l);
        A[l][l] += 1;
        b[l] += costOf(l + 1);
        if (l + 1 >= n) b[l] += p * terminalSuccess; else A[l][l + 1] -= p;
        b[l] += (1 - p) * nx.ticket * ticketCost;
        if (nx.to !== -1) A[l][nx.to] -= (1 - p);
      }
      for (let c = 0; c < n; c++) {
        let piv = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
        [A[c], A[piv]] = [A[piv], A[c]];
        [b[c], b[piv]] = [b[piv], b[c]];
        for (let r = 0; r < n; r++) {
          if (r === c || !A[r][c]) continue;
          const k = A[r][c] / A[c][c];
          for (let j = c; j < n; j++) A[r][j] -= k * A[c][j];
          b[r] -= k * b[c];
        }
      }
      return b.map((v, i) => v / A[i][i])[from];
    }
    return {
      avgTries: solve(() => 1, 0, 0),
      avgTickets: solve(() => 0, 1, 0),
      successRate: solve(() => 0, 0, 1),
      avgGold: solve(goldOf, 0, 0)
    };
  }

  // 단계별 확률표 (화면 표시용)
  function table(mode, part, from, to) {
    const rule = RULES[mode];
    const rows = [];
    for (let n = from + 1; n <= Math.min(to, rule.max); n++) {
      rows.push({ step: n, rate: rule.rate(n), bonus: rule.bonus ? rule.bonus(n) : 0, fail: rule.fail(n, part), cost: rule.cost ? rule.cost(n) : null });
    }
    return rows;
  }

  const api = { RULES, attempt, attemptGold, simulate, exact, table };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EnhanceEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
