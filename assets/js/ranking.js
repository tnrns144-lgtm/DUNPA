/* 명성 랭킹 페이지: 전체·서버별 랭킹(data/fame.json)과 직업별 랭킹(data/jobs.json) */
(function () {
  const D = window.DNF;
  const $ = (id) => document.getElementById(id);
  let fame = null;
  let jobs = null;
  let mode = 'all';

  document.addEventListener('DOMContentLoaded', async () => {
    D.fillServerSelect($('rank-server'));
    [fame, jobs] = await Promise.all([D.getJSON('data/fame.json').catch(() => null), D.getJSON('data/jobs.json').catch(() => null)]);
    if (fame?.updatedAt) $('rank-updated').textContent = `${D.timeLabel(fame.updatedAt)} 기준`;

    // 직업 선택: 직업군 묶음(optgroup) 안에 전직
    const list = jobs?.jobs || [];
    const groups = new Map();
    list.forEach((j, i) => { if (!groups.has(j.jobName)) groups.set(j.jobName, []); groups.get(j.jobName).push({ j, i }); });
    $('rank-job').innerHTML = [...groups.entries()].map(([g, arr]) =>
      `<optgroup label="${D.esc(g)}">${arr.map(({ j, i }) => `<option value="${i}">${D.esc(j.finalName)}</option>`).join('')}</optgroup>`).join('');

    // 주소로 바로 열기: ranking.html#job (직업별)
    if (location.hash === '#job' && list.length) mode = 'job';
    $('rank-mode').addEventListener('click', (e) => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      mode = b.dataset.mode;
      sync();
    });
    $('rank-server').addEventListener('change', render);
    $('rank-job').addEventListener('change', render);
    sync();
  });

  function sync() {
    $('rank-mode').querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('rank-server').hidden = mode !== 'all';
    $('rank-job').hidden = mode !== 'job';
    render();
  }

  function rowsNow() {
    if (mode === 'job') {
      const j = (jobs?.jobs || [])[Number($('rank-job').value)];
      return { rows: j ? j.rankers.map((c) => ({ ...c, jobGrowName: c.jobGrowName || j.finalName })) : [], job: j };
    }
    const s = $('rank-server').value;
    return { rows: s === 'all' ? (fame?.all || []) : ((fame?.byServer || {})[s] || []) };
  }

  function render() {
    const { rows, job } = rowsNow();
    const body = $('rank-body');
    if (!rows.length) {
      body.innerHTML = `<div class="panel">${D.emptyState(mode === 'job' ? '직업별 랭킹을 모으는 중이에요' : '랭킹 수집 전이에요', '자동으로 채워져요.')}</div>`;
      return;
    }
    const top = rows.slice(0, 3);
    const rest = rows.slice(3);
    const label = (r) => `${D.esc(r.jobGrowName || r.jobName || '')} · ${D.esc(D.serverName(r.serverId))}`;
    body.innerHTML = `
      ${job ? `<p class="help">${D.esc(job.finalName)}(${D.esc(job.jobName)}) 명성 상위 랭커 · 하루 한 번 갱신 · <a href="jobs.html">직업별 랭커 세팅 보기 ›</a></p>` : ''}
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
      ${rest.length ? `<div class="panel table-wrap rank-table-wrap"><table class="data-table rank-table">
        <thead><tr><th scope="col" class="num">순위</th><th scope="col">캐릭터</th><th scope="col">직업</th><th scope="col">서버</th><th scope="col" class="num">명성</th></tr></thead>
        <tbody>${rest.map((r, i) => `<tr>
          <td class="num rank-no">${i + 4}</td>
          <td><a class="rank-char" href="${D.characterLink(r.serverId, r.characterId)}"><span class="rank-thumb"><img src="${D.IMG.character(r.serverId, r.characterId, 1)}" alt="" loading="lazy"></span><strong>${D.esc(r.characterName)}</strong></a></td>
          <td>${D.esc(r.jobGrowName || r.jobName || '')}</td>
          <td>${D.esc(D.serverName(r.serverId))}</td>
          <td class="num"><strong class="rank-fame">${D.num(r.fame)}</strong></td></tr>`).join('')}</tbody>
      </table></div>` : ''}`;
  }
})();
