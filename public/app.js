const STORAGE_KEY = 'running-planner-gpt-state-v2';
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const RACE_LABELS = {
  '10k': '10K',
  half: '하프',
  full: '풀코스',
};
const SESSION_LABELS = {
  easy: '이지런',
  recovery: '회복',
  tempo: '템포',
  interval: '인터벌',
  'race-pace': 'RP',
  long: '롱런',
  race: '레이스',
};

const state = {
  appState: null,
  selectedDate: todayIso(),
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  health: {
    ok: false,
    gptConnected: false,
    model: null,
  },
};

const els = {
  form: document.getElementById('planForm'),
  generateBtn: document.getElementById('generateBtn'),
  seedDemoBtn: document.getElementById('seedDemoBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importInput: document.getElementById('importInput'),
  resetBtn: document.getElementById('resetBtn'),
  prevMonth: document.getElementById('prevMonth'),
  nextMonth: document.getElementById('nextMonth'),
  todayBtn: document.getElementById('todayBtn'),
  monthLabel: document.getElementById('monthLabel'),
  calendarGrid: document.getElementById('calendarGrid'),
  selectedDateLabel: document.getElementById('selectedDateLabel'),
  selectedDateFocus: document.getElementById('selectedDateFocus'),
  sessionList: document.getElementById('sessionList'),
  upcomingList: document.getElementById('upcomingList'),
  goalSummary: document.getElementById('goalSummary'),
  totalSessions: document.getElementById('totalSessions'),
  completedSessions: document.getElementById('completedSessions'),
  skippedSessions: document.getElementById('skippedSessions'),
  completionRate: document.getElementById('completionRate'),
  warningList: document.getElementById('warningList'),
  coachNotesList: document.getElementById('coachNotesList'),
  planMetaSummary: document.getElementById('planMetaSummary'),
  serverStatusPill: document.getElementById('serverStatusPill'),
  planSourcePill: document.getElementById('planSourcePill'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  toast: document.getElementById('toast'),
  inputs: {
    currentLongestRunKm: document.getElementById('currentLongestRunKm'),
    currentBest5kTime: document.getElementById('currentBest5kTime'),
    currentBest5kDate: document.getElementById('currentBest5kDate'),
    currentBest10kTime: document.getElementById('currentBest10kTime'),
    currentBest10kDate: document.getElementById('currentBest10kDate'),
    currentBestHalfTime: document.getElementById('currentBestHalfTime'),
    currentBestHalfDate: document.getElementById('currentBestHalfDate'),
    currentBestFullTime: document.getElementById('currentBestFullTime'),
    currentBestFullDate: document.getElementById('currentBestFullDate'),
    recentRunDate: document.getElementById('recentRunDate'),
    recentRunDistanceKm: document.getElementById('recentRunDistanceKm'),
    recentRunAveragePace: document.getElementById('recentRunAveragePace'),
    recentRunAverageHeartRateBpm: document.getElementById('recentRunAverageHeartRateBpm'),
    recentRunRpe: document.getElementById('recentRunRpe'),
    goalDate: document.getElementById('goalDate'),
    raceType: document.getElementById('raceType'),
    goalTime: document.getElementById('goalTime'),
    availableDays: document.getElementById('availableDays'),
    longRunDay: document.getElementById('longRunDay'),
  },
};

bootstrap();

function bootstrap() {
  loadPersistedState();
  attachEvents();
  renderAll();
  checkHealth();
}

function attachEvents() {
  els.form.addEventListener('submit', onSubmitPlanForm);
  els.seedDemoBtn.addEventListener('click', applyDemoData);
  els.exportBtn.addEventListener('click', exportState);
  els.importInput.addEventListener('change', importState);
  els.resetBtn.addEventListener('click', resetState);
  els.prevMonth.addEventListener('click', () => changeMonth(-1));
  els.nextMonth.addEventListener('click', () => changeMonth(1));
  els.todayBtn.addEventListener('click', jumpToToday);
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    state.health = data;
  } catch (error) {
    state.health = { ok: false, gptConnected: false, model: null };
  }
  renderServerStatus();
}

async function onSubmitPlanForm(event) {
  event.preventDefault();
  const payload = readFormPayload();
  setLoading(true);

  try {
    const response = await fetch('/api/generate-plan', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.error || '훈련표 생성에 실패했습니다.');
    }

    state.appState = data.appState;

    const firstDate = getFirstSessionDate() || todayIso();
    state.selectedDate = firstDate;
    const firstDateObj = parseIsoDate(firstDate);
    state.viewYear = firstDateObj.getFullYear();
    state.viewMonth = firstDateObj.getMonth();

    persistState();
    renderAll();

    const sourceText = state.appState.planMeta.generatedBy === 'openai' ? 'GPT 훈련표가 생성되었습니다.' : '로컬 규칙 기반 훈련표가 생성되었습니다.';
    showToast(sourceText);
  } catch (error) {
    showToast(error.message || '훈련표 생성 중 오류가 발생했습니다.');
  } finally {
    setLoading(false);
  }
}

function readFormPayload() {
  const bestRecords = {
    '5k': {
      time: els.inputs.currentBest5kTime.value.trim(),
      date: els.inputs.currentBest5kDate.value,
    },
    '10k': {
      time: els.inputs.currentBest10kTime.value.trim(),
      date: els.inputs.currentBest10kDate.value,
    },
    half: {
      time: els.inputs.currentBestHalfTime.value.trim(),
      date: els.inputs.currentBestHalfDate.value,
    },
    full: {
      time: els.inputs.currentBestFullTime.value.trim(),
      date: els.inputs.currentBestFullDate.value,
    },
  };

  const recentRun = {
    date: els.inputs.recentRunDate.value,
    distanceKm: els.inputs.recentRunDistanceKm.value ? Number(els.inputs.recentRunDistanceKm.value) : null,
    averagePace: els.inputs.recentRunAveragePace.value.trim(),
    averageHeartRateBpm: els.inputs.recentRunAverageHeartRateBpm.value
      ? Number(els.inputs.recentRunAverageHeartRateBpm.value)
      : null,
    rpe: els.inputs.recentRunRpe.value ? Number(els.inputs.recentRunRpe.value) : null,
  };

  return {
    currentLongestRunKm: Number(els.inputs.currentLongestRunKm.value),
    currentBest5kTime: bestRecords['5k'].time,
    currentBest5kDate: bestRecords['5k'].date,
    currentBest10kTime: bestRecords['10k'].time,
    currentBest10kDate: bestRecords['10k'].date,
    currentBestHalfTime: bestRecords.half.time,
    currentBestHalfDate: bestRecords.half.date,
    currentBestFullTime: bestRecords.full.time,
    currentBestFullDate: bestRecords.full.date,
    goalDate: els.inputs.goalDate.value,
    raceType: els.inputs.raceType.value,
    goalTime: els.inputs.goalTime.value.trim(),
    availableDays: Number(els.inputs.availableDays.value),
    longRunDay: Number(els.inputs.longRunDay.value),
    bestRecords,
    recentRun,
  };
}

function applyDemoData() {
  const raceDate = addDaysIso(todayIso(), 84);
  const recentDate = addDaysIso(todayIso(), -3);
  const pb10kDate = addDaysIso(todayIso(), -220);
  const halfDate = addDaysIso(todayIso(), -480);

  els.inputs.currentLongestRunKm.value = '12';
  els.inputs.currentBest5kTime.value = '00:26:20';
  els.inputs.currentBest5kDate.value = addDaysIso(todayIso(), -120);
  els.inputs.currentBest10kTime.value = '00:56:10';
  els.inputs.currentBest10kDate.value = pb10kDate;
  els.inputs.currentBestHalfTime.value = '02:08:30';
  els.inputs.currentBestHalfDate.value = halfDate;
  els.inputs.currentBestFullTime.value = '';
  els.inputs.currentBestFullDate.value = '';
  els.inputs.recentRunDate.value = recentDate;
  els.inputs.recentRunDistanceKm.value = '8.2';
  els.inputs.recentRunAveragePace.value = '06:28';
  els.inputs.recentRunAverageHeartRateBpm.value = '158';
  els.inputs.recentRunRpe.value = '6';
  els.inputs.goalDate.value = raceDate;
  els.inputs.raceType.value = 'half';
  els.inputs.goalTime.value = '01:58:00';
  els.inputs.availableDays.value = '4';
  els.inputs.longRunDay.value = '0';
  showToast('데모 데이터를 넣었습니다.');
}

function exportState() {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    state,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `running-planner-${todayIso()}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function importState(event) {
  const [file] = event.target.files || [];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(String(reader.result || '{}'));
      if (!imported.state) {
        throw new Error('올바른 JSON 파일이 아닙니다.');
      }
      Object.assign(state, imported.state);
      persistState();
      renderAll();
      showToast('데이터를 불러왔습니다.');
    } catch (error) {
      showToast(error.message || 'JSON 불러오기에 실패했습니다.');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

function resetState() {
  if (!window.confirm('저장된 플랜과 체크 상태를 초기화할까요?')) return;
  localStorage.removeItem(STORAGE_KEY);
  state.appState = null;
  state.selectedDate = todayIso();
  state.viewYear = new Date().getFullYear();
  state.viewMonth = new Date().getMonth();
  renderAll();
  showToast('초기화했습니다.');
}

function changeMonth(delta) {
  const current = new Date(state.viewYear, state.viewMonth, 1);
  current.setMonth(current.getMonth() + delta);
  state.viewYear = current.getFullYear();
  state.viewMonth = current.getMonth();
  renderCalendar();
}

function jumpToToday() {
  const today = todayIso();
  state.selectedDate = hasDate(today) ? today : state.selectedDate || today;
  const current = parseIsoDate(state.selectedDate || today);
  state.viewYear = current.getFullYear();
  state.viewMonth = current.getMonth();
  renderAll();
}

function renderAll() {
  hydrateFormFromState();
  renderServerStatus();
  renderPlanSource();
  renderCalendar();
  renderSelectedDate();
  renderUpcoming();
  renderStats();
  renderGoalSummary();
  renderWarnings();
  renderCoachNotes();
  renderPlanMeta();
}

function renderServerStatus() {
  if (!state.health.ok) {
    els.serverStatusPill.textContent = '서버 연결 안 됨';
    els.serverStatusPill.className = 'pill danger';
    return;
  }

  if (state.health.gptConnected) {
    els.serverStatusPill.textContent = `GPT 연결됨 · ${state.health.model}`;
    els.serverStatusPill.className = 'pill success';
  } else {
    els.serverStatusPill.textContent = 'GPT 키 없음 · 로컬 모드';
    els.serverStatusPill.className = 'pill warning';
  }
}

function renderPlanSource() {
  if (!state.appState) {
    els.planSourcePill.textContent = '플랜 없음';
    els.planSourcePill.className = 'pill subtle';
    return;
  }

  const generatedBy = state.appState.planMeta.generatedBy;
  els.planSourcePill.textContent = state.appState.planMeta.source;
  els.planSourcePill.className = generatedBy === 'openai' ? 'pill success' : 'pill warning';
}

function renderCalendar() {
  const monthStart = new Date(state.viewYear, state.viewMonth, 1);
  const monthEnd = new Date(state.viewYear, state.viewMonth + 1, 0);
  const leadingEmpty = (monthStart.getDay() + 6) % 7;

  els.monthLabel.textContent = `${state.viewYear}년 ${state.viewMonth + 1}월`;
  els.calendarGrid.innerHTML = '';

  const startDate = new Date(monthStart);
  startDate.setDate(monthStart.getDate() - leadingEmpty);

  for (let i = 0; i < 42; i += 1) {
    const current = new Date(startDate);
    current.setDate(startDate.getDate() + i);
    const iso = formatIso(current);
    const sessions = getSessionsForDate(iso);
    const dayCell = document.createElement('button');
    dayCell.type = 'button';
    dayCell.className = 'day-cell';
    if (current.getMonth() !== state.viewMonth) dayCell.classList.add('outside-month');
    if (iso === state.selectedDate) dayCell.classList.add('is-selected');
    if (iso === todayIso()) dayCell.classList.add('is-today');

    const completed = sessions.filter((session) => session.status === 'completed').length;
    const skipped = sessions.filter((session) => session.status === 'skipped').length;

    dayCell.innerHTML = `
      <div class="day-top">
        <span class="day-number">${current.getDate()}</span>
        ${sessions.length ? `<span class="pill subtle">${sessions.length}</span>` : ''}
      </div>
      <div class="day-content">
        ${sessions.slice(0, 3).map((session) => renderCalendarChip(session)).join('')}
        ${sessions.length > 3 ? `<div class="more-badge">+${sessions.length - 3}개 더</div>` : ''}
      </div>
      <div class="day-footer">
        ${completed ? `<span class="status-mini completed">완 ${completed}</span>` : ''}
        ${skipped ? `<span class="status-mini skipped">건 ${skipped}</span>` : ''}
      </div>
    `;

    dayCell.addEventListener('click', () => {
      state.selectedDate = iso;
      if (current.getMonth() !== state.viewMonth) {
        state.viewYear = current.getFullYear();
        state.viewMonth = current.getMonth();
      }
      persistState();
      renderAll();
    });

    els.calendarGrid.appendChild(dayCell);
  }
}

function renderCalendarChip(session) {
  const title = escapeHtml(session.title);
  const label = SESSION_LABELS[session.sessionType] || session.sessionType;
  return `
    <div class="session-chip ${session.sessionType} ${session.status}">
      <span class="dot ${session.sessionType}"></span>
      <span title="${title}">${escapeHtml(label)}</span>
    </div>
  `;
}

function renderSelectedDate() {
  const date = state.selectedDate || todayIso();
  const sessions = getSessionsForDate(date);
  els.selectedDateLabel.textContent = formatKoreanDate(date);
  els.selectedDateFocus.textContent = sessions.length ? `${sessions.length}개 세션` : '세션 없음';

  if (!sessions.length) {
    els.sessionList.className = 'session-list empty-state';
    els.sessionList.textContent = '이 날짜에는 예정된 세션이 없습니다.';
    return;
  }

  els.sessionList.className = 'session-list';
  els.sessionList.innerHTML = '';

  sessions.forEach((session) => {
    const wrapper = document.createElement('article');
    wrapper.className = 'session-card';
    wrapper.innerHTML = `
      <div class="session-top">
        <div class="session-title-wrap">
          <strong>${escapeHtml(session.title)}</strong>
          <div class="session-meta">
            <span class="meta-chip">${escapeHtml(SESSION_LABELS[session.sessionType] || session.sessionType)}</span>
            <span class="meta-chip">${escapeHtml(intensityLabel(session.intensity))}</span>
            <span class="meta-chip">${escapeHtml(session.phase.toUpperCase())}</span>
          </div>
        </div>
        <span class="pill ${statusPillClass(session.status)}">${escapeHtml(statusLabel(session.status))}</span>
      </div>
      <p class="session-description">${escapeHtml(session.description)}</p>
      <div class="session-meta">
        ${session.durationMin ? `<span class="meta-chip">${session.durationMin}분</span>` : ''}
        ${session.distanceKm ? `<span class="meta-chip">${session.distanceKm}km</span>` : ''}
        ${session.targetPace ? `<span class="meta-chip">${escapeHtml(session.targetPace)}</span>` : ''}
        <span class="meta-chip">주차 ${session.weekNumber}</span>
      </div>
      <div class="session-success">성공 기준: ${escapeHtml(session.successCriteria)}</div>
      <div class="status-actions">
        <button type="button" class="status-btn ${session.status === 'pending' ? 'is-active pending' : ''}" data-status="pending">대기</button>
        <button type="button" class="status-btn ${session.status === 'completed' ? 'is-active completed' : ''}" data-status="completed">완료</button>
        <button type="button" class="status-btn ${session.status === 'skipped' ? 'is-active skipped' : ''}" data-status="skipped">건너뜀</button>
      </div>
      <label>
        <span class="muted">메모</span>
        <textarea placeholder="컨디션, 실제 페이스, 느낀 점을 기록하세요.">${escapeHtml(session.note)}</textarea>
      </label>
    `;

    wrapper.querySelectorAll('[data-status]').forEach((button) => {
      button.addEventListener('click', () => {
        updateSession(date, session.id, { status: button.dataset.status });
      });
    });

    const textarea = wrapper.querySelector('textarea');
    textarea.addEventListener('change', () => {
      updateSession(date, session.id, { note: textarea.value.trim() });
    });

    els.sessionList.appendChild(wrapper);
  });
}

function renderUpcoming() {
  const dates = getUpcomingDates(7);
  els.upcomingList.innerHTML = '';

  const rows = dates
    .map((date) => ({
      date,
      sessions: getSessionsForDate(date),
    }))
    .filter((item) => item.sessions.length);

  if (!rows.length) {
    els.upcomingList.className = 'upcoming-list empty-state';
    els.upcomingList.textContent = '앞으로 7일 안에 예정된 세션이 없습니다.';
    return;
  }

  els.upcomingList.className = 'upcoming-list';
  rows.forEach((item) => {
    const card = document.createElement('article');
    card.className = 'upcoming-item';
    card.innerHTML = `
      <strong>${formatUpcomingDate(item.date)}</strong>
      <p>${item.sessions.map((session) => `${SESSION_LABELS[session.sessionType] || session.sessionType} · ${session.title}`).join(' / ')}</p>
    `;
    els.upcomingList.appendChild(card);
  });
}

function renderStats() {
  const sessions = getAllSessions();
  const total = sessions.length;
  const completed = sessions.filter((session) => session.status === 'completed').length;
  const skipped = sessions.filter((session) => session.status === 'skipped').length;
  const rate = total ? Math.round((completed / total) * 100) : 0;

  els.totalSessions.textContent = String(total);
  els.completedSessions.textContent = String(completed);
  els.skippedSessions.textContent = String(skipped);
  els.completionRate.textContent = `${rate}%`;
}

function renderGoalSummary() {
  if (!state.appState) {
    els.goalSummary.textContent = '목표 없음';
    els.goalSummary.className = 'pill';
    return;
  }

  const profile = state.appState.profile;
  els.goalSummary.textContent = `${profile.raceLabel} · ${profile.goalTime}`;
  els.goalSummary.className = 'pill';
}

function renderWarnings() {
  if (!state.appState?.planMeta?.warnings?.length) {
    els.warningList.className = 'message-list empty-state';
    els.warningList.textContent = '경고/주의가 여기에 표시됩니다.';
    return;
  }

  els.warningList.className = 'message-list';
  els.warningList.innerHTML = state.appState.planMeta.warnings
    .map(
      (warning) => `
        <article class="message-item warning">
          <strong>주의</strong>
          <p>${escapeHtml(warning)}</p>
        </article>
      `,
    )
    .join('');
}

function renderCoachNotes() {
  const notes = state.appState?.planMeta?.coachNotes || [];
  if (!notes.length) {
    els.coachNotesList.className = 'message-list empty-state';
    els.coachNotesList.textContent = '플랜을 생성하면 주차별 코멘트가 표시됩니다.';
    return;
  }

  els.coachNotesList.className = 'message-list';
  els.coachNotesList.innerHTML = notes
    .map(
      (item) => `
        <article class="message-item note">
          <strong>${item.weekNumber}주차</strong>
          <p>${escapeHtml(item.note)}</p>
        </article>
      `,
    )
    .join('');
}

function renderPlanMeta() {
  if (!state.appState) {
    els.planMetaSummary.className = 'meta-summary empty-state';
    els.planMetaSummary.textContent = '플랜을 생성하면 목표 요약과 페이스가 표시됩니다.';
    return;
  }

  const meta = state.appState.planMeta;
  const profile = state.appState.profile;
  const recent = profile.recentRun;
  const recentAnalysis = meta.recentRunAnalysis;
  const goalRealism = meta.goalRealism;

  const recentSummary = recent
    ? `${recent.date} · ${recent.distanceKm}km · ${recent.averagePace}/km${recent.averageHeartRateBpm ? ` · ${recent.averageHeartRateBpm}bpm` : ''}`
    : '입력 없음';

  const goalRealismSummary = goalRealism?.label || '판단 보류';
  const goalRealismDetail = goalRealism?.summary || '비교 가능한 최근 PB가 충분하지 않습니다.';

  els.planMetaSummary.className = 'meta-summary';
  els.planMetaSummary.innerHTML = `
    <div class="meta-row"><strong>대회</strong><span>${escapeHtml(profile.raceLabel)}</span></div>
    <div class="meta-row"><strong>대회 날짜</strong><span>${escapeHtml(profile.goalDate)}</span></div>
    <div class="meta-row"><strong>목표 시간</strong><span>${escapeHtml(profile.goalTime)}</span></div>
    <div class="meta-row"><strong>목표 페이스</strong><span>${escapeHtml(meta.targetPacePerKm)}</span></div>
    <div class="meta-row"><strong>플랜 기간</strong><span>${meta.totalWeeks}주</span></div>
    <div class="meta-row"><strong>훈련 요일</strong><span>${escapeHtml(meta.trainingWeekdays.join(' · '))}</span></div>
    <div class="meta-row"><strong>목표 현실성</strong><span>${escapeHtml(goalRealismSummary)}</span></div>
    <div class="meta-note">${escapeHtml(goalRealismDetail)}</div>
    <div class="meta-row"><strong>최근 러닝</strong><span>${escapeHtml(recentSummary)}</span></div>
    <div class="meta-row"><strong>최근 러닝 해석</strong><span>${escapeHtml(recentAnalysis?.label || '입력 없음')}</span></div>
    <div class="meta-note">${escapeHtml(recentAnalysis?.summary || '최근 러닝이 없어서 PB와 최근 최장 거리 위주로 계획했습니다.')}</div>
    <div class="meta-row"><strong>생성 방식</strong><span>${escapeHtml(meta.source)}</span></div>
  `;
}

function updateSession(date, sessionId, patch) {
  const sessions = state.appState?.sessionsByDate?.[date];
  if (!sessions) return;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  Object.assign(session, patch);
  persistState();
  renderAll();
}

function getSessionsForDate(date) {
  return state.appState?.sessionsByDate?.[date] || [];
}

function getAllSessions() {
  return Object.values(state.appState?.sessionsByDate || {}).flat();
}

function getFirstSessionDate() {
  const dates = Object.keys(state.appState?.sessionsByDate || {}).sort();
  return dates[0] || null;
}

function hasDate(date) {
  return Boolean(state.appState?.sessionsByDate?.[date]);
}

function getUpcomingDates(days) {
  const out = [];
  const today = parseIsoDate(todayIso());
  for (let i = 0; i < days; i += 1) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    out.push(formatIso(date));
  }
  return out;
}

function hydrateFormFromState() {
  if (!state.appState?.profile) return;
  const profile = state.appState.profile;
  els.inputs.currentLongestRunKm.value = String(profile.currentLongestRunKm ?? '');

  const bestRecords = profile.bestRecords || {};
  els.inputs.currentBest5kTime.value = bestRecords['5k']?.time || profile.bestTimes?.['5k'] || '';
  els.inputs.currentBest5kDate.value = bestRecords['5k']?.date || '';
  els.inputs.currentBest10kTime.value = bestRecords['10k']?.time || profile.bestTimes?.['10k'] || '';
  els.inputs.currentBest10kDate.value = bestRecords['10k']?.date || '';
  els.inputs.currentBestHalfTime.value = bestRecords.half?.time || profile.bestTimes?.half || '';
  els.inputs.currentBestHalfDate.value = bestRecords.half?.date || '';
  els.inputs.currentBestFullTime.value = bestRecords.full?.time || profile.bestTimes?.full || '';
  els.inputs.currentBestFullDate.value = bestRecords.full?.date || '';

  els.inputs.recentRunDate.value = profile.recentRun?.date || '';
  els.inputs.recentRunDistanceKm.value = profile.recentRun?.distanceKm ?? '';
  els.inputs.recentRunAveragePace.value = profile.recentRun?.averagePace || '';
  els.inputs.recentRunAverageHeartRateBpm.value = profile.recentRun?.averageHeartRateBpm ?? '';
  els.inputs.recentRunRpe.value = profile.recentRun?.rpe ?? '';

  els.inputs.goalDate.value = profile.goalDate || '';
  els.inputs.raceType.value = profile.raceType || '10k';
  els.inputs.goalTime.value = profile.goalTime || '';
  els.inputs.availableDays.value = String(profile.availableDays || 4);
  els.inputs.longRunDay.value = String(profile.longRunDay ?? 0);
}

function loadPersistedState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    Object.assign(state, parsed);
  } catch (error) {
    console.warn('Failed to restore state', error);
  }
}

function persistState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      appState: state.appState,
      selectedDate: state.selectedDate,
      viewYear: state.viewYear,
      viewMonth: state.viewMonth,
      health: state.health,
    }),
  );
}

function setLoading(isLoading) {
  els.generateBtn.disabled = isLoading;
  els.generateBtn.textContent = isLoading ? '생성 중...' : 'GPT 훈련표 생성';
  els.loadingOverlay.classList.toggle('hidden', !isLoading);
}

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 2600);
}

function todayIso() {
  return formatIso(new Date());
}

function formatIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseIsoDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatKoreanDate(iso) {
  const date = parseIsoDate(iso);
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일 (${DAY_NAMES[date.getDay()]})`;
}

function formatUpcomingDate(iso) {
  const date = parseIsoDate(iso);
  return `${date.getMonth() + 1}/${date.getDate()} (${DAY_NAMES[date.getDay()]})`;
}

function addDaysIso(iso, days) {
  const date = parseIsoDate(iso);
  date.setDate(date.getDate() + days);
  return formatIso(date);
}

function statusLabel(status) {
  if (status === 'completed') return '완료';
  if (status === 'skipped') return '건너뜀';
  return '대기';
}

function statusPillClass(status) {
  if (status === 'completed') return 'success';
  if (status === 'skipped') return 'danger';
  return 'subtle';
}

function intensityLabel(intensity) {
  if (intensity === 'easy') return '쉬움';
  if (intensity === 'moderate') return '보통';
  if (intensity === 'hard') return '강함';
  if (intensity === 'race') return '레이스';
  return intensity;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
