const RACE_DISTANCES_KM = {
  '5k': 5,
  '10k': 10,
  half: 21.0975,
  full: 42.195,
};

const RACE_LABELS = {
  '5k': '5K',
  '10k': '10K',
  half: '하프',
  full: '풀코스',
};

const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
const RECORD_KEYS = ['5k', '10k', 'half', 'full'];

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
    throw badRequest('롱런 선호 요일은 토요일(6) 또는 일요일(0)이어야 합니다.');
  }

  const today = startOfLocalDay(new Date());
  const raceDateObj = parseLocalDate(goalDate);
  if (Number.isNaN(raceDateObj.getTime())) {
    throw badRequest('목표 대회 날짜를 읽을 수 없습니다.');
  }
  if (diffDays(today, raceDateObj) < 7) {
    throw badRequest('대회 날짜는 오늘 기준 최소 7일 이후여야 합니다.');
  }

  const bestRecords = normalizeBestRecords(raw, today);
  const bestTimes = Object.fromEntries(RECORD_KEYS.map((key) => [key, bestRecords[key]?.time || null]));
  const recentRun = normalizeRecentRun(raw, today);

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
    bestRecords,
    bestTimes,
    bestTimeSeconds: Object.fromEntries(
      Object.entries(bestTimes).map(([key, value]) => [key, value ? parseTimeToSeconds(value) : null]),
    ),
    recentRun,
  };
}

export function buildPlanningContext(profile) {
  const tomorrow = addDays(startOfLocalDay(new Date()), 1);
  const raceDate = profile.raceDateObj;
  const availableWeekdays = resolveTrainingWeekdays(profile.availableDays, profile.longRunDay);
  const slots = [];
  const productWarnings = [];

  const daysUntilRace = diffDays(tomorrow, raceDate);
  const totalWeeks = Math.max(2, Math.ceil((daysUntilRace + 1) / 7));
  const targetPacePerKmSeconds = profile.goalTimeSeconds / profile.goalDistanceKm;

  const goalRealism = assessGoalRealism(profile);
  const recentRunAnalysis = assessRecentRun(profile, targetPacePerKmSeconds);

  if (profile.raceType === 'half' && profile.currentLongestRunKm < 8) {
    productWarnings.push('최근 최장 거리가 짧아서 초반 2~3주는 매우 보수적으로 시작하는 편이 좋습니다.');
  }
  if (profile.raceType === 'full' && profile.currentLongestRunKm < 14) {
    productWarnings.push('풀코스 목표 대비 최근 최장 거리가 짧아, 목표 완주/기록 달성 가능성을 보수적으로 판단해야 합니다.');
  }
  if (goalRealism.warning) {
    productWarnings.push(goalRealism.warning);
  }
  if (goalRealism.usesOldData) {
    productWarnings.push('입력한 PB 중 오래된 기록이 있어 최근 러닝과 최근 최장 거리를 더 크게 반영했습니다.');
  }
  if (recentRunAnalysis?.warning) {
    productWarnings.push(recentRunAnalysis.warning);
  }
  if (profile.recentRun && profile.recentRun.daysSince > 35) {
    productWarnings.push('가장 최근 러닝이 5주 이상 전이라 현재 컨디션 추정의 신뢰도가 낮습니다.');
  }

  for (let d = new Date(tomorrow); d < raceDate; d = addDays(d, 1)) {
    if (!availableWeekdays.includes(d.getDay())) continue;

    const weekNumber = Math.floor(diffDays(tomorrow, d) / 7) + 1;
    slots.push({
      slotId: `S${String(slots.length + 1).padStart(3, '0')}`,
      date: formatLocalDate(d),
      weekday: d.getDay(),
      dayLabel: DAY_LABELS[d.getDay()],
      weekNumber,
      phase: resolvePhase(weekNumber, totalWeeks, profile.raceType),
      isLongRunSlot: d.getDay() === profile.longRunDay,
      isRaceWeek: weekNumber === totalWeeks,
    });
  }

  slots.push({
    slotId: `S${String(slots.length + 1).padStart(3, '0')}`,
    date: profile.goalDate,
    weekday: raceDate.getDay(),
    dayLabel: DAY_LABELS[raceDate.getDay()],
    weekNumber: totalWeeks,
    phase: 'race',
    isLongRunSlot: false,
    isRaceWeek: true,
    isRaceDay: true,
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
    goalRealism,
    recentRunAnalysis,
    slots,
  };
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
      personalBests: profile.bestRecords,
      recentRun: profile.recentRun
        ? {
            date: profile.recentRun.date,
            distanceKm: profile.recentRun.distanceKm,
            averagePace: `${profile.recentRun.averagePace}/km`,
            averageHeartRateBpm: profile.recentRun.averageHeartRateBpm,
            rpe: profile.recentRun.rpe,
            analysis: context.recentRunAnalysis,
          }
        : null,
      goalRealism: context.goalRealism,
      productWarnings: context.productWarnings,
    },
    planningRules: {
      planStartDate: context.startDate,
      totalWeeks: context.totalWeeks,
      trainingWeekdays: context.availableWeekdayLabels,
      requiredSlotCount: context.slots.length,
      slots: context.slots,
      principles: [
        'Use the slotId exactly as provided and create exactly one session for every slot.',
        'Do not invent extra dates or omit dates.',
        'Most weekly volume should stay easy/recovery oriented.',
        'Have one main quality session per week for most weeks, not two for a beginner profile.',
        'Use a gradual long-run progression and lighter cutback or taper weeks when appropriate.',
        'Final slot is race day and should be the target race.',
        'If PB dates are old, trust the recent run more than the old PB.',
        'If the recent run looked strenuous relative to the goal pace, slow the early progression.',
        'Use short, practical Korean text that looks good inside a calendar/todo UI.',
      ],
    },
  };

  const response = await client.responses.create({
    model,
    temperature: 0.35,
    instructions: [
      'You are an experienced running coach building a calendar-friendly training plan.',
      'You are not a doctor. If the target looks aggressive, include warnings and reduce progression speed.',
      'Return only the structured JSON requested by the schema.',
      'Each slot must be actionable in a todo-list style UI, with concise titles and short success criteria.',
      'For easy/recovery runs, prioritize time-based prescriptions if exact distance is uncertain.',
      'For long runs, include distance when practical.',
      'Use the recency of PB dates to judge how representative they are.',
      'Consider the recent run date, distance, pace, heart rate, and RPE when choosing progression speed.',
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
  const maxLongRunByRace = {
    '10k': 14,
    half: 22,
    full: 30,
  };

  const bias = resolveFallbackBias(context);
  const weeklySlots = groupSlotsByWeek(context.slots);
  let longRunKm = Math.max(4, roundToHalf(profile.currentLongestRunKm + bias.longRunStartOffsetKm));
  const targetLongRunKm = Math.max(10, maxLongRunByRace[profile.raceType] + bias.maxLongRunOffsetKm);
  const coachNotes = [];
  const warnings = [...context.productWarnings];

  if (reason) {
    warnings.unshift(reason);
  }

  const hydratedSlots = [];

  for (const [weekIndex, weekSlots] of weeklySlots.entries()) {
    const weekNumber = weekIndex + 1;
    const phase = resolvePhase(weekNumber, context.totalWeeks, profile.raceType);
    const nonRaceSlots = weekSlots.filter((slot) => !slot.isRaceDay);
    const raceSlot = weekSlots.find((slot) => slot.isRaceDay);

    const ordered = [...nonRaceSlots].sort((a, b) => a.date.localeCompare(b.date));
    const pattern = getSessionPattern(profile.availableDays, ordered.length);

    const isCutbackWeek = weekNumber > 2 && weekNumber < context.totalWeeks - 1 && weekNumber % 4 === 0;

    if (phase === 'base' || phase === 'build' || phase === 'peak') {
      if (isCutbackWeek) {
        longRunKm = Math.max(6, longRunKm - 2);
      } else if (phase === 'base') {
        longRunKm = Math.min(targetLongRunKm, longRunKm + bias.baseLongRunStepKm);
      } else if (phase === 'build') {
        longRunKm = Math.min(targetLongRunKm, longRunKm + bias.buildLongRunStepKm);
      } else if (phase === 'peak') {
        longRunKm = Math.min(targetLongRunKm, longRunKm + bias.peakLongRunStepKm);
      }
    }

    if (phase === 'taper') {
      longRunKm = Math.max(8, longRunKm - (profile.raceType === 'full' ? 6 : 4));
    }

    for (let i = 0; i < ordered.length; i += 1) {
      const slot = ordered[i];
      const patternType = slot.isLongRunSlot ? 'long' : pattern[Math.min(i, pattern.length - 1)];
      hydratedSlots.push(
        createFallbackSession(slot, patternType, {
          goalPaceSec: context.targetPacePerKmSeconds,
          longRunKm,
          raceType: profile.raceType,
          easyPaceOffsetSec: bias.easyPaceOffsetSec,
          steadyPaceOffsetSec: bias.steadyPaceOffsetSec,
          qualityPaceOffsetSec: bias.qualityPaceOffsetSec,
        }),
      );
    }

    if (raceSlot) {
      hydratedSlots.push({
        ...raceSlot,
        sessionType: 'race',
        title: `${getRaceLabel(profile.raceType)} 대회`,
        description: `${profile.goalTime} 목표로 레이스에 참가합니다.`,
        durationMin: Math.round(profile.goalTimeSeconds / 60),
        distanceKm: roundToOne(profile.goalDistanceKm),
        targetPace: context.targetPacePerKm,
        intensity: 'race',
        successCriteria: '컨디션 확인 후 무리하지 않고 레이스를 완주/도전합니다.',
      });
    }

    coachNotes.push({
      weekNumber,
      note: fallbackCoachNote(phase, isCutbackWeek, profile.raceType, context, weekNumber),
    });
  }

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

function createFallbackSession(slot, type, ctx) {
  const easyPace = formatPace(ctx.goalPaceSec + ctx.easyPaceOffsetSec);
  const steadyPace = formatPace(ctx.goalPaceSec + ctx.steadyPaceOffsetSec);
  const goalPace = formatPace(ctx.goalPaceSec);

  const base = {
    ...slot,
    targetPace: null,
    distanceKm: null,
    durationMin: null,
  };

  switch (type) {
    case 'easy':
      return {
        ...base,
        sessionType: 'easy',
        title: '이지런',
        description: '편안한 대화 가능한 강도로 달립니다.',
        durationMin: slot.isRaceWeek ? 35 : 45,
        targetPace: easyPace,
        intensity: 'easy',
        successCriteria: '호흡을 안정적으로 유지하고 끝나고 여유가 남는 느낌이면 성공.',
      };
    case 'recovery':
      return {
        ...base,
        sessionType: 'recovery',
        title: '회복 조깅',
        description: '가볍게 몸만 푸는 회복 러닝입니다.',
        durationMin: 30,
        targetPace: formatPace(ctx.goalPaceSec + ctx.easyPaceOffsetSec + 15),
        intensity: 'easy',
        successCriteria: '피로를 더 쌓지 않고 가볍게 마무리하면 성공.',
      };
    case 'tempo':
      return {
        ...base,
        sessionType: 'tempo',
        title: '템포런',
        description: '워밍업 후 안정적인 템포 구간을 넣습니다.',
        durationMin: slot.isRaceWeek ? 35 : 50,
        targetPace: steadyPace,
        intensity: 'moderate',
        successCriteria: '폼을 유지한 채 리듬 있게 마무리하면 성공.',
      };
    case 'interval':
      return {
        ...base,
        sessionType: 'interval',
        title: '인터벌',
        description: '짧은 반복주로 스피드 자극을 줍니다.',
        durationMin: 45,
        targetPace: formatPace(Math.max(ctx.goalPaceSec + ctx.qualityPaceOffsetSec, 180)),
        intensity: 'hard',
        successCriteria: '모든 반복을 무너지지 않는 자세로 소화하면 성공.',
      };
    case 'race-pace':
      return {
        ...base,
        sessionType: 'race-pace',
        title: '레이스 페이스 런',
        description: '목표 페이스 감각을 익히는 훈련입니다.',
        durationMin: 45,
        targetPace: goalPace,
        intensity: 'moderate',
        successCriteria: '목표 페이스를 과하게 힘들지 않게 유지하면 성공.',
      };
    case 'long':
      return {
        ...base,
        sessionType: 'long',
        title: '롱런',
        description: '편안한 강도로 오래 달리며 지구력을 쌓습니다.',
        durationMin: Math.round((ctx.longRunKm / 8.2) * 60),
        distanceKm: roundToHalf(ctx.longRunKm),
        targetPace: easyPace,
        intensity: 'moderate',
        successCriteria: '후반까지 무너지지 않고 일정한 리듬을 유지하면 성공.',
      };
    default:
      return {
        ...base,
        sessionType: 'easy',
        title: '가벼운 조깅',
        description: '무리하지 않는 편안한 러닝입니다.',
        durationMin: 35,
        targetPace: easyPace,
        intensity: 'easy',
        successCriteria: '컨디션을 살피며 편안하게 마치면 성공.',
      };
  }
}

function fallbackCoachNote(phase, isCutbackWeek, raceType, context, weekNumber) {
  if (weekNumber === 1 && context.recentRunAnalysis) {
    return `초반 주간은 최근 러닝 상태를 반영해 ${context.recentRunAnalysis.planBiasLabel} 시작합니다.`;
  }
  if (phase === 'base') {
    return '기본 지구력과 규칙적인 습관을 만드는 주간입니다. 너무 빠르게 달리지 마세요.';
  }
  if (phase === 'build') {
    return isCutbackWeek
      ? '이번 주는 컷백 성격으로 강도를 낮춰 회복을 우선합니다.'
      : '지구력과 페이스 감각을 함께 끌어올리는 주간입니다.';
  }
  if (phase === 'peak') {
    return raceType === 'full'
      ? '대회 특이 지구력 완성 단계입니다. 롱런 후 회복을 충분히 챙기세요.'
      : '대회 감각을 끌어올리는 주간입니다. 무리한 추가 훈련은 피하세요.';
  }
  if (phase === 'taper') {
    return '훈련량을 줄이며 컨디션을 끌어올리는 테이퍼 주간입니다.';
  }
  return '레이스 주간입니다. 수면, 수분, 컨디션 관리에 집중하세요.';
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

    hydratedSlots.push({
      ...slotLookup.get(item.slotId),
      sessionType: item.sessionType,
      title: sanitizeText(item.title, 40),
      description: sanitizeText(item.description, 200),
      durationMin: item.durationMin,
      distanceKm: item.distanceKm,
      targetPace: item.targetPace,
      intensity: item.intensity,
      successCriteria: sanitizeText(item.successCriteria, 120),
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
      planStyle: parsed.meta?.planStyle || 'balanced',
      cautionLevel: parsed.meta?.cautionLevel || 'moderate',
    },
    warnings: Array.isArray(parsed.warnings) ? parsed.warnings.slice(0, 8) : [],
    coachNotes: Array.isArray(parsed.coachNotes) ? parsed.coachNotes : [],
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
      bestRecords: profile.bestRecords,
      recentRun: profile.recentRun
        ? {
            date: profile.recentRun.date,
            distanceKm: profile.recentRun.distanceKm,
            averagePace: profile.recentRun.averagePace,
            averageHeartRateBpm: profile.recentRun.averageHeartRateBpm,
            rpe: profile.recentRun.rpe,
          }
        : null,
    },
    planMeta: {
      source: plan.meta.sourceLabel,
      generatedBy: plan.meta.generatedBy,
      modelName: plan.meta.modelName,
      planStyle: plan.meta.planStyle,
      cautionLevel: plan.meta.cautionLevel,
      totalWeeks: context.totalWeeks,
      targetPacePerKm: context.targetPacePerKm,
      trainingWeekdays: context.availableWeekdayLabels,
      planStartDate: context.startDate,
      raceDate: context.raceDate,
      createdAt: new Date().toISOString(),
      warnings: plan.warnings,
      coachNotes: plan.coachNotes,
      goalRealism: context.goalRealism,
      recentRunAnalysis: context.recentRunAnalysis,
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
    2: ['tempo', 'long'],
    3: ['easy', 'tempo', 'long'],
    4: ['easy', 'tempo', 'recovery', 'long'],
    5: ['easy', 'tempo', 'easy', 'race-pace', 'long'],
    6: ['easy', 'tempo', 'easy', 'interval', 'recovery', 'long'],
    7: ['easy', 'tempo', 'easy', 'interval', 'easy', 'recovery', 'long'],
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

function normalizeBestRecords(raw, today) {
  const source = raw.bestRecords && typeof raw.bestRecords === 'object' ? raw.bestRecords : {};
  const legacyDateMap = {
    '5k': raw.currentBest5kDate,
    '10k': raw.currentBest10kDate,
    half: raw.currentBestHalfDate,
    full: raw.currentBestFullDate,
  };
  const legacyTimeMap = {
    '5k': raw.currentBest5kTime,
    '10k': raw.currentBest10kTime,
    half: raw.currentBestHalfTime,
    full: raw.currentBestFullTime,
  };

  return Object.fromEntries(
    RECORD_KEYS.map((key) => {
      const time = normalizeOptionalTimeString(source[key]?.time ?? legacyTimeMap[key]);
      const date = time ? normalizeOptionalDateString(source[key]?.date ?? legacyDateMap[key], `${key} 기록 날짜`) : null;
      if (date && diffDays(parseLocalDate(date), today) < 0) {
        throw badRequest(`${getRaceLabel(key)} 기록 날짜는 미래일 수 없습니다.`);
      }
      return [key, { time, date, daysSince: date ? diffDays(parseLocalDate(date), today) : null }];
    }),
  );
}

function normalizeRecentRun(raw, today) {
  const source = raw.recentRun && typeof raw.recentRun === 'object' ? raw.recentRun : {};
  const rawDate = source.date ?? raw.recentRunDate;
  const rawDistance = source.distanceKm ?? raw.recentRunDistanceKm;
  const rawPace = source.averagePace ?? raw.recentRunAveragePace;
  const rawHeartRate = source.averageHeartRateBpm ?? raw.recentRunAverageHeartRateBpm;
  const rawRpe = source.rpe ?? raw.recentRunRpe;

  const hasAny = [rawDate, rawDistance, rawPace, rawHeartRate, rawRpe].some((value) => value !== '' && value != null);
  if (!hasAny) return null;

  const date = normalizeOptionalDateString(rawDate, '최근 러닝 날짜');
  const distanceKm = toOptionalPositiveNumber(rawDistance, '최근 러닝 거리');
  const averagePace = normalizeOptionalPaceString(rawPace);
  const averageHeartRateBpm = toOptionalIntegerInRange(rawHeartRate, '평균 심박수', 60, 220);
  const rpe = toOptionalIntegerInRange(rawRpe, '자각 강도 RPE', 1, 10);

  if (!date || !distanceKm || !averagePace) {
    throw badRequest('최근 러닝을 입력할 때는 날짜, 거리, 평균 페이스를 함께 입력해야 합니다.');
  }

  const dateObj = parseLocalDate(date);
  if (diffDays(dateObj, today) < 0) {
    throw badRequest('최근 러닝 날짜는 미래일 수 없습니다.');
  }

  return {
    date,
    dateObj,
    daysSince: diffDays(dateObj, today),
    distanceKm: roundToOne(distanceKm),
    averagePace: formatMmSs(parseTimeToSeconds(averagePace)),
    averagePaceSeconds: parseTimeToSeconds(averagePace),
    averageHeartRateBpm,
    rpe,
  };
}

function assessGoalRealism(profile) {
  const records = [];

  for (const key of RECORD_KEYS) {
    const record = profile.bestRecords[key];
    if (!record?.time) continue;
    const sourceDistance = RACE_DISTANCES_KM[key];
    const sourceSeconds = parseTimeToSeconds(record.time);
    const equivalentGoalTimeSeconds = sourceSeconds * (profile.goalDistanceKm / sourceDistance) ** 1.06;
    const freshnessWeight = recordFreshnessWeight(record.daysSince);
    records.push({
      key,
      date: record.date,
      daysSince: record.daysSince,
      sourceDistance,
      sourceSeconds,
      equivalentGoalTimeSeconds,
      freshnessWeight,
    });
  }

  if (!records.length) {
    return {
      status: 'unknown',
      label: '판단 보류',
      summary: '비교 가능한 PB가 부족해서 목표 현실성을 보수적으로만 판단했습니다.',
      warning: null,
      usesOldData: false,
      estimatedGoalTime: null,
    };
  }

  const weightSum = records.reduce((sum, item) => sum + item.freshnessWeight, 0);
  const estimatedGoalTimeSeconds = records.reduce((sum, item) => sum + item.equivalentGoalTimeSeconds * item.freshnessWeight, 0) / weightSum;
  const goalFasterRatio = (estimatedGoalTimeSeconds - profile.goalTimeSeconds) / estimatedGoalTimeSeconds;
  const usesOldData = records.some((item) => item.daysSince != null && item.daysSince > 365);

  let status = 'realistic';
  let label = '현실적';
  let warning = null;

  if (goalFasterRatio > 0.15) {
    status = 'very-aggressive';
    label = '매우 공격적';
    warning = '입력한 기록 기준으로는 목표가 매우 공격적이라 초반 강도와 롱런 증가폭을 보수적으로 잡는 편이 좋습니다.';
  } else if (goalFasterRatio > 0.08) {
    status = 'aggressive';
    label = '공격적';
    warning = '입력한 기록 기준으로는 목표가 다소 공격적이라 페이스 욕심보다 누적 훈련과 회복을 우선해야 합니다.';
  } else if (goalFasterRatio > 0.03) {
    status = 'challenging';
    label = '도전적';
  }

  return {
    status,
    label,
    summary: `입력한 PB 환산 기준 예상 기록은 약 ${formatDuration(estimatedGoalTimeSeconds)} 정도라 목표 ${profile.goalTime}은 ${label.toLowerCase()} 수준입니다.`,
    warning,
    usesOldData,
    estimatedGoalTime: formatDuration(estimatedGoalTimeSeconds),
  };
}

function assessRecentRun(profile, targetPacePerKmSeconds) {
  if (!profile.recentRun) return null;

  const run = profile.recentRun;
  const paceGapSec = run.averagePaceSeconds - targetPacePerKmSeconds;
  let effortScore = 0;

  if (paceGapSec <= 10) effortScore += 2;
  else if (paceGapSec <= 40) effortScore += 1;

  if (run.averageHeartRateBpm != null) {
    if (run.averageHeartRateBpm >= 170) effortScore += 2;
    else if (run.averageHeartRateBpm >= 158) effortScore += 1;
  }

  if (run.rpe != null) {
    if (run.rpe >= 8) effortScore += 2;
    else if (run.rpe >= 6) effortScore += 1;
  }

  if (run.distanceKm >= 12 && paceGapSec <= 40) effortScore += 1;

  let status = 'easy';
  let label = '가볍거나 보통 강도';
  if (effortScore >= 4) {
    status = 'hard';
    label = '최근 러닝 강도 높음';
  } else if (effortScore >= 2) {
    status = 'moderate';
    label = '최근 러닝 강도 보통';
  }

  let planBias = 'neutral';
  let planBiasLabel = '기본 강도로';
  let warning = null;
  if (status === 'hard' && paceGapSec > 35) {
    planBias = 'cautious';
    planBiasLabel = '보수적으로';
    warning = '최근 러닝이 목표 페이스보다 느린 편인데 심박/체감 강도 부담이 있어 초반 훈련 강도를 완만하게 잡았습니다.';
  } else if (status === 'moderate' && paceGapSec > 55) {
    planBias = 'steady';
    planBiasLabel = '약간 보수적으로';
  } else if (status === 'easy' && paceGapSec <= 30 && run.daysSince <= 14) {
    planBias = 'positive';
    planBiasLabel = '조금 자신 있게';
  }

  const hrPart = run.averageHeartRateBpm ? ` 평균 심박 ${run.averageHeartRateBpm}bpm` : '';
  const rpePart = run.rpe ? `, 자각 강도 ${run.rpe}/10` : '';
  const paceRelation = paceGapSec >= 0 ? `목표 페이스보다 ${Math.round(paceGapSec)}초/km 느렸습니다` : `목표 페이스보다 ${Math.abs(Math.round(paceGapSec))}초/km 빨랐습니다`;

  return {
    status,
    label,
    planBias,
    planBiasLabel,
    summary: `${run.date}에 ${run.distanceKm}km를 ${run.averagePace}/km로 달렸고${hrPart}${rpePart ? rpePart : ''}. 이 기록은 ${paceRelation}.`,
    warning,
    paceGapSeconds: Math.round(paceGapSec),
    heartRateBpm: run.averageHeartRateBpm,
  };
}

function resolveFallbackBias(context) {
  let easyPaceOffsetSec = 50;
  let steadyPaceOffsetSec = 20;
  let qualityPaceOffsetSec = -20;
  let longRunStartOffsetKm = 0;
  let maxLongRunOffsetKm = 0;
  let baseLongRunStepKm = 1;
  let buildLongRunStepKm = 1.5;
  let peakLongRunStepKm = 1;

  if (context.goalRealism?.status === 'aggressive') {
    easyPaceOffsetSec += 10;
    steadyPaceOffsetSec += 8;
    maxLongRunOffsetKm -= 1;
    buildLongRunStepKm = 1.25;
  }

  if (context.goalRealism?.status === 'very-aggressive') {
    easyPaceOffsetSec += 18;
    steadyPaceOffsetSec += 12;
    maxLongRunOffsetKm -= 2;
    baseLongRunStepKm = 0.75;
    buildLongRunStepKm = 1;
    peakLongRunStepKm = 0.75;
  }

  if (context.recentRunAnalysis?.planBias === 'cautious') {
    easyPaceOffsetSec += 15;
    steadyPaceOffsetSec += 10;
    longRunStartOffsetKm -= 1;
    maxLongRunOffsetKm -= 1;
    baseLongRunStepKm = Math.min(baseLongRunStepKm, 0.75);
    buildLongRunStepKm = Math.min(buildLongRunStepKm, 1.25);
  } else if (context.recentRunAnalysis?.planBias === 'steady') {
    easyPaceOffsetSec += 8;
    steadyPaceOffsetSec += 6;
  } else if (context.recentRunAnalysis?.planBias === 'positive') {
    easyPaceOffsetSec -= 5;
    steadyPaceOffsetSec -= 3;
  }

  return {
    easyPaceOffsetSec,
    steadyPaceOffsetSec,
    qualityPaceOffsetSec,
    longRunStartOffsetKm,
    maxLongRunOffsetKm,
    baseLongRunStepKm,
    buildLongRunStepKm,
    peakLongRunStepKm,
  };
}

function recordFreshnessWeight(daysSince) {
  if (daysSince == null) return 0.7;
  if (daysSince <= 180) return 1;
  if (daysSince <= 365) return 0.85;
  if (daysSince <= 730) return 0.6;
  return 0.35;
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

function normalizeOptionalPaceString(value) {
  if (value == null) return null;
  const raw = String(value).trim().replace('/km', '').trim();
  if (!raw) return null;
  const normalized = normalizeTimeString(raw);
  return normalized;
}

function normalizeOptionalDateString(value, fieldName) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw badRequest(`${fieldName} 형식이 올바르지 않습니다.`);
  }
  return raw;
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

function formatMmSs(seconds) {
  const total = Math.max(1, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const remainder = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function formatDuration(seconds) {
  const total = Math.max(1, Math.round(seconds));
  const hh = Math.floor(total / 3600);
  const mm = Math.floor((total % 3600) / 60);
  const ss = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function sanitizeText(value, maxLength) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function toPositiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw badRequest(`${fieldName}는 0보다 큰 숫자여야 합니다.`);
  }
  return number;
}

function toOptionalPositiveNumber(value, fieldName) {
  if (value == null || value === '') return null;
  return toPositiveNumber(value, fieldName);
}

function toInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw badRequest(`${fieldName}는 정수여야 합니다.`);
  }
  return number;
}

function toOptionalIntegerInRange(value, fieldName, min, max) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw badRequest(`${fieldName}는 ${min}~${max} 범위의 정수여야 합니다.`);
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
