import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import {
  buildFallbackPlan,
  buildPlanningContext,
  generatePlanWithOpenAI,
  materializePlanState,
  normalizeProfile,
} from './planner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    gptConnected: Boolean(openaiClient),
    authConfigured: Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY),
    model: MODEL,
  });
});

app.get('/api/public-config', (_req, res) => {
  res.json({
    ok: true,
    authConfigured: Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY),
    supabaseUrl: SUPABASE_URL || null,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY || null,
  });
});

app.post('/api/generate-plan', async (req, res) => {
  try {
    const profile = normalizeProfile(req.body);
    const context = buildPlanningContext(profile);

    let plan;

    if (openaiClient) {
      try {
        plan = await generatePlanWithOpenAI({
          client: openaiClient,
          model: MODEL,
          profile,
          context,
        });
      } catch (openaiError) {
        console.error('OpenAI plan generation failed:', openaiError);
        plan = buildFallbackPlan(profile, context, 'GPT 생성에 실패해 로컬 규칙 기반 계획으로 대체했습니다.');
      }
    } else {
      plan = buildFallbackPlan(profile, context, 'OPENAI_API_KEY가 없어 로컬 규칙 기반 계획으로 생성했습니다.');
    }

    const appState = materializePlanState(profile, context, plan);

    res.json({
      ok: true,
      gptConnected: Boolean(openaiClient),
      authConfigured: Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY),
      appState,
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      ok: false,
      error: error.message || '알 수 없는 오류가 발생했습니다.',
    });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Running Planner server is listening on http://localhost:${PORT}`);
  console.log(`OpenAI connected: ${Boolean(openaiClient)} | model: ${MODEL}`);
  console.log(`Supabase auth configured: ${Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)}`);
});
