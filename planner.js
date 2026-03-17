const RACE_DISTANCES_KM = {
  '10k': 10,
  half: 21.0975,
  full: 42.195,
};

const RACE_LABELS = {
  '10k': '10K',
  half: '하프',
  full: '풀코스',
};

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

const TRAINING_WEEKDAY_TEMPLATES = {
  0: {
    2: [4, 0],
    3: [2, 4, 0],
    4: [2, 4, 6, 0],
    5: [1, 2, 4, 6, 0],
    6: [1, 2, 3, 4, 6, 0],
    7: [0, 1, 2, 3, 4, 5, 6],
  },
  6: {
    2: [3, 6],
    3: [2, 4, 6],
    4: [2, 4, 5, 6],
    5: [0, 2, 4, 5, 6],
    6: [0, 1, 2, 3, 5, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
  },
};

export function getRaceDistanceKm(raceType) {
  return RACE_DISTANCES_KM[raceType];
}

export function getRaceLabel(raceType) {
  return RACE_LABELS[raceType] || raceType;
}

export function normalizeProfile(raw = {}) {
  const raceType = String(raw.raceType || '').trim();
  if (!['10k', 'half', 'full'].includes(raceType)) {
    throw badRequest('대회 종목은 10k, half, full 중 하나여야 합니다.');
  }

  const goalDate = String(raw.goalDate || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(goalDate)) {
    throw badRequest('목표 대회 날짜 형식이 올바르지 않습니다.');
  }

  const goalTime = normalizeTimeString(raw.goalTime);
  if (!goalTime) {
    throw badRequest('목표 시간은 HH:MM:SS 또는 MM:SS 형식이어야 합니다.');
  }

  const currentLongestRunKm = toPositiveNumber(raw.currentLongestRunKm, '최근 최장 거리');
  const availableDays = toInteger(raw.availableDays, '주당 훈련 가능 일수');
  if (availableDays < 2 || availableDays > 7) {
    throw badRequest('주당 훈련 가능 일수는 2~7일이어야 합니다.');
  }

  const longRunDay = toInteger(raw.longRunDay, '롱런 선호 요일');
  if (![0, 6].includes(longRunDay)) {
    throw badRequest('롱런 선호 요일은 토요일(6) 또는 일요일(0)여야 합니다.');
  }

  const bestTimes = {
    '5k': normalizeOptionalTimeString(raw.bestTimes?.['5k'] ?? raw.currentBest5kTime),
    '10k': normalizeOptionalTimeString(raw.bestTimes?.['10k'] ?? raw.currentBest10kTime),
    half: normalizeOptionalTimeString(raw.bestTimes?.half ?? raw.currentBestHalfTime),
    full: normalizeOptionalTimeString(raw.bestTimes?.full ?? raw.currentBestFullTime),
  };

  const bestTimeDates = {
    '5k': normalizeOptionalDateString(raw.bestTimeDates?.['5k'] ?? raw.currentBest5kDate),
    '10k': normalizeOptionalDateString(raw.bestTimeDates?.['10k'] ?? raw.currentBest10kDate),
    half: normalizeOptionalDateString(raw.bestTimeDates?.half ?? raw.currentBestHalfDate),
    full: normalizeOptionalDateString(raw.bestTimeDates?.full ?? raw.currentBestFullDate),
  };

  const recentRun = {
    date: normalizeOptionalDateString(raw.recentRun?.date ?? raw.latestRunDate),
    distanceKm: toOptionalPositiveNumber(raw.recentRun?.distanceKm ?? raw.latestRunDistanceKm),
    avgPace: normalizeOptionalPaceString(raw.recentRun?.avgPace ?? raw.latestRunAvgPace),
    avgHeartRate: toOptionalInteger(raw.recentRun?.avgHeartRate ?? raw.latestRunAvgHeartRate, '최근 러닝 평균 심박수'),
    rpe: toOptionalInteger(raw.recentRun?.rpe ?? raw.latestRunRpe, '최근 러닝 RPE'),
  };

  if (recentRun.rpe != null && (recentRun.rpe < 1 || recentRun.rpe > 10)) {
    throw badRequest('최근 러닝 RPE는 1~10 사이여야 합니다.');
  }
  if (recentRun.avgHeartRate != null && (recentRun.avgHeartRate < 60 || recentRun.avgHeartRate > 230)) {
    throw badRequest('최근 러닝 평균 심박수는 60~230 사이여야 합니다.');
  }

  const today = startOfLocalDay(new Date());
  const raceDateObj = parseLocalDate(goalDate);
  if (Number.isNaN(raceDateObj.getTime())) {
    throw badRequest('목표 대회 날짜를 읽을 수 없습니다.');
  }

  if (diffDays(today, raceDateObj) < 7) {
    throw badRequest('대회 날짜는 오늘 기준 최소 7일 이후여야 합니다.');
  }

  const bestTimeSeconds = Object.fromEntries(
    Object.entries(bestTimes).map(([key, value]) => [key, value ? parseTimeToSeconds(value) : null]),
  );

  const bestTimeAgeDays = Object.fromEntries(
    Object.entries(bestTimeDates).map(([key, value]) => [key, value ? diffDays(parseLocalDate(value), today) : null]),
  );

  const recentRunPaceSeconds = recentRun.avgPace ? parsePaceToSeconds(recentRun.avgPace) : null;
  const recentRunAgeDays = recentRun.date ? diffDays(parseLocalDate(recentRun.date), today) : null;

  return {
    raceType,
    goalDate,
    raceDateObj,
    goalTime,
    goalTimeSeconds: parseTimeToSeconds(goalTime),
    goalDistanceKm: RACE_DISTANCES_KM[raceType],
    currentLongestRunKm,
    availableDays,
    longRunDay,
    bestTimes,
    bestTimeDates,
    bestTimeSeconds,
    bestTimeAgeDays,
    recentRun,
    recentRunPaceSeconds,
    recentRunAgeDays,
  };
}

export function buildPlanningContext(profile) {
  const tomorrow = addDays(startOfLocalDay(new Date()), 1);
  const raceDate = profile.raceDateObj;
  const availableWeekdays = resolveTrainingWeekdays(profile.availableDays, profile.longRunDay);
  const rawSlots = [];
  const productWarnings = [];

  const planWeekStart = startOfTrainingWeek(tomorrow);
  const raceWeekStart = startOfTrainingWeek(raceDate);
  const totalWeeks = Math.max(2, Math.floor(diffDays(planWeekStart, raceWeekStart) / 7) + 1);
  const targetPacePerKmSeconds = profile.goalTimeSeconds / profile.goalDistanceKm;
  const recentRunAssessment = assessRecentRun(profile, targetPacePerKmSeconds);

  if (profile.raceType === 'half' && profile.currentLongestRunKm < 8) {
    productWarnings.push('최근 최장 거리가 짧아서 초반 2~3주는 매우 보수적으로 시작하는 편이 좋습니다.');
  }
  if (profile.raceType === 'full' && profile.currentLongestRunKm < 14) {
    productWarnings.push('풀코스 목표 대비 최근 최장 거리가 짧아, 목표 완주/기록 달성 가능성을 보수적으로 판단해야 합니다.');
  }

  const providedPbAges = Object.values(profile.bestTimeAgeDays).filter((value) => Number.isFinite(value));
  if (providedPbAges.length && providedPbAges.every((days) => days > 365)) {
    productWarnings.push('입력한 PB 기록이 모두 1년 이상 지난 기록이라 최근 러닝 데이터를 더 크게 반영하는 편이 좋습니다.');
  }

  if (profile.recentRunAgeDays != null && profile.recentRunAgeDays > 45) {
    productWarnings.push('최근 러닝 기록도 다소 오래돼 현재 컨디션을 보수적으로 해석하는 편이 안전합니다.');
  }

  if (recentRunAssessment.warning) {
    productWarnings.push(recentRunAssessment.warning);
  }

  for (let d = new Date(tomorrow); d < raceDate; d = addDays(d, 1)) {
    if (!availableWeekdays.includes(d.getDay())) continue;

    const weekNumber = Math.floor(diffDays(planWeekStart, startOfTrainingWeek(d)) / 7) + 1;
    rawSlots.push({
      slotId: `S${String(rawSlots.length + 1).padStart(3, '0')}`,
      date: formatLocalDate(d),
      weekday: d.getDay(),
      dayLabel: DAY_LABELS[d.getDay()],
      weekNumber,
      phase: resolvePhase(weekNumber, totalWeeks, profile.raceType),
      isLongRunSlot: d.getDay() === profile.longRunDay,
      isRaceWeek: weekNumber === totalWeeks,
    });
  }

  rawSlots.push({
    slotId: `S${String(rawSlots.length + 1).padStart(3, '0')}`,
    date: profile.goalDate,
    weekday: raceDate.getDay(),
    dayLabel: DAY_LABELS[raceDate.getDay()],
    weekNumber: totalWeeks,
    phase: 'race',
    isLongRunSlot: false,
    isRaceWeek: true,
    isRaceDay: true,
  });

  const easyPaceSeedSeconds = recentRunAssessment.recommendedEasyPaceSec ?? targetPacePerKmSeconds + 50;
  const steadyPaceSeedSeconds = recentRunAssessment.recommendedSteadyPaceSec ?? targetPacePerKmSeconds + 20;
  const weekBlueprints = buildWeekBlueprints({
    profile,
    totalWeeks,
    targetPacePerKmSeconds,
    easyPaceSeedSeconds,
    steadyPaceSeedSeconds,
    recentRunAssessment,
  });

  const slots = applySlotPrescriptions({
    rawSlots,
    weekBlueprints,
    profile,
    targetPacePerKmSeconds,
    easyPaceSeedSeconds,
    steadyPaceSeedSeconds,
  });

  return {
    startDate: formatLocalDate(tomorrow),
    raceDate: profile.goalDate,
    totalWeeks,
    targetPacePerKm: formatPace(targetPacePerKmSeconds),
    targetPacePerKmSeconds,
    availableWeekdays,
    availableWeekdayLabels: availableWeekdays.map((day) => DAY_LABELS[day]),
    productWarnings,
    recentRunAssessment,
    easyPaceSeedSeconds,
    steadyPaceSeedSeconds,
    weekBlueprints,
    slots,
  };
}


function buildWeekBlueprints({ profile, totalWeeks, targetPacePerKmSeconds, easyPaceSeedSeconds, steadyPaceSeedSeconds, recentRunAssessment }) {
  const settingsByRace = {
    '10k': {
      minStartingLongKm: 6,
      maxLongKm: 14,
      taperFloorKm: 8,
      easyStartMin: 35,
      recoveryStartMin: 25,
      longStepBase: 0.5,
      longStepBuild: 1,
      longStepPeak: 0.5,
      firstTaperFactor: 0.78,
      qualityBaseMin: 40,
    },
    half: {
      minStartingLongKm: 8,
      maxLongKm: 22,
      taperFloorKm: 10,
      easyStartMin: 40,
      recoveryStartMin: 30,
      longStepBase: 1,
      longStepBuild: 1.5,
      longStepPeak: 1,
      firstTaperFactor: 0.75,
      qualityBaseMin: 45,
    },
    full: {
      minStartingLongKm: 12,
      maxLongKm: 30,
      taperFloorKm: 12,
      easyStartMin: 45,
      recoveryStartMin: 35,
      longStepBase: 1.5,
      longStepBuild: 2,
      longStepPeak: 1,
      firstTaperFactor: 0.72,
      secondTaperFactor: 0.68,
      qualityBaseMin: 50,
    },
  };

  const settings = settingsByRace[profile.raceType];
  const blueprints = [];
  const cautionFactor = recentRunAssessment.warning ? 0.9 : 1;
  let longRunKm = roundToHalf(Math.max(profile.currentLongestRunKm, settings.minStartingLongKm));

  for (let weekNumber = 1; weekNumber <= totalWeeks; weekNumber += 1) {
    const phase = resolvePhase(weekNumber, totalWeeks, profile.raceType);
    const isRaceWeek = weekNumber === totalWeeks;
    const isCutbackWeek = weekNumber > 2 && weekNumber < totalWeeks - 1 && weekNumber % 4 === 0;

    if (!isRaceWeek) {
      if (phase === 'taper') {
        const taperFactor = profile.raceType === 'full' && weekNumber < totalWeeks - 1
          ? settings.secondTaperFactor ?? settings.firstTaperFactor
          : settings.firstTaperFactor;
        longRunKm = Math.max(settings.taperFloorKm, roundToHalf(longRunKm * taperFactor));
      } else if (isCutbackWeek) {
        longRunKm = Math.max(settings.minStartingLongKm, roundToHalf(longRunKm * 0.86));
      } else if (weekNumber > 1) {
        const step = phase === 'base'
          ? settings.longStepBase
          : phase === 'build'
            ? settings.longStepBuild
            : settings.longStepPeak;
        const stepped = roundToHalf(longRunKm + (step * cautionFactor));
        longRunKm = Math.min(settings.maxLongKm, stepped);
      }
    }

    const easyDurationMin = resolveEasyDurationMin({
      raceType: profile.raceType,
      weekNumber,
      phase,
      isCutbackWeek,
      isRaceWeek,
      availableDays: profile.availableDays,
      baseDurationMin: settings.easyStartMin,
    });
    const recoveryDurationMin = resolveRecoveryDurationMin({
      raceType: profile.raceType,
      phase,
      isCutbackWeek,
      isRaceWeek,
      baseDurationMin: settings.recoveryStartMin,
    });
    const quality = buildQualityBlueprint({
      profile,
      weekNumber,
      phase,
      isCutbackWeek,
      isRaceWeek,
      targetPacePerKmSeconds,
      easyPaceSeedSeconds,
      steadyPaceSeedSeconds,
      recentRunAssessment,
      qualityBaseMin: settings.qualityBaseMin,
    });

    blueprints.push({
      weekNumber,
      phase,
      isCutbackWeek,
      isRaceWeek,
      longRunKm: isRaceWeek ? roundToOne(profile.goalDistanceKm) : longRunKm,
      easyDurationMin,
      recoveryDurationMin,
      quality,
      coachNote: buildWeekCoachNote({ profile, phase, isCutbackWeek, weekNumber, quality }),
      totalTargetMin: null,
    });
  }

  return blueprints;
}

function resolveEasyDurationMin({ raceType, weekNumber, phase, isCutbackWeek, isRaceWeek, availableDays, baseDurationMin }) {
  let duration = baseDurationMin + (Math.floor(Math.max(0, weekNumber - 1) / 2) * 5);
  if (availableDays >= 6) duration += 5;
  if (phase === 'peak') duration += raceType === 'full' ? 10 : 5;
  if (isCutbackWeek) duration -= 5;
  if (phase === 'taper') duration = Math.max(baseDurationMin - 5, duration - 10);
  if (isRaceWeek) duration = Math.max(25, baseDurationMin - 10);
  return clamp(Math.round(duration), 25, raceType === 'full' ? 80 : 65);
}

function resolveRecoveryDurationMin({ raceType, phase, isCutbackWeek, isRaceWeek, baseDurationMin }) {
  let duration = baseDurationMin;
  if (phase === 'build') duration += 5;
  if (phase === 'peak') duration += raceType === 'full' ? 5 : 0;
  if (isCutbackWeek) duration = Math.max(baseDurationMin - 5, duration - 5);
  if (phase === 'taper' || isRaceWeek) duration = Math.max(20, duration - 10);
  return clamp(Math.round(duration), 20, 50);
}

function buildQualityBlueprint({ profile, weekNumber, phase, isCutbackWeek, isRaceWeek, targetPacePerKmSeconds, easyPaceSeedSeconds, steadyPaceSeedSeconds, recentRunAssessment, qualityBaseMin }) {
  if (isRaceWeek) {
    return {
      sessionType: 'race-pace',
      titleHint: '레이스 페이스 리허설',
      descriptionHint: '워밍업 후 짧게 목표 페이스 감각만 확인하고 상쾌하게 마무리합니다.',
      durationMin: Math.max(25, qualityBaseMin - 20),
      distanceKm: null,
      targetPace: formatPaceRange(targetPacePerKmSeconds - 2, targetPacePerKmSeconds + 4),
      intensity: 'moderate',
      focusLabel: '상쾌한 컨디션 유지',
    };
  }

  const cycle = (weekNumber - 1) % 3;
  const tempoPace = formatPaceRange(targetPacePerKmSeconds + 8, targetPacePerKmSeconds + 18);
  const intervalPace = formatPaceRange(targetPacePerKmSeconds - 15, targetPacePerKmSeconds - 3);
  const racePace = formatPaceRange(targetPacePerKmSeconds - 2, targetPacePerKmSeconds + 4);
  const steadyPace = formatPaceRange(steadyPaceSeedSeconds - 5, steadyPaceSeedSeconds + 10);
  const supportPace = formatPaceRange(easyPaceSeedSeconds - 5, easyPaceSeedSeconds + 12);

  if (phase === 'base') {
    if (cycle === 1) {
      const reps = 5 + Math.min(3, Math.floor(weekNumber / 2));
      const repMin = profile.raceType === '10k' ? 2 : 3;
      return {
        sessionType: 'interval',
        titleHint: `인터벌 ${reps}x${repMin}분`,
        descriptionHint: `워밍업 후 ${repMin}분 빠르게 × ${reps}회, 반복 사이 ${Math.max(1, repMin - 1)}~2분 조깅으로 리듬을 살립니다.`,
        durationMin: qualityBaseMin + 5,
        distanceKm: null,
        targetPace: intervalPace,
        intensity: 'hard',
        focusLabel: '짧은 스피드 자극',
      };
    }

    const tempoBlock = profile.raceType === '10k' ? 12 + (weekNumber * 2) : 15 + (weekNumber * 2);
    return {
      sessionType: cycle === 2 ? 'race-pace' : 'tempo',
      titleHint: cycle === 2 ? `프로그레션 ${tempoBlock}분` : `템포 ${tempoBlock}분`,
      descriptionHint: cycle === 2
        ? `워밍업 후 ${Math.max(10, tempoBlock - 5)}분은 안정적인 스테디, 마지막 5분은 목표 페이스 근처까지 올립니다.`
        : `워밍업 후 ${tempoBlock}분 템포 구간 1회로 리듬과 자세를 정리합니다.`,
      durationMin: qualityBaseMin,
      distanceKm: null,
      targetPace: cycle === 2 ? steadyPace : tempoPace,
      intensity: 'moderate',
      focusLabel: cycle === 2 ? '리듬 적응' : '젖산역치 적응',
    };
  }

  if (phase === 'build') {
    if (cycle === 0) {
      const blockMin = profile.raceType === 'full' ? 18 + (weekNumber * 2) : 15 + (weekNumber * 2);
      return {
        sessionType: 'tempo',
        titleHint: `템포 2x${Math.round(blockMin / 2)}분`,
        descriptionHint: `워밍업 후 ${Math.round(blockMin / 2)}분 템포 2세트, 세트 사이 3분 조깅으로 지속 능력을 키웁니다.`,
        durationMin: qualityBaseMin + 10,
        distanceKm: null,
        targetPace: tempoPace,
        intensity: 'moderate',
        focusLabel: '지속 주행 능력 강화',
      };
    }
    if (cycle === 1) {
      const reps = profile.raceType === 'full' ? 5 : 6;
      const repDistanceKm = profile.raceType === '10k' ? 0.8 : 1;
      return {
        sessionType: 'interval',
        titleHint: `인터벌 ${reps}x${repDistanceKm}km`,
        descriptionHint: `워밍업 후 ${repDistanceKm}km 빠르게 × ${reps}회, 반복 사이 2분 조깅으로 효율을 올립니다.`,
        durationMin: qualityBaseMin + 10,
        distanceKm: null,
        targetPace: intervalPace,
        intensity: 'hard',
        focusLabel: 'VO2max 자극',
      };
    }
    const racePaceMin = profile.raceType === 'full' ? 30 : 20 + (Math.floor(weekNumber / 2) * 3);
    return {
      sessionType: 'race-pace',
      titleHint: `RP ${racePaceMin}분`,
      descriptionHint: `워밍업 후 ${racePaceMin}분 동안 목표 페이스 감각을 안정적으로 유지합니다.`,
      durationMin: qualityBaseMin + 5,
      distanceKm: null,
      targetPace: racePace,
      intensity: 'moderate',
      focusLabel: '목표 페이스 적응',
    };
  }

  const peakDuration = qualityBaseMin + (profile.raceType === 'full' ? 15 : 10);
  if (profile.raceType === '10k') {
    return cycle === 1
      ? {
          sessionType: 'interval',
          titleHint: '인터벌 6x800m',
          descriptionHint: '워밍업 후 800m 빠르게 6회, 반복 사이 2분 조깅으로 10K 리듬을 다듬습니다.',
          durationMin: peakDuration,
          distanceKm: null,
          targetPace: intervalPace,
          intensity: 'hard',
          focusLabel: '10K 스피드 내성',
        }
      : {
          sessionType: 'race-pace',
          titleHint: 'RP 3x2km',
          descriptionHint: '워밍업 후 2km × 3세트를 목표 페이스로 진행하고 세트 사이 3분 조깅합니다.',
          durationMin: peakDuration,
          distanceKm: null,
          targetPace: racePace,
          intensity: 'moderate',
          focusLabel: '10K 레이스 감각',
        };
  }

  if (profile.raceType === 'half') {
    return cycle === 1
      ? {
          sessionType: 'tempo',
          titleHint: '템포 3x10분',
          descriptionHint: '워밍업 후 10분 템포 3세트, 세트 사이 3분 조깅으로 하프 지구력을 완성합니다.',
          durationMin: peakDuration,
          distanceKm: null,
          targetPace: tempoPace,
          intensity: 'moderate',
          focusLabel: '하프 지속 페이스',
        }
      : {
          sessionType: 'race-pace',
          titleHint: 'RP 8~10km 적응',
          descriptionHint: '워밍업 후 중간 구간에 목표 페이스 8~10km 상당의 리듬을 넣어 레이스 감각을 익힙니다.',
          durationMin: peakDuration,
          distanceKm: null,
          targetPace: racePace,
          intensity: 'moderate',
          focusLabel: '하프 레이스 특이성',
        };
  }

  return cycle === 1
    ? {
        sessionType: 'tempo',
        titleHint: '마라톤 템포 2x20분',
        descriptionHint: '워밍업 후 20분 템포 2세트로 효율을 높이고 세트 사이 4분 조깅합니다.',
        durationMin: peakDuration,
        distanceKm: null,
        targetPace: tempoPace,
        intensity: 'moderate',
        focusLabel: '마라톤 효율',
      }
    : {
        sessionType: 'race-pace',
        titleHint: '마라톤 페이스 10~14km',
        descriptionHint: '워밍업 후 목표 마라톤 페이스 구간을 길게 넣어 레이스 리듬을 각인합니다.',
        durationMin: peakDuration,
        distanceKm: null,
        targetPace: racePace,
        intensity: recentRunAssessment.intensity === 'hard' ? 'moderate' : 'moderate',
        focusLabel: '마라톤 페이스 체화',
      };
}

function buildWeekCoachNote({ profile, phase, isCutbackWeek, weekNumber, quality }) {
  if (phase === 'base') {
    return `${weekNumber}주차는 기반기입니다. ${quality.focusLabel}보다도 편안한 러닝 리듬과 회복 습관을 우선하세요.`;
  }
  if (phase === 'build') {
    return isCutbackWeek
      ? `${weekNumber}주차는 컷백 주간입니다. 훈련을 덜 하는 것이 아니라 다음 상승을 위한 회복을 확보하는 주간입니다.`
      : `${weekNumber}주차는 빌드 단계입니다. ${quality.focusLabel} 훈련의 질을 챙기되, 나머지 러닝은 충분히 쉽게 가져가세요.`;
  }
  if (phase === 'peak') {
    return profile.raceType === 'full'
      ? `${weekNumber}주차는 피크 단계입니다. 긴 러닝과 마라톤 페이스 자극 뒤 수면·영양·회복을 우선하세요.`
      : `${weekNumber}주차는 피크 단계입니다. ${quality.focusLabel}를 살리되 과한 추가 운동은 피하세요.`;
  }
  if (phase === 'taper') {
    return `${weekNumber}주차는 테이퍼 단계입니다. 훈련량은 줄이고 몸의 탄성을 살리는 데 집중하세요.`;
  }
  return '레이스 주간입니다. 무리한 보강 대신 컨디션을 최상으로 맞추세요.';
}

function applySlotPrescriptions({ rawSlots, weekBlueprints, profile, targetPacePerKmSeconds, easyPaceSeedSeconds, steadyPaceSeedSeconds }) {
  const grouped = groupSlotsByWeek(rawSlots);
  const hydrated = [];

  for (const weekSlots of grouped) {
    const weekNumber = weekSlots[0]?.weekNumber;
    const blueprint = weekBlueprints.find((item) => item.weekNumber === weekNumber);
    if (!blueprint) continue;

    const raceSlot = weekSlots.find((slot) => slot.isRaceDay);
    const ordered = [...weekSlots.filter((slot) => !slot.isRaceDay)].sort((a, b) => a.date.localeCompare(b.date));
    const pattern = getSessionPattern(profile.availableDays, ordered.length, blueprint.phase);
    let qualityAssigned = false;
    let totalTargetMin = 0;

    for (let index = 0; index < ordered.length; index += 1) {
      const slot = ordered[index];
      const patternType = slot.isLongRunSlot ? 'long' : pattern[Math.min(index, pattern.length - 1)] || 'easy';

      const prescription = buildSessionPrescription({
        slot,
        patternType,
        qualityAssigned,
        blueprint,
        profile,
        targetPacePerKmSeconds,
        easyPaceSeedSeconds,
        steadyPaceSeedSeconds,
      });

      if (prescription.isMainQuality) {
        qualityAssigned = true;
      }
      totalTargetMin += prescription.durationMin ?? 0;
      hydrated.push({ ...slot, prescription });
    }

    if (blueprint) {
      blueprint.totalTargetMin = totalTargetMin;
    }

    if (raceSlot) {
      hydrated.push({
        ...raceSlot,
        prescription: {
          sessionType: 'race',
          titleHint: `${getRaceLabel(profile.raceType)} 대회`,
          descriptionHint: `${profile.goalTime} 목표로 레이스에 참가합니다.`,
          durationMin: Math.round(profile.goalTimeSeconds / 60),
          distanceKm: roundToOne(profile.goalDistanceKm),
          targetPace: formatPaceRange(targetPacePerKmSeconds - 2, targetPacePerKmSeconds + 2),
          intensity: 'race',
          successCriteria: '컨디션을 점검하며 무리 없이 레이스를 운영하면 성공입니다.',
          isMainQuality: false,
        },
      });
    }
  }

  return sortHydratedSlots(hydrated);
}

function buildSessionPrescription({ slot, patternType, qualityAssigned, blueprint, profile, targetPacePerKmSeconds, easyPaceSeedSeconds, steadyPaceSeedSeconds }) {
  if (patternType === 'long') {
    const easyBand = blueprint.phase === 'peak'
      ? formatPaceRange(easyPaceSeedSeconds - 5, easyPaceSeedSeconds + 10)
      : formatPaceRange(easyPaceSeedSeconds, easyPaceSeedSeconds + 15);
    const durationMin = Math.round((blueprint.longRunKm * easyPaceSeedSeconds) / 60);
    return {
      sessionType: 'long',
      titleHint: `롱런 ${roundToHalf(blueprint.longRunKm)}km`,
      descriptionHint: blueprint.phase === 'peak' && profile.raceType === 'full'
        ? '편안하게 시작하고 후반은 약간 탄력 있게 마무리해 대회 특이 지구력을 만듭니다.'
        : '대화 가능한 강도로 오래 달리며 지구력을 쌓습니다.',
      durationMin: clamp(durationMin, 45, 240),
      distanceKm: roundToHalf(blueprint.longRunKm),
      targetPace: easyBand,
      intensity: blueprint.phase === 'taper' ? 'easy' : 'moderate',
      successCriteria: blueprint.phase === 'peak'
        ? '후반에도 폼이 무너지지 않고 리듬을 유지하면 성공입니다.'
        : '처음부터 끝까지 편안한 호흡으로 마무리하면 성공입니다.',
      isMainQuality: false,
    };
  }

  if (patternType === 'recovery') {
    return {
      sessionType: 'recovery',
      titleHint: `회복 조깅 ${blueprint.recoveryDurationMin}분`,
      descriptionHint: '가볍게 몸을 푸는 회복 러닝입니다. 피로를 쌓지 않는 것이 목적입니다.',
      durationMin: blueprint.recoveryDurationMin,
      distanceKm: null,
      targetPace: formatPaceRange(easyPaceSeedSeconds + 5, easyPaceSeedSeconds + 20),
      intensity: 'easy',
      successCriteria: '오히려 몸이 가벼워지는 느낌으로 마치면 성공입니다.',
      isMainQuality: false,
    };
  }

  if (patternType === 'quality' && !qualityAssigned) {
    return {
      sessionType: blueprint.quality.sessionType,
      titleHint: blueprint.quality.titleHint,
      descriptionHint: blueprint.quality.descriptionHint,
      durationMin: blueprint.quality.durationMin,
      distanceKm: blueprint.quality.distanceKm,
      targetPace: blueprint.quality.targetPace,
      intensity: blueprint.quality.intensity,
      successCriteria: '워밍업부터 마무리까지 자세와 리듬을 안정적으로 유지하면 성공입니다.',
      isMainQuality: true,
    };
  }

  if (patternType === 'race-pace' && !qualityAssigned) {
    return {
      sessionType: 'race-pace',
      titleHint: `RP ${Math.max(12, Math.round(blueprint.quality.durationMin * 0.45))}분`,
      descriptionHint: '짧은 목표 페이스 구간으로 레이스 감각만 살리고 전체 피로는 크게 남기지 않습니다.',
      durationMin: Math.max(35, Math.round(blueprint.quality.durationMin * 0.8)),
      distanceKm: null,
      targetPace: formatPaceRange(targetPacePerKmSeconds - 2, targetPacePerKmSeconds + 4),
      intensity: 'moderate',
      successCriteria: '목표 페이스를 억지로 밀지 않고 자연스럽게 맞추면 성공입니다.',
      isMainQuality: true,
    };
  }

  if (patternType === 'race-pace') {
    const rpBlock = blueprint.phase === 'base' ? 10 : blueprint.phase === 'build' ? 15 : 20;
    return {
      sessionType: 'race-pace',
      titleHint: `리듬 조깅 + RP ${rpBlock}분`,
      descriptionHint: '대부분은 편안하게 달리고, 중간에 짧게 목표 페이스 감각만 확인합니다.',
      durationMin: Math.max(35, blueprint.easyDurationMin),
      distanceKm: null,
      targetPace: formatPaceRange(targetPacePerKmSeconds, targetPacePerKmSeconds + 5),
      intensity: 'moderate',
      successCriteria: '전체적으로 여유를 유지한 채 짧은 목표 페이스 구간을 소화하면 성공입니다.',
      isMainQuality: false,
    };
  }

  const easyOffset = patternType === 'easy' && slot.weekday === 2 ? -5 : 0;
  const duration = clamp(blueprint.easyDurationMin + easyOffset, 25, profile.raceType === 'full' ? 80 : 65);
  return {
    sessionType: 'easy',
    titleHint: `이지런 ${duration}분`,
    descriptionHint: blueprint.phase === 'taper'
      ? '가볍고 상쾌하게 몸을 푸는 느낌으로 달립니다.'
      : '편안한 대화가 가능한 강도로 유산소 지구력을 쌓습니다.',
    durationMin: duration,
    distanceKm: null,
    targetPace: formatPaceRange(easyPaceSeedSeconds - 2, easyPaceSeedSeconds + 12),
    intensity: 'easy',
    successCriteria: '호흡이 안정적이고 끝난 뒤 한 번 더 뛸 수 있겠다는 느낌이면 성공입니다.',
    isMainQuality: false,
  };
}

function formatPaceRange(fasterSecondsPerKm, slowerSecondsPerKm) {
  const fast = Math.min(fasterSecondsPerKm, slowerSecondsPerKm);
  const slow = Math.max(fasterSecondsPerKm, slowerSecondsPerKm);
  return `${formatPace(fast)} ~ ${formatPace(slow)}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}


export async function generatePlanWithOpenAI({ client, model, profile, context }) {
  const schema = buildResponseSchema(context);
  const promptPayload = {
    runnerProfile: {
      raceType: profile.raceType,
      raceLabel: getRaceLabel(profile.raceType),
      raceDate: profile.goalDate,
      goalTime: profile.goalTime,
      goalDistanceKm: profile.goalDistanceKm,
      targetPacePerKm: context.targetPacePerKm,
      currentLongestRunKm: profile.currentLongestRunKm,
      availableDaysPerWeek: profile.availableDays,
      preferredLongRunDay: DAY_LABELS[profile.longRunDay],
      recentBestTimes: {
        '5k': { time: profile.bestTimes['5k'], date: profile.bestTimeDates['5k'] },
        '10k': { time: profile.bestTimes['10k'], date: profile.bestTimeDates['10k'] },
        half: { time: profile.bestTimes.half, date: profile.bestTimeDates.half },
        full: { time: profile.bestTimes.full, date: profile.bestTimeDates.full },
      },
      latestRun: {
        date: profile.recentRun.date,
        distanceKm: profile.recentRun.distanceKm,
        avgPace: profile.recentRun.avgPace,
        avgHeartRate: profile.recentRun.avgHeartRate,
        rpe: profile.recentRun.rpe,
        inferredIntensity: context.recentRunAssessment.intensityLabel,
        summary: context.recentRunAssessment.summary,
      },
      productWarnings: context.productWarnings,
    },
    planningRules: {
      planStartDate: context.startDate,
      totalWeeks: context.totalWeeks,
      trainingWeekdays: context.availableWeekdayLabels,
      weekBlueprints: context.weekBlueprints.map((week) => ({
        weekNumber: week.weekNumber,
        phase: week.phase,
        isCutbackWeek: week.isCutbackWeek,
        totalTargetMin: week.totalTargetMin,
        longRunKm: week.longRunKm,
        easyDurationMin: week.easyDurationMin,
        recoveryDurationMin: week.recoveryDurationMin,
        quality: week.quality,
        coachNote: week.coachNote,
      })),
      requiredSlotCount: context.slots.length,
      slots: context.slots,
      principles: [
        'Use the slotId exactly as provided and create exactly one session for every slot.',
        'Do not invent extra dates or omit dates.',
        'Treat each slot prescription as the primary plan skeleton for session type, volume, distance, and pace.',
        'Weekly load must evolve. Long run, quality volume, easy duration, or total running time should progress across base/build weeks, with cutback and taper weeks clearly lighter.',
        'Do not repeat an identical long run distance and identical quality workout for three straight non-taper weeks.',
        'Most weekly volume should stay easy or recovery oriented.',
        'Use one main quality session per week for most weeks. Any secondary faster session should stay light and controlled.',
        'Final slot is race day and should be the target race.',
        'Weight newer data more than stale PBs. A recent run is more important than an old PR when they conflict.',
        'Use short, practical Korean text that looks good inside a calendar/todo UI.',
      ],
    },
  };

  const response = await client.responses.create({
    model,
    temperature: 0.15,
    instructions: [
      'You are an experienced running coach building a calendar-friendly training plan.',
      'You are not a doctor. If the target looks aggressive, include warnings and reduce progression speed.',
      'Return only the structured JSON requested by the schema.',
      'Follow the provided slot prescriptions closely for duration, distance, and pace. Improve the coaching language, workout clarity, and weekly flow, but do not flatten the progression.',
      'Each slot must be actionable in a todo-list style UI, with concise titles and short success criteria.',
      'For easy or recovery runs, prioritize time-based prescriptions if exact distance is uncertain.',
      'For long runs, include distance when practical.',
      'When PB dates are old, trust the latest run and current background more than the old PB.',
      'Consider average heart rate and RPE as rough intensity clues, not exact physiology.',
    ].join(' '),
    input: [
      {
        role: 'user',
        content: JSON.stringify(promptPayload),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'running_training_plan',
        strict: true,
        schema,
      },
    },
  });

  const rawText = extractOutputText(response);
  if (!rawText) {
    throw new Error('OpenAI 응답에서 텍스트를 찾지 못했습니다.');
  }

  const parsed = JSON.parse(rawText);
  return hydratePlanFromModel(parsed, context, model, 'openai');
}

export function buildFallbackPlan(profile, context, reason = null) {
  const warnings = [...context.productWarnings];
  if (reason) {
    warnings.unshift(reason);
  }

  const coachNotes = context.weekBlueprints.map((week) => ({
    weekNumber: week.weekNumber,
    note: week.coachNote,
  }));

  const hydratedSlots = context.slots.map((slot) => createFallbackSessionFromPrescription(slot, profile, context));

  return {
    meta: {
      generatedBy: 'fallback',
      modelName: 'rule-based-generator',
      sourceLabel: '로컬 규칙 기반',
    },
    warnings,
    coachNotes,
    slots: sortHydratedSlots(hydratedSlots),
  };
}

function createFallbackSessionFromPrescription(slot, profile, context) {
  const prescription = slot.prescription || {};

  if (slot.isRaceDay) {
    return {
      ...slot,
      sessionType: 'race',
      title: `${getRaceLabel(profile.raceType)} 대회`,
      description: `${profile.goalTime} 목표로 레이스에 참가합니다.`,
      durationMin: prescription.durationMin ?? Math.round(profile.goalTimeSeconds / 60),
      distanceKm: prescription.distanceKm ?? roundToOne(profile.goalDistanceKm),
      targetPace: prescription.targetPace ?? context.targetPacePerKm,
      intensity: 'race',
      successCriteria: prescription.successCriteria ?? '컨디션 확인 후 무리하지 않고 레이스를 운영하면 성공입니다.',
    };
  }

  return {
    ...slot,
    sessionType: prescription.sessionType ?? 'easy',
    title: prescription.titleHint ?? resolveFallbackTitle(prescription.sessionType),
    description: prescription.descriptionHint ?? '컨디션을 보며 무리하지 않고 진행합니다.',
    durationMin: prescription.durationMin ?? null,
    distanceKm: prescription.distanceKm ?? null,
    targetPace: prescription.targetPace ?? null,
    intensity: prescription.intensity ?? 'easy',
    successCriteria: prescription.successCriteria ?? '계획한 강도를 유지하고 과도한 피로 없이 마치면 성공입니다.',
  };
}

function resolveFallbackTitle(sessionType) {
  switch (sessionType) {
    case 'easy':
      return '이지런';
    case 'recovery':
      return '회복 조깅';
    case 'tempo':
      return '템포런';
    case 'interval':
      return '인터벌';
    case 'race-pace':
      return '레이스 페이스 런';
    case 'long':
      return '롱런';
    case 'race':
      return '레이스';
    default:
      return '러닝';
  }
}

function hydratePlanFromModel(parsed, context, modelName, generatedBy) {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('모델 응답 형식이 올바르지 않습니다.');
  }

  const slotLookup = new Map(context.slots.map((slot) => [slot.slotId, slot]));
  const seen = new Set();
  const hydratedSlots = [];

  for (const item of parsed.slots || []) {
    if (!slotLookup.has(item.slotId)) {
      throw new Error(`알 수 없는 slotId: ${item.slotId}`);
    }
    if (seen.has(item.slotId)) {
      throw new Error(`중복된 slotId: ${item.slotId}`);
    }
    seen.add(item.slotId);

    const slotMeta = slotLookup.get(item.slotId);
    const prescription = slotMeta.prescription || {};

    hydratedSlots.push({
      ...slotMeta,
      sessionType: prescription.sessionType ?? item.sessionType,
      title: sanitizeText(item.title || prescription.titleHint || resolveFallbackTitle(prescription.sessionType), 40),
      description: sanitizeText(item.description || prescription.descriptionHint || '계획된 강도에 맞춰 진행합니다.', 200),
      durationMin: resolvePlannedNumber(item.durationMin, prescription.durationMin),
      distanceKm: resolvePlannedNumber(item.distanceKm, prescription.distanceKm),
      targetPace: prescription.targetPace ?? item.targetPace ?? null,
      intensity: prescription.intensity ?? item.intensity ?? 'easy',
      successCriteria: sanitizeText(item.successCriteria || prescription.successCriteria || '계획한 강도를 지키고 무리 없이 마치면 성공입니다.', 120),
    });
  }

  if (hydratedSlots.length !== context.slots.length) {
    throw new Error('모든 슬롯이 채워지지 않았습니다.');
  }

  return {
    meta: {
      generatedBy,
      modelName,
      sourceLabel: generatedBy === 'openai' ? 'GPT 생성' : '로컬 규칙 기반',
    },
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 8) : [],
    coachNotes: Array.isArray(parsed.coachNotes) && parsed.coachNotes.length === context.totalWeeks
      ? parsed.coachNotes
      : context.weekBlueprints.map((week) => ({ weekNumber: week.weekNumber, note: week.coachNote })),
    slots: sortHydratedSlots(hydratedSlots),
  };
}

function buildResponseSchema(context) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['meta', 'warnings', 'coachNotes', 'slots'],
    properties: {
      meta: {
        type: 'object',
        additionalProperties: false,
        required: ['planStyle', 'cautionLevel'],
        properties: {
          planStyle: {
            type: 'string',
            enum: ['conservative', 'balanced', 'ambitious'],
          },
          cautionLevel: {
            type: 'string',
            enum: ['low', 'moderate', 'high'],
          },
        },
      },
      warnings: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string' },
      },
      coachNotes: {
        type: 'array',
        minItems: context.totalWeeks,
        maxItems: context.totalWeeks,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['weekNumber', 'note'],
          properties: {
            weekNumber: {
              type: 'integer',
              minimum: 1,
              maximum: context.totalWeeks,
            },
            note: {
              type: 'string',
            },
          },
        },
      },
      slots: {
        type: 'array',
        minItems: context.slots.length,
        maxItems: context.slots.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'slotId',
            'sessionType',
            'title',
            'description',
            'durationMin',
            'distanceKm',
            'targetPace',
            'intensity',
            'successCriteria',
          ],
          properties: {
            slotId: {
              type: 'string',
              enum: context.slots.map((slot) => slot.slotId),
            },
            sessionType: {
              type: 'string',
              enum: ['easy', 'recovery', 'tempo', 'interval', 'race-pace', 'long', 'race'],
            },
            title: { type: 'string' },
            description: { type: 'string' },
            durationMin: {
              type: ['integer', 'null'],
              minimum: 15,
              maximum: 420,
            },
            distanceKm: {
              type: ['number', 'null'],
              minimum: 1,
              maximum: 60,
            },
            targetPace: {
              type: ['string', 'null'],
            },
            intensity: {
              type: 'string',
              enum: ['easy', 'moderate', 'hard', 'race'],
            },
            successCriteria: { type: 'string' },
          },
        },
      },
    },
  };
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text;
  }

  for (const outputItem of response?.output || []) {
    if (outputItem.type !== 'message') continue;
    for (const contentItem of outputItem.content || []) {
      if (contentItem.type === 'output_text' && typeof contentItem.text === 'string') {
        return contentItem.text;
      }
    }
  }

  return null;
}

export function materializePlanState(profile, context, plan) {
  const sessionsByDate = {};

  for (const slot of plan.slots) {
    const session = {
      id: slot.slotId,
      date: slot.date,
      weekNumber: slot.weekNumber,
      phase: slot.phase,
      sessionType: slot.sessionType,
      title: slot.title,
      description: slot.description,
      durationMin: slot.durationMin,
      distanceKm: slot.distanceKm,
      targetPace: slot.targetPace,
      intensity: slot.intensity,
      successCriteria: slot.successCriteria,
      status: 'pending',
      note: '',
    };

    sessionsByDate[slot.date] ??= [];
    sessionsByDate[slot.date].push(session);
  }

  for (const list of Object.values(sessionsByDate)) {
    list.sort((a, b) => a.id.localeCompare(b.id));
  }

  return {
    profile: {
      raceType: profile.raceType,
      raceLabel: getRaceLabel(profile.raceType),
      goalDate: profile.goalDate,
      goalTime: profile.goalTime,
      currentLongestRunKm: profile.currentLongestRunKm,
      availableDays: profile.availableDays,
      longRunDay: profile.longRunDay,
      bestTimes: profile.bestTimes,
      bestTimeDates: profile.bestTimeDates,
      recentRun: profile.recentRun,
      recentRunAssessment: context.recentRunAssessment,
    },
    planMeta: {
      source: plan.meta.sourceLabel,
      generatedBy: plan.meta.generatedBy,
      modelName: plan.meta.modelName,
      totalWeeks: context.totalWeeks,
      targetPacePerKm: context.targetPacePerKm,
      trainingWeekdays: context.availableWeekdayLabels,
      planStartDate: context.startDate,
      raceDate: context.raceDate,
      createdAt: new Date().toISOString(),
      warnings: plan.warnings,
      coachNotes: plan.coachNotes,
    },
    sessionsByDate,
  };
}

function resolveTrainingWeekdays(availableDays, longRunDay) {
  const template = TRAINING_WEEKDAY_TEMPLATES[longRunDay]?.[availableDays];
  if (template) {
    return template;
  }
  return [0, 1, 2, 3, 4, 5, 6].slice(0, availableDays).sort((a, b) => a - b);
}

function resolvePhase(weekNumber, totalWeeks, raceType) {
  if (weekNumber >= totalWeeks) return 'race';

  const taperWeeks = raceType === 'full' && totalWeeks >= 10 ? 2 : 1;
  const peakWeeks = totalWeeks >= 8 ? 2 : 1;
  const baseWeeks = Math.max(1, Math.floor((totalWeeks - taperWeeks - peakWeeks) * 0.45));
  const buildWeeks = Math.max(1, totalWeeks - taperWeeks - peakWeeks - baseWeeks);

  if (weekNumber <= baseWeeks) return 'base';
  if (weekNumber <= baseWeeks + buildWeeks) return 'build';
  if (weekNumber <= totalWeeks - taperWeeks - 1) return 'peak';
  return 'taper';
}

function getSessionPattern(availableDays, slotCount) {
  const patterns = {
    1: ['easy'],
    2: ['quality', 'long'],
    3: ['easy', 'quality', 'long'],
    4: ['easy', 'quality', 'recovery', 'long'],
    5: ['easy', 'quality', 'easy', 'race-pace', 'long'],
    6: ['easy', 'quality', 'easy', 'race-pace', 'recovery', 'long'],
    7: ['easy', 'quality', 'easy', 'race-pace', 'easy', 'recovery', 'long'],
  };

  const pattern = patterns[Math.min(availableDays, 7)] || patterns[4];
  return pattern.slice(0, slotCount);
}

function groupSlotsByWeek(slots) {
  const byWeek = new Map();
  for (const slot of slots) {
    if (!byWeek.has(slot.weekNumber)) {
      byWeek.set(slot.weekNumber, []);
    }
    byWeek.get(slot.weekNumber).push(slot);
  }
  return [...byWeek.keys()].sort((a, b) => a - b).map((weekNumber) => byWeek.get(weekNumber));
}

function sortHydratedSlots(slots) {
  return [...slots].sort((a, b) => {
    if (a.date === b.date) return a.slotId.localeCompare(b.slotId);
    return a.date.localeCompare(b.date);
  });
}

function normalizeTimeString(value) {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(':').map((part) => part.trim());
  if (parts.length === 2) {
    const [mm, ss] = parts.map(Number);
    if ([mm, ss].some(Number.isNaN) || ss < 0 || ss >= 60 || mm < 0) return null;
    return `00:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = parts.map(Number);
    if ([hh, mm, ss].some(Number.isNaN) || mm < 0 || mm >= 60 || ss < 0 || ss >= 60 || hh < 0) {
      return null;
    }
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return null;
}

function normalizeOptionalTimeString(value) {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  if (!value.trim()) return null;
  return normalizeTimeString(value);
}

export function parseTimeToSeconds(value) {
  const normalized = normalizeTimeString(value);
  if (!normalized) {
    throw badRequest(`시간 형식이 잘못되었습니다: ${value}`);
  }
  const [hh, mm, ss] = normalized.split(':').map(Number);
  return hh * 3600 + mm * 60 + ss;
}

function formatPace(secondsPerKm) {
  const seconds = Math.max(1, Math.round(secondsPerKm));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, '0')}/km`;
}

function sanitizeText(value, maxLength) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}


function resolvePlannedNumber(modelValue, prescribedValue) {
  if (prescribedValue == null) {
    return modelValue ?? null;
  }
  return prescribedValue;
}

function toPositiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw badRequest(`${fieldName}는 0보다 큰 숫자여야 합니다.`);
  }
  return number;
}

function toInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw badRequest(`${fieldName}는 정수여야 합니다.`);
  }
  return number;
}

function assessRecentRun(profile, targetPacePerKmSeconds) {
  const run = profile.recentRun;
  const intensity = inferRecentRunIntensity(run.avgHeartRate, run.rpe);
  const intensityLabel = intensity === 'hard' ? '강함' : intensity === 'moderate' ? '보통' : '쉬움';

  let warning = null;
  let summary = '최근 러닝 정보가 없어서 PB와 목표 위주로 계획했습니다.';
  let recommendedEasyPaceSec = null;
  let recommendedSteadyPaceSec = null;

  if (profile.recentRunPaceSeconds != null) {
    const paceGapSec = profile.recentRunPaceSeconds - targetPacePerKmSeconds;

    if (intensity === 'easy') {
      recommendedEasyPaceSec = Math.max(targetPacePerKmSeconds + 50, profile.recentRunPaceSeconds);
      recommendedSteadyPaceSec = Math.max(targetPacePerKmSeconds + 20, profile.recentRunPaceSeconds - 5);
    } else if (intensity === 'moderate') {
      recommendedEasyPaceSec = Math.max(targetPacePerKmSeconds + 55, profile.recentRunPaceSeconds + 15);
      recommendedSteadyPaceSec = Math.max(targetPacePerKmSeconds + 25, profile.recentRunPaceSeconds + 5);
    } else {
      recommendedEasyPaceSec = Math.max(targetPacePerKmSeconds + 60, profile.recentRunPaceSeconds + 30);
      recommendedSteadyPaceSec = Math.max(targetPacePerKmSeconds + 30, profile.recentRunPaceSeconds + 12);
    }

    summary = `최근 러닝은 ${run.distanceKm ?? '?'}km · ${run.avgPace ?? '?'} · 강도 ${intensityLabel}로 해석했습니다.`;

    if (paceGapSec > 35 && intensity !== 'easy') {
      warning = '최근 러닝의 평균 페이스와 강도를 보면 목표 페이스가 다소 공격적으로 보일 수 있어 초반 강도를 낮추는 편이 좋습니다.';
    } else if (paceGapSec > 50) {
      warning = '최근 러닝 페이스 기준으로는 목표 기록이 다소 높아 보여, 초반 2~4주는 보수적으로 적응하는 편이 좋습니다.';
    }
  } else if (run.distanceKm != null || run.avgHeartRate != null || run.rpe != null) {
    summary = `최근 러닝은 거리 ${run.distanceKm ?? '?'}km, 심박 ${run.avgHeartRate ?? '?'}bpm, RPE ${run.rpe ?? '?'}로 기록되어 강도 ${intensityLabel} 정도로 해석했습니다.`;
  }

  return {
    intensity,
    intensityLabel,
    warning,
    summary,
    recommendedEasyPaceSec,
    recommendedSteadyPaceSec,
  };
}

function inferRecentRunIntensity(avgHeartRate, rpe) {
  if ((rpe != null && rpe >= 8) || (avgHeartRate != null && avgHeartRate >= 170)) return 'hard';
  if ((rpe != null && rpe >= 6) || (avgHeartRate != null && avgHeartRate >= 155)) return 'moderate';
  return 'easy';
}

function normalizeOptionalDateString(value) {
  if (value == null) return null;
  const cleaned = String(value).trim();
  if (!cleaned) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) return null;
  return cleaned;
}

function normalizeOptionalPaceString(value) {
  if (value == null) return null;
  const cleaned = String(value).trim().replace('/km', '').replace(/\s+/g, '');
  if (!cleaned) return null;
  const parts = cleaned.split(':').map((part) => Number(part));
  if (parts.some(Number.isNaN)) return null;
  if (parts.length === 2) {
    const [mm, ss] = parts;
    if (mm < 0 || ss < 0 || ss >= 60) return null;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = parts;
    if (hh < 0 || mm < 0 || mm >= 60 || ss < 0 || ss >= 60) return null;
    return `${String(hh * 60 + mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  }
  return null;
}

function parsePaceToSeconds(value) {
  const normalized = normalizeOptionalPaceString(value);
  if (!normalized) {
    throw badRequest(`페이스 형식이 잘못되었습니다: ${value}`);
  }
  const [mm, ss] = normalized.split(':').map(Number);
  return mm * 60 + ss;
}

function toOptionalPositiveNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw badRequest('숫자 입력값은 0보다 커야 합니다.');
  }
  return number;
}

function toOptionalInteger(value, fieldName) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw badRequest(`${fieldName}는 정수여야 합니다.`);
  }
  return number;
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function parseLocalDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfTrainingWeek(date) {
  const local = startOfLocalDay(date);
  const day = local.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(local, offset);
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function diffDays(a, b) {
  const ms = startOfLocalDay(b).getTime() - startOfLocalDay(a).getTime();
  return Math.round(ms / 86400000);
}

function roundToHalf(value) {
  return Math.round(value * 2) / 2;
}

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}
