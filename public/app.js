import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const STORAGE_PREFIX = 'running-planner-gpt-auth-v1';
const REMOTE_TABLE = 'runner_workspaces';
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
  draftProfile: null,
  selectedDate: todayIso(),
  viewYear: new Date().getFullYear(),
  viewMonth: new Date().getMonth(),
  health: {
    ok: false,
    gptConnected: false,
    authConfigured: false,
    model: null,
  },
  auth: {
    configured: false,
    ready: false,
    supabase: null,
    session: null,
    user: null,
  },
  sync: {
    status: 'booting',
    lastSyncedAt: null,
    message: null,
  },
};

let saveTimer = null;
let activeLocalStorageUserId = 'guest';

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
  authStatusPill: document.getElementById('authStatusPill'),
  syncStatusPill: document.getElementById('syncStatusPill'),
  planSourcePill: document.getElementById('planSourcePill'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  toast: document.getElementById('toast'),
  authHelpText: document.getElementById('authHelpText'),
  signedOutPanel: document.getElementById('signedOutPanel'),
  signedInPanel: document.getElementById('signedInPanel'),
  authEmail: document.getElementById('authEmail'),
  authPassword: document.getElementById('authPassword'),
  signInBtn: document.getElementById('signInBtn'),
  signUpBtn: document.getElementById('signUpBtn'),
  signOutBtn: document.getElementById('signOutBtn'),
  currentUserEmail: document.getElementById('currentUserEmail'),
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
    latestRunDate: document.getElementById('latestRunDate'),
    latestRunDistanceKm: document.getElementById('latestRunDistanceKm'),
    latestRunAvgPace: document.getElementById('latestRunAvgPace'),
    latestRunAvgHeartRate: document.getElementById('latestRunAvgHeartRate'),
    latestRunRpe: document.getElementById('latestRunRpe'),
    goalDate: document.getElementById('goalDate'),
    raceType: document.getElementById('raceType'),
    goalTime: document.getElementById('goalTime'),
    availableDays: document.getElementById('availableDays'),
    longRunDay: document.getElementById('longRunDay'),
  },
};

bootstrap().catch((error) => {
  console.error(error);
  showToast('초기화 중 오류가 발생했습니다.');
});

async function bootstrap() {
  loadPersistedState('guest');
  attachEvents();
  renderAll();
  await checkHealth();
  await initializeAuth();
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
  els.signInBtn.addEventListener('click', signInWithPassword);
  els.signUpBtn.addEventListener('click', signUpWithPassword);
  els.signOutBtn.addEventListener('click', signOut);

  Object.values(els.inputs).forEach((input) => {
    input.addEventListener('change', onDraftInputChanged);
  });
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    state.health = data;
  } catch (error) {
    state.health = { ok: false, gptConnected: false, authConfigured: false, model: null };
  }
  renderServerStatus();
}

async function initializeAuth() {
  try {
    const response = await fetch('/api/public-config');
    const config = await response.json();

    if (!config.authConfigured || !config.supabaseUrl || !config.supabasePublishableKey) {
      state.auth.configured = false;
      state.auth.ready = true;
      state.sync.status = 'local-only';
      renderAuth();
      renderSyncStatus();
      return;
    }

    state.auth.configured = true;
    state.auth.supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);

    const {
      data: { session },
    } = await state.auth.supabase.auth.getSession();

    await applySessionState(session, { initial: true });

    state.auth.supabase.auth.onAuthStateChange((_event, sessionFromEvent) => {
      applySessionState(sessionFromEvent, { initial: false }).catch((error) => {
        console.error(error);
        setSyncStatus('error', '로그인 상태 반영 실패');
        showToast('로그인 상태 반영에 실패했습니다.');
      });
    });
  } catch (error) {
    console.error(error);
    state.auth.configured = false;
    state.auth.ready = true;
    state.sync.status = 'local-only';
  }

  renderAuth();
  renderSyncStatus();
}

async function applySessionState(session, { initial = false } = {}) {
  const guestSnapshot = serializeState();

  state.auth.session = session || null;
  state.auth.user = session?.user || null;
  state.auth.ready = true;

  if (!state.auth.user) {
    clearPlannerState();
    loadPersistedState('guest');
    setSyncStatus(state.auth.configured ? 'sign-in-needed' : 'local-only');
    renderAll();
    return;
  }

  const userId = state.auth.user.id;
  loadPersistedState(userId);
  setSyncStatus('loading');
  renderAll();

  const remoteLoaded = await loadWorkspaceFromCloud();
  if (!remoteLoaded && hasMeaningfulState(guestSnapshot) && !hasMeaningfulState(serializeState())) {
    applySerializedState(guestSnapshot);
    persistState();
    queueSaveWorkspace(100);
  }

  if (!remoteLoaded && !hasMeaningfulState(serializeState())) {
    setSyncStatus('synced', null);
  }

  if (initial) {
    renderAll();
  }
}

async function signInWithPassword() {
  if (!state.auth.supabase) {
    showToast('로그인 기능이 아직 설정되지 않았습니다.');
    return;
  }

  const email = els.authEmail.value.trim();
  const password = els.authPassword.value.trim();
  if (!email || !password) {
    showToast('이메일과 비밀번호를 입력해주세요.');
    return;
  }

  lockAuthButtons(true);
  try {
    const { error } = await state.auth.supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    showToast('로그인되었습니다.');
  } catch (error) {
    showToast(error.message || '로그인에 실패했습니다.');
  } finally {
    lockAuthButtons(false);
  }
}

async function signUpWithPassword() {
  if (!state.auth.supabase) {
    showToast('로그인 기능이 아직 설정되지 않았습니다.');
    return;
  }

  const email = els.authEmail.value.trim();
  const password = els.authPassword.value.trim();
  if (!email || !password) {
    showToast('이메일과 비밀번호를 입력해주세요.');
    return;
  }

  lockAuthButtons(true);
  try {
    const { data, error } = await state.auth.supabase.auth.signUp({ email, password });
    if (error) throw error;

    if (data.session) {
      showToast('회원가입과 로그인이 완료되었습니다.');
    } else {
      showToast('회원가입되었습니다. 이메일 인증이 켜져 있다면 메일에서 확인 후 로그인하세요.');
    }
  } catch (error) {
    showToast(error.message || '회원가입에 실패했습니다.');
  } finally {
    lockAuthButtons(false);
  }
}

async function signOut() {
  if (!state.auth.supabase) return;
  lockAuthButtons(true);
  try {
    const { error } = await state.auth.supabase.auth.signOut();
    if (error) throw error;
    showToast('로그아웃되었습니다.');
  } catch (error) {
    showToast(error.message || '로그아웃에 실패했습니다.');
  } finally {
    lockAuthButtons(false);
  }
}

function lockAuthButtons(isLoading) {
  els.signInBtn.disabled = isLoading;
  els.signUpBtn.disabled = isLoading;
  els.signOutBtn.disabled = isLoading;
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
    state.draftProfile = readDraftProfile();

    const firstDate = getFirstSessionDate() || todayIso();
    state.selectedDate = firstDate;
    const firstDateObj = parseIsoDate(firstDate);
    state.viewYear = firstDateObj.getFullYear();
    state.viewMonth = firstDateObj.getMonth();

    persistState();
    renderAll();
    queueSaveWorkspace();

    const sourceText = getPlanCreatedToastText(state.appState.planMeta.generatedBy);
    showToast(sourceText);
  } catch (error) {
    showToast(error.message || '훈련표 생성 중 오류가 발생했습니다.');
  } finally {
    setLoading(false);
  }
}

function readFormPayload() {
  return {
    currentLongestRunKm: Number(els.inputs.currentLongestRunKm.value),
    currentBest5kTime: els.inputs.currentBest5kTime.value.trim(),
    currentBest5kDate: els.inputs.currentBest5kDate.value,
    currentBest10kTime: els.inputs.currentBest10kTime.value.trim(),
    currentBest10kDate: els.inputs.currentBest10kDate.value,
    currentBestHalfTime: els.inputs.currentBestHalfTime.value.trim(),
    currentBestHalfDate: els.inputs.currentBestHalfDate.value,
    currentBestFullTime: els.inputs.currentBestFullTime.value.trim(),
    currentBestFullDate: els.inputs.currentBestFullDate.value,
    latestRunDate: els.inputs.latestRunDate.value,
    latestRunDistanceKm: readNullableNumber(els.inputs.latestRunDistanceKm.value),
    latestRunAvgPace: els.inputs.latestRunAvgPace.value.trim(),
    latestRunAvgHeartRate: readNullableInteger(els.inputs.latestRunAvgHeartRate.value),
    latestRunRpe: readNullableInteger(els.inputs.latestRunRpe.value),
    goalDate: els.inputs.goalDate.value,
    raceType: els.inputs.raceType.value,
    goalTime: els.inputs.goalTime.value.trim(),
    availableDays: Number(els.inputs.availableDays.value),
    longRunDay: Number(els.inputs.longRunDay.value),
    bestTimes: {
      '5k': els.inputs.currentBest5kTime.value.trim(),
      '10k': els.inputs.currentBest10kTime.value.trim(),
      half: els.inputs.currentBestHalfTime.value.trim(),
      full: els.inputs.currentBestFullTime.value.trim(),
    },
    bestTimeDates: {
      '5k': els.inputs.currentBest5kDate.value,
      '10k': els.inputs.currentBest10kDate.value,
      half: els.inputs.currentBestHalfDate.value,
      full: els.inputs.currentBestFullDate.value,
    },
    recentRun: {
      date: els.inputs.latestRunDate.value,
      distanceKm: readNullableNumber(els.inputs.latestRunDistanceKm.value),
      avgPace: els.inputs.latestRunAvgPace.value.trim(),
      avgHeartRate: readNullableInteger(els.inputs.latestRunAvgHeartRate.value),
      rpe: readNullableInteger(els.inputs.latestRunRpe.value),
    },
  };
}

function readDraftProfile() {
  return {
    currentLongestRunKm: readNullableNumber(els.inputs.currentLongestRunKm.value),
    bestTimes: {
      '5k': els.inputs.currentBest5kTime.value.trim(),
      '10k': els.inputs.currentBest10kTime.value.trim(),
      half: els.inputs.currentBestHalfTime.value.trim(),
      full: els.inputs.currentBestFullTime.value.trim(),
    },
    bestTimeDates: {
      '5k': els.inputs.currentBest5kDate.value,
      '10k': els.inputs.currentBest10kDate.value,
      half: els.inputs.currentBestHalfDate.value,
      full: els.inputs.currentBestFullDate.value,
    },
    recentRun: {
      date: els.inputs.latestRunDate.value,
      distanceKm: readNullableNumber(els.inputs.latestRunDistanceKm.value),
      avgPace: els.inputs.latestRunAvgPace.value.trim(),
      avgHeartRate: readNullableInteger(els.inputs.latestRunAvgHeartRate.value),
      rpe: readNullableInteger(els.inputs.latestRunRpe.value),
    },
    goalDate: els.inputs.goalDate.value,
    raceType: els.inputs.raceType.value,
    goalTime: els.inputs.goalTime.value.trim(),
    availableDays: readNullableInteger(els.inputs.availableDays.value),
    longRunDay: readNullableInteger(els.inputs.longRunDay.value),
  };
}

function onDraftInputChanged() {
  state.draftProfile = readDraftProfile();
  persistState();
  queueSaveWorkspace(600);
}

function applyDemoData() {
  const goalDate = addDaysIso(todayIso(), 84);
  const latestDate = addDaysIso(todayIso(), -3);
  els.inputs.currentLongestRunKm.value = '12';
  els.inputs.currentBest5kTime.value = '00:26:20';
  els.inputs.currentBest5kDate.value = addDaysIso(todayIso(), -210);
  els.inputs.currentBest10kTime.value = '00:56:10';
  els.inputs.currentBest10kDate.value = addDaysIso(todayIso(), -190);
  els.inputs.currentBestHalfTime.value = '02:08:30';
  els.inputs.currentBestHalfDate.value = addDaysIso(todayIso(), -150);
  els.inputs.currentBestFullTime.value = '';
  els.inputs.currentBestFullDate.value = '';
  els.inputs.latestRunDate.value = latestDate;
  els.inputs.latestRunDistanceKm.value = '8.4';
  els.inputs.latestRunAvgPace.value = '06:01';
  els.inputs.latestRunAvgHeartRate.value = '154';
  els.inputs.latestRunRpe.value = '6';
  els.inputs.goalDate.value = goalDate;
  els.inputs.raceType.value = 'half';
  els.inputs.goalTime.value = '01:58:00';
  els.inputs.availableDays.value = '4';
  els.inputs.longRunDay.value = '0';
  onDraftInputChanged();
  showToast('데모 데이터를 넣었습니다.');
}

function exportState() {
  const payload = {
    version: 2,
    exportedAt: new Date().toISOString(),
    state: serializeState(),
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
      applySerializedState(imported.state);
      persistState();
      renderAll();
      queueSaveWorkspace(200);
      showToast('데이터를 불러왔습니다.');
    } catch (error) {
      showToast(error.message || 'JSON 불러오기에 실패했습니다.');
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsText(file);
}

async function resetState() {
  if (!window.confirm('현재 계정의 저장된 플랜과 체크 상태를 초기화할까요?')) return;

  clearPlannerState();
  persistState();

  if (state.auth.user && state.auth.supabase) {
    try {
      setSyncStatus('saving');
      const { error } = await state.auth.supabase.from(REMOTE_TABLE).delete().eq('user_id', state.auth.user.id);
      if (error) throw error;
      setSyncStatus('synced');
    } catch (error) {
      console.error(error);
      setSyncStatus('error', '원격 초기화 실패');
      showToast('클라우드 데이터 초기화에 실패했습니다.');
      renderAll();
      return;
    }
  }

  renderAll();
  showToast('초기화했습니다.');
}

function changeMonth(delta) {
  const current = new Date(state.viewYear, state.viewMonth, 1);
  current.setMonth(current.getMonth() + delta);
  state.viewYear = current.getFullYear();
  state.viewMonth = current.getMonth();
  persistState();
  queueSaveWorkspace(600);
  renderCalendar();
}

function jumpToToday() {
  const today = todayIso();
  state.selectedDate = hasDate(today) ? today : state.selectedDate || today;
  const current = parseIsoDate(state.selectedDate || today);
  state.viewYear = current.getFullYear();
  state.viewMonth = current.getMonth();
  persistState();
  queueSaveWorkspace(600);
  renderAll();
}

function renderAll() {
  hydrateFormFromState();
  renderServerStatus();
  renderAuth();
  renderSyncStatus();
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
    els.serverStatusPill.textContent = `Gemini 연결됨 · ${state.health.model}`;
    els.serverStatusPill.className = 'pill success';
  } else {
    els.serverStatusPill.textContent = 'Gemini 키 없음 · 로컬 모드';
    els.serverStatusPill.className = 'pill warning';
  }
}

function renderAuth() {
  if (!state.auth.configured) {
    els.authStatusPill.textContent = '로그인 기능 미설정';
    els.authStatusPill.className = 'pill warning';
    els.authHelpText.textContent = 'SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY를 넣으면 계정별 저장이 켜집니다.';
    els.signedOutPanel.classList.add('hidden');
    els.signedInPanel.classList.add('hidden');
    return;
  }

  if (!state.auth.user) {
    els.authStatusPill.textContent = '로그아웃 상태';
    els.authStatusPill.className = 'pill subtle';
    els.authHelpText.textContent = '로그인하면 내 캘린더와 체크 상태가 내 계정에 저장됩니다.';
    els.signedOutPanel.classList.remove('hidden');
    els.signedInPanel.classList.add('hidden');
    return;
  }

  els.authStatusPill.textContent = '로그인됨';
  els.authStatusPill.className = 'pill success';
  els.authHelpText.textContent = '이 계정의 플랜이 자동으로 불러와지고, 상태 변경도 자동 저장됩니다.';
  els.currentUserEmail.textContent = state.auth.user.email || '로그인 사용자';
  els.signedOutPanel.classList.add('hidden');
  els.signedInPanel.classList.remove('hidden');
}

function renderSyncStatus() {
  const pill = els.syncStatusPill;

  switch (state.sync.status) {
    case 'local-only':
      pill.textContent = '로컬 저장만';
      pill.className = 'pill warning';
      break;
    case 'sign-in-needed':
      pill.textContent = '로그인하면 저장';
      pill.className = 'pill subtle';
      break;
    case 'loading':
      pill.textContent = '클라우드 불러오는 중';
      pill.className = 'pill subtle';
      break;
    case 'saving':
      pill.textContent = '클라우드 저장 중';
      pill.className = 'pill subtle';
      break;
    case 'synced':
      pill.textContent = state.sync.lastSyncedAt ? `동기화 완료 · ${formatTime(state.sync.lastSyncedAt)}` : '동기화 완료';
      pill.className = 'pill success';
      break;
    case 'error':
      pill.textContent = state.sync.message || '동기화 오류';
      pill.className = 'pill danger';
      break;
    default:
      pill.textContent = '저장 상태 확인 중';
      pill.className = 'pill subtle';
      break;
  }
}

function getPlanSourceText(generatedBy, fallbackSource = '') {
  if (generatedBy === 'gemini') return 'Gemini 생성';
  if (generatedBy === 'openai') return 'AI 생성(legacy)';
  if (generatedBy === 'fallback') return '로컬 규칙 기반';
  return fallbackSource || '알 수 없음';
}

function getPlanCreatedToastText(generatedBy) {
  if (generatedBy === 'gemini') return 'Gemini 훈련표가 생성되었습니다.';
  if (generatedBy === 'openai') return 'AI 훈련표가 생성되었습니다. (legacy)';
  return '로컬 규칙 기반 훈련표가 생성되었습니다.';
}

function renderPlanSource() {
  if (!state.appState) {
    els.planSourcePill.textContent = '플랜 없음';
    els.planSourcePill.className = 'pill subtle';
    return;
  }

  const generatedBy = state.appState.planMeta.generatedBy;
  els.planSourcePill.textContent = getPlanSourceText(generatedBy, state.appState.planMeta.source);
  els.planSourcePill.className = generatedBy !== 'fallback' ? 'pill success' : 'pill warning';
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
      queueSaveWorkspace(600);
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
  const recentRun = profile.recentRun || {};
  const recentAssessment = profile.recentRunAssessment?.summary;

  els.planMetaSummary.className = 'meta-summary';
  els.planMetaSummary.innerHTML = `
    <div class="meta-row"><strong>대회</strong><span>${escapeHtml(profile.raceLabel)}</span></div>
    <div class="meta-row"><strong>대회 날짜</strong><span>${escapeHtml(profile.goalDate)}</span></div>
    <div class="meta-row"><strong>목표 시간</strong><span>${escapeHtml(profile.goalTime)}</span></div>
    <div class="meta-row"><strong>목표 페이스</strong><span>${escapeHtml(meta.targetPacePerKm)}</span></div>
    <div class="meta-row"><strong>플랜 기간</strong><span>${meta.totalWeeks}주</span></div>
    <div class="meta-row"><strong>훈련 요일</strong><span>${escapeHtml(meta.trainingWeekdays.join(' · '))}</span></div>
    <div class="meta-row"><strong>생성 방식</strong><span>${escapeHtml(getPlanSourceText(meta.generatedBy, meta.source))}</span></div>
    <div class="meta-row"><strong>최근 러닝</strong><span>${escapeHtml(renderRecentRunSummary(recentRun))}</span></div>
    ${recentAssessment ? `<div class="meta-note">${escapeHtml(recentAssessment)}</div>` : ''}
  `;
}

function updateSession(date, sessionId, patch) {
  const sessions = state.appState?.sessionsByDate?.[date];
  if (!sessions) return;
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) return;
  Object.assign(session, patch);
  persistState();
  queueSaveWorkspace();
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
  const profile = state.draftProfile || state.appState?.profile;
  if (!profile) return;

  els.inputs.currentLongestRunKm.value = valueOrEmpty(profile.currentLongestRunKm);
  els.inputs.currentBest5kTime.value = profile.bestTimes?.['5k'] || '';
  els.inputs.currentBest5kDate.value = profile.bestTimeDates?.['5k'] || '';
  els.inputs.currentBest10kTime.value = profile.bestTimes?.['10k'] || '';
  els.inputs.currentBest10kDate.value = profile.bestTimeDates?.['10k'] || '';
  els.inputs.currentBestHalfTime.value = profile.bestTimes?.half || '';
  els.inputs.currentBestHalfDate.value = profile.bestTimeDates?.half || '';
  els.inputs.currentBestFullTime.value = profile.bestTimes?.full || '';
  els.inputs.currentBestFullDate.value = profile.bestTimeDates?.full || '';
  els.inputs.latestRunDate.value = profile.recentRun?.date || '';
  els.inputs.latestRunDistanceKm.value = valueOrEmpty(profile.recentRun?.distanceKm);
  els.inputs.latestRunAvgPace.value = profile.recentRun?.avgPace || '';
  els.inputs.latestRunAvgHeartRate.value = valueOrEmpty(profile.recentRun?.avgHeartRate);
  els.inputs.latestRunRpe.value = valueOrEmpty(profile.recentRun?.rpe);
  els.inputs.goalDate.value = profile.goalDate || '';
  els.inputs.raceType.value = profile.raceType || '10k';
  els.inputs.goalTime.value = profile.goalTime || '';
  els.inputs.availableDays.value = String(profile.availableDays || 4);
  els.inputs.longRunDay.value = String(profile.longRunDay ?? 0);
}

function serializeState() {
  return {
    appState: state.appState,
    draftProfile: state.draftProfile,
    selectedDate: state.selectedDate,
    viewYear: state.viewYear,
    viewMonth: state.viewMonth,
    lastSyncedAt: state.sync.lastSyncedAt,
  };
}

function applySerializedState(serialized) {
  state.appState = serialized.appState || null;
  state.draftProfile = serialized.draftProfile || null;
  state.selectedDate = serialized.selectedDate || todayIso();
  state.viewYear = Number.isInteger(serialized.viewYear) ? serialized.viewYear : new Date().getFullYear();
  state.viewMonth = Number.isInteger(serialized.viewMonth) ? serialized.viewMonth : new Date().getMonth();
  state.sync.lastSyncedAt = serialized.lastSyncedAt || null;
}

function clearPlannerState() {
  state.appState = null;
  state.draftProfile = null;
  state.selectedDate = todayIso();
  state.viewYear = new Date().getFullYear();
  state.viewMonth = new Date().getMonth();
}

function getStorageKey(userId = state.auth.user?.id || 'guest') {
  return `${STORAGE_PREFIX}:${userId}`;
}

function loadPersistedState(userId) {
  activeLocalStorageUserId = userId || 'guest';
  try {
    const raw = localStorage.getItem(getStorageKey(activeLocalStorageUserId));
    if (!raw) {
      clearPlannerState();
      return;
    }
    const parsed = JSON.parse(raw);
    applySerializedState(parsed);
  } catch (error) {
    console.warn('Failed to restore state', error);
    clearPlannerState();
  }
}

function persistState() {
  localStorage.setItem(getStorageKey(activeLocalStorageUserId), JSON.stringify(serializeState()));
}

function setLoading(isLoading) {
  els.generateBtn.disabled = isLoading;
  els.generateBtn.textContent = isLoading ? '생성 중...' : 'Gemini 훈련표 생성';
  els.loadingOverlay.classList.toggle('hidden', !isLoading);
}

function setSyncStatus(status, message = null) {
  state.sync.status = status;
  state.sync.message = message;
  if (status === 'synced') {
    state.sync.lastSyncedAt = new Date().toISOString();
  }
  renderSyncStatus();
}

function queueSaveWorkspace(delay = 800) {
  if (!state.auth.user || !state.auth.supabase) {
    setSyncStatus(state.auth.configured ? 'sign-in-needed' : 'local-only');
    return;
  }

  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveWorkspace().catch((error) => {
      console.error(error);
      setSyncStatus('error', '클라우드 저장 실패');
    });
  }, delay);
}

async function saveWorkspace() {
  if (!state.auth.user || !state.auth.supabase) return;
  setSyncStatus('saving');

  const payload = {
    user_id: state.auth.user.id,
    email: state.auth.user.email,
    draft_profile: state.draftProfile,
    app_state: state.appState,
    selected_date: state.selectedDate,
    view_year: state.viewYear,
    view_month: state.viewMonth,
    updated_at: new Date().toISOString(),
  };

  const { error } = await state.auth.supabase.from(REMOTE_TABLE).upsert(payload, { onConflict: 'user_id' });
  if (error) throw error;
  persistState();
  setSyncStatus('synced');
}

async function loadWorkspaceFromCloud() {
  if (!state.auth.user || !state.auth.supabase) return false;
  const { data, error } = await state.auth.supabase
    .from(REMOTE_TABLE)
    .select('draft_profile, app_state, selected_date, view_year, view_month, updated_at')
    .eq('user_id', state.auth.user.id)
    .maybeSingle();

  if (error) {
    console.error(error);
    setSyncStatus('error', '클라우드 불러오기 실패');
    return false;
  }

  if (!data) {
    return false;
  }

  applySerializedState({
    draftProfile: data.draft_profile,
    appState: data.app_state,
    selectedDate: data.selected_date,
    viewYear: data.view_year,
    viewMonth: data.view_month,
    lastSyncedAt: data.updated_at,
  });
  persistState();
  setSyncStatus('synced');
  renderAll();
  return true;
}

let toastTimer = null;
function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    els.toast.classList.add('hidden');
  }, 2800);
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

function renderRecentRunSummary(recentRun = {}) {
  const bits = [];
  if (recentRun.date) bits.push(recentRun.date);
  if (recentRun.distanceKm) bits.push(`${recentRun.distanceKm}km`);
  if (recentRun.avgPace) bits.push(`${recentRun.avgPace}/km`);
  if (recentRun.avgHeartRate) bits.push(`${recentRun.avgHeartRate}bpm`);
  if (recentRun.rpe) bits.push(`RPE ${recentRun.rpe}`);
  return bits.length ? bits.join(' · ') : '입력 없음';
}

function formatTime(isoDateTime) {
  if (!isoDateTime) return '';
  const date = new Date(isoDateTime);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function readNullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function readNullableInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function valueOrEmpty(value) {
  return value == null ? '' : String(value);
}

function hasMeaningfulState(snapshot) {
  return Boolean(snapshot?.appState || snapshot?.draftProfile?.goalDate || snapshot?.draftProfile?.goalTime);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
