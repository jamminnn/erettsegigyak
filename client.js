const $ = (sel) => document.querySelector(sel);

const state = {
  examId: null,
  structure: null,
  activeSectionId: null,
  answers: {},
  evaluations: {},
  meta: null,
  officialSummary: null,
};

const SECTION_TITLES = {
  olvasott: 'Olvasott szöveg értése',
  nyelvhelyesseg: 'Nyelvhelyesség',
  hallott: 'Hallott szöveg értése',
  iras: 'Íráskészség',
};

// Hivatalos vizsgaidők (perc) — emelt szintű angol; hallgatást nem mérünk, az MP3 az időzítő
const SECTION_DURATIONS_MIN = {
  olvasott: 70,
  nyelvhelyesseg: 50,
  iras: 90,
};

// In-memory timer state per section: { remaining (sec), running (bool), intervalId }
const timers = {};
function fmtTime(sec) {
  const m = Math.floor(Math.abs(sec) / 60);
  const s = Math.abs(sec) % 60;
  const sign = sec < 0 ? '-' : '';
  return `${sign}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function getTimer(sectionId) {
  if (!timers[sectionId]) {
    const min = SECTION_DURATIONS_MIN[sectionId];
    if (!min) return null;
    timers[sectionId] = { remaining: min * 60, running: false, intervalId: null };
  }
  return timers[sectionId];
}
function startTimer(sectionId) {
  const t = getTimer(sectionId);
  if (!t || t.running) return;
  t.running = true;
  t.intervalId = setInterval(() => {
    t.remaining -= 1;
    updateTimerDisplay(sectionId);
  }, 1000);
  updateTimerDisplay(sectionId);
}
function pauseTimer(sectionId) {
  const t = timers[sectionId];
  if (!t) return;
  if (t.intervalId) { clearInterval(t.intervalId); t.intervalId = null; }
  t.running = false;
  updateTimerDisplay(sectionId);
}
function resetTimer(sectionId) {
  pauseTimer(sectionId);
  const min = SECTION_DURATIONS_MIN[sectionId];
  if (!min) return;
  timers[sectionId].remaining = min * 60;
  updateTimerDisplay(sectionId);
}
function updateTimerDisplay(sectionId) {
  const el = document.querySelector(`[data-timer="${sectionId}"]`);
  if (!el) return;
  const t = timers[sectionId];
  const display = el.querySelector('.timer-display');
  display.textContent = fmtTime(t.remaining);
  el.classList.toggle('expired', t.remaining < 0);
  el.classList.toggle('running', t.running);
  el.querySelector('.timer-start').disabled = t.running;
  el.querySelector('.timer-pause').disabled = !t.running;
}
function renderTimerBlock(sectionId) {
  const min = SECTION_DURATIONS_MIN[sectionId];
  if (!min) return '';
  const t = getTimer(sectionId);
  return `
    <div class="timer" data-timer="${sectionId}">
      <span class="timer-label">⏱ Hivatalos idő: ${min} perc</span>
      <span class="timer-display">${fmtTime(t.remaining)}</span>
      <button class="timer-start" onclick="window.__timer.start('${sectionId}')">Indítás</button>
      <button class="timer-pause" onclick="window.__timer.pause('${sectionId}')" disabled>Megállít</button>
      <button class="timer-reset" onclick="window.__timer.reset('${sectionId}')">Visszaállít</button>
    </div>
  `;
}
window.__timer = { start: startTimer, pause: pauseTimer, reset: resetTimer };

function key(taskId, itemId) { return `${taskId}__${itemId}`; }

function setStatus(msg) { $('#status').textContent = msg || ''; }

async function loadExam() {
  const subject = $('#subject').value;
  const year = parseInt($('#year').value, 10);
  const season = $('#season').value;
  const examId = `${subject}_${year}_${season}`;
  $('#loadBtn').disabled = true;
  try {
    // 1) Use cached structure from localStorage if we already parsed this exam
    const local = loadLocal(examId);
    let structure = local.structure;
    if (!structure || !Array.isArray(structure.sections)) {
      setStatus('Letöltés és feldolgozás (~30-60 mp első alkalommal)...');
      const r = await fetch('/api/load-exam', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, year, season }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Hiba');
      if (!data.structure || !Array.isArray(data.structure.sections)) {
        throw new Error('A vizsga struktúrája hiányos. Próbáld újra.');
      }
      structure = data.structure;
    } else {
      setStatus('Betöltve cache-ből.');
    }

    state.examId = examId;
    state.structure = structure;
    state.meta = { subject, year, season };
    state.answers = local.answers || {};
    state.evaluations = local.evaluations || {};
    state.officialSummary = local.officialSummary || null;
    saveLocal(examId);
    state.activeSectionId = structure.sections[0]?.id || null;
    renderTabs();
    renderOverall();
    renderSection();
    setStatus(`Betöltve: ${subject} ${year} ${season}`);
  } catch (err) {
    setStatus('Hiba: ' + err.message);
  } finally {
    $('#loadBtn').disabled = false;
  }
}

function renderTabs() {
  const nav = $('#sectionTabs');
  nav.innerHTML = '';
  for (const sec of state.structure.sections) {
    const btn = document.createElement('button');
    const ev = state.evaluations[sec.id];
    const badge = ev ? `<span class="badge">${ev.total_points}/${ev.total_max}</span>` : '';
    btn.innerHTML = `${SECTION_TITLES[sec.id] || sec.title}${badge}`;
    if (sec.id === state.activeSectionId) btn.classList.add('active');
    btn.onclick = () => { state.activeSectionId = sec.id; renderTabs(); renderSection(); };
    nav.appendChild(btn);
  }
}

function renderSection() {
  const area = $('#taskArea');
  const resultArea = $('#resultArea');
  area.innerHTML = '';
  resultArea.innerHTML = '';
  if (!state.activeSectionId) {
    area.innerHTML = '<div class="empty">Tölts be egy vizsgát.</div>';
    return;
  }
  const sec = state.structure.sections.find(s => s.id === state.activeSectionId);
  const sectionAnswers = state.answers[sec.id] || {};

  const timerHtml = renderTimerBlock(sec.id);
  if (timerHtml) {
    const wrap = document.createElement('div');
    wrap.innerHTML = timerHtml;
    area.appendChild(wrap.firstElementChild);
    updateTimerDisplay(sec.id);
  }

  if (sec.id === 'hallott') {
    const audioUrl = buildAudioUrl();
    const note = document.createElement('div');
    note.className = 'audio-note';
    note.innerHTML = `🎧 A hanganyagot külön nyisd meg: <a href="${audioUrl}" target="_blank">${audioUrl}</a>`;
    area.appendChild(note);
  }

  for (const task of sec.tasks) {
    const wrap = document.createElement('div');
    wrap.className = 'task';
    wrap.innerHTML = `
      <h3>${task.id}. feladat ${task.max_points ? `<small>(${task.max_points} pont)</small>` : ''}</h3>
      <div class="instruction">${escapeHtml(task.instruction || '')}</div>
      ${task.notes ? `<div class="instruction"><em>${escapeHtml(task.notes)}</em></div>` : ''}
    `;

    if (task.shared_options && task.shared_options.length) {
      const optsList = document.createElement('div');
      optsList.className = 'shared-options';
      optsList.innerHTML = '<strong>Választható válaszok:</strong><ul>' +
        task.shared_options.map(o => `<li>${escapeHtml(o)}</li>`).join('') + '</ul>';
      wrap.appendChild(optsList);
    }

    for (const item of (task.items || [])) {
      const itemDiv = document.createElement('div');
      itemDiv.className = 'item';
      const k = key(task.id, item.id);
      const saved = sectionAnswers[k] ?? '';
      const promptHtml = `<div class="prompt"><strong>${item.id}.</strong> ${escapeHtml(item.prompt || '')}</div>`;

      const itemOptions = (item.options && item.options.length) ? item.options
        : (task.shared_options && task.shared_options.length) ? task.shared_options
        : null;

      if (itemOptions) {
        if (task.multi_select) {
          // Checkboxes — answer is array
          const savedArr = Array.isArray(saved) ? saved : (saved ? [saved] : []);
          const opts = itemOptions.map(opt => `
            <label><input type="checkbox" name="${k}" value="${escapeHtml(opt)}" ${savedArr.includes(opt) ? 'checked' : ''}>
            ${escapeHtml(opt)}</label>
          `).join('');
          itemDiv.innerHTML = promptHtml + `<div class="options multi">${opts}</div>`;
          itemDiv.querySelectorAll('input[type=checkbox]').forEach(inp => {
            inp.onchange = () => {
              const checked = [...itemDiv.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
              updateAnswer(sec.id, k, checked);
            };
          });
        } else if (itemOptions.length > 5) {
          // Many options → dropdown
          const opts = `<option value="">— válassz —</option>` + itemOptions.map(opt =>
            `<option value="${escapeHtml(opt)}" ${saved === opt ? 'selected' : ''}>${escapeHtml(opt)}</option>`
          ).join('');
          itemDiv.innerHTML = promptHtml + `<select data-key="${k}">${opts}</select>`;
          itemDiv.querySelector('select').onchange = (e) => updateAnswer(sec.id, k, e.target.value);
        } else {
          const opts = itemOptions.map(opt => `
            <label><input type="radio" name="${k}" value="${escapeHtml(opt)}" ${saved === opt ? 'checked' : ''}>
            ${escapeHtml(opt)}</label>
          `).join('');
          itemDiv.innerHTML = promptHtml + `<div class="options">${opts}</div>`;
          itemDiv.querySelectorAll('input[type=radio]').forEach(inp => {
            inp.onchange = (e) => updateAnswer(sec.id, k, e.target.value);
          });
        }
      } else if (task.type === 'essay') {
        itemDiv.innerHTML = promptHtml + `<textarea data-key="${k}">${escapeHtml(saved)}</textarea>`;
        const ta = itemDiv.querySelector('textarea');
        ta.style.minHeight = '12rem';
        ta.oninput = (e) => updateAnswer(sec.id, k, e.target.value);
      } else {
        itemDiv.innerHTML = promptHtml + `<input type="text" data-key="${k}" value="${escapeHtml(saved)}">`;
        itemDiv.querySelector('input').oninput = (e) => updateAnswer(sec.id, k, e.target.value);
      }
      wrap.appendChild(itemDiv);
    }
    area.appendChild(wrap);
  }

  const actions = document.createElement('div');
  actions.className = 'actions';
  actions.innerHTML = `<button class="primary" id="evalBtn">Értékelés ezen a részen</button>`;
  area.appendChild(actions);
  $('#evalBtn').onclick = () => evaluateActive();

  if (state.evaluations[sec.id]) {
    renderResult(state.evaluations[sec.id]);
  }
}

function renderOverall() {
  const area = $('#overallSummary');
  if (!state.structure) { area.innerHTML = ''; return; }

  const sections = state.structure.sections;
  const evaluated = sections.filter(s => state.evaluations[s.id]);
  if (evaluated.length === 0) { area.innerHTML = ''; return; }

  const totals = evaluated.reduce((acc, s) => {
    const e = state.evaluations[s.id];
    acc.points += (e.total_points ?? 0);
    acc.max += (e.total_max ?? 0);
    return acc;
  }, { points: 0, max: 0 });

  const allDone = evaluated.length === sections.length;
  const pct = totals.max > 0 ? Math.round((totals.points / totals.max) * 1000) / 10 : 0;

  const rows = sections.map(s => {
    const e = state.evaluations[s.id];
    if (!e) return `<tr><td>${SECTION_TITLES[s.id] || s.title}</td><td colspan="2"><em>még nincs értékelve</em></td></tr>`;
    const sectionPct = e.total_max > 0 ? Math.round((e.total_points / e.total_max) * 1000) / 10 : 0;
    return `<tr><td>${SECTION_TITLES[s.id] || s.title}</td><td>${e.total_points}/${e.total_max}</td><td>${sectionPct}%</td></tr>`;
  }).join('');

  const headerLabel = allDone ? '🎓 Teljes vizsga eredménye' : `Részeredmény (${evaluated.length}/${sections.length} rész kész)`;

  const summaryBtn = allDone
    ? `<button id="summarizeBtn" class="primary" style="margin-top:0.75rem;">Hivatalos vizsgapont számítás (útmutató alapján)</button>`
    : '';

  const officialBlock = state.officialSummary ? renderOfficialSummary(state.officialSummary) : '';

  area.innerHTML = `
    <div class="overall ${allDone ? 'all-done' : ''}">
      <h2>${headerLabel}</h2>
      <div class="big">${totals.points} / ${totals.max} feladatpont &nbsp; · &nbsp; <strong>${pct}%</strong></div>
      <table class="overall-table">
        <thead><tr><th>Rész</th><th>Feladatpont</th><th>%</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${summaryBtn}
      ${officialBlock}
    </div>
  `;

  const btn = $('#summarizeBtn');
  if (btn) btn.onclick = runSummarize;
}

function renderOfficialSummary(s) {
  const sectionRows = (s.sections || []).map(x =>
    `<tr><td>${SECTION_TITLES[x.section_id] || x.section_id}</td>
     <td>${x.feladatpont}/${x.max_feladatpont}</td>
     <td>${x.vizsgapont}/${x.max_vizsgapont}</td></tr>`
  ).join('');
  return `
    <div class="official">
      <h3>📋 Hivatalos vizsgapont</h3>
      <div class="big">${s.total_vizsgapont} / ${s.max_vizsgapont} vizsgapont &nbsp; · &nbsp; <strong>${s.percentage}%</strong></div>
      ${s.grade_estimate ? `<div class="grade">Becsült osztályzat: <strong>${escapeHtml(s.grade_estimate)}</strong></div>` : ''}
      <table class="overall-table">
        <thead><tr><th>Rész</th><th>Feladatpont</th><th>Vizsgapont</th></tr></thead>
        <tbody>${sectionRows}</tbody>
      </table>
      <div class="conversion-note">${escapeHtml(s.conversion_note || '')}</div>
    </div>
  `;
}

async function runSummarize() {
  const btn = $('#summarizeBtn');
  btn.disabled = true; btn.textContent = 'Számolás folyamatban...';
  try {
    const r = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...state.meta, evaluations: state.evaluations }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || 'Hiba');
    state.officialSummary = data;
    saveLocal(state.examId);
    renderOverall();
  } catch (err) {
    alert('Hiba: ' + err.message);
    btn.disabled = false;
    btn.textContent = 'Hivatalos vizsgapont számítás (útmutató alapján)';
  }
}

function buildAudioUrl() {
  const { subject, year, season } = state.meta;
  const yy = String(year).slice(2);
  const monthCode = season === 'tavasz' ? 'maj' : 'okt';
  const folder = `feladatok_${year}${season}_emelt`;
  return `https://www.oktatas.hu/bin/content/dload/erettsegi/${folder}/e_${subject}_${yy}${monthCode}_fl.mp3`;
}

function lsKey(examId) { return `erettsegi:${examId}`; }
function loadLocal(examId) {
  try { return JSON.parse(localStorage.getItem(lsKey(examId))) || {}; }
  catch { return {}; }
}
function saveLocal(examId) {
  if (!examId) return;
  const data = {
    structure: state.structure,
    answers: state.answers,
    evaluations: state.evaluations,
    officialSummary: state.officialSummary,
  };
  try { localStorage.setItem(lsKey(examId), JSON.stringify(data)); }
  catch (e) { console.warn('localStorage tele vagy elérhetetlen:', e); }
}

let saveTimer = null;
function updateAnswer(sectionId, k, value) {
  state.answers[sectionId] = state.answers[sectionId] || {};
  state.answers[sectionId][k] = value;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveLocal(state.examId), 400);
}

async function evaluateActive() {
  const sec = state.structure.sections.find(s => s.id === state.activeSectionId);
  const btn = $('#evalBtn');
  btn.disabled = true; btn.textContent = 'Értékelés folyamatban...';
  try {
    const r = await fetch('/api/evaluate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...state.meta,
        section: sec,
        answers: state.answers[sec.id] || {},
      }),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error || 'Hiba');
    state.evaluations[sec.id] = result;
    state.officialSummary = null;
    saveLocal(state.examId);
    renderResult(result);
    renderTabs();
    renderOverall();
  } catch (err) {
    alert('Hiba: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Értékelés ezen a részen';
  }
}

function renderResult(result) {
  const area = $('#resultArea');
  const itemsHtml = (result.items || []).map(it => `
    <div class="result-item">
      <div>
        <span class="points ${it.points_awarded < it.max_points ? 'wrong' : ''}">
          ${it.points_awarded}/${it.max_points} pont
        </span>
        — <strong>${escapeHtml(it.task_id)}.${escapeHtml(it.item_id || '')}</strong>
      </div>
      <div>Te: <em>${escapeHtml(formatAnswer(it.user_answer))}</em>
        ${it.correct_answer ? ` · Helyes: <strong>${escapeHtml(formatAnswer(it.correct_answer))}</strong>` : ''}</div>
      <div class="feedback">${escapeHtml(it.feedback || '')}</div>
    </div>
  `).join('');
  area.innerHTML = `
    <div class="result-card">
      <h2>Eredmény</h2>
      <div class="total">${result.total_points} / ${result.total_max} pont</div>
      <div>${escapeHtml(result.summary || '')}</div>
      ${itemsHtml}
    </div>
  `;
}

function formatAnswer(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(', ');
  return String(v);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

$('#loadBtn').onclick = loadExam;
