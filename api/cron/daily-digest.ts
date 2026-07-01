import { GoogleGenAI } from "@google/genai";
import nodemailer from 'nodemailer';
import { redis } from '../_lib/redis.js';
import { CLIMATE_INSIGHT_DEFAULT_SEEDS, DEFAULT_DAILY_TOPIC, parseSeedList, selectSeedsForRun } from '../_lib/climateSeeds.js';
import {
  getGeminiErrorStatusCode,
  getPublicGeminiErrorMessage,
  isGeminiUsageLimitError,
  isRetryableGeminiError,
} from '../_lib/geminiErrors.js';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

interface DiscoveredKeyword {
  id: string;
  seed: string;
  mainKeyword: string;
  subKeywords: string[];
  suggestedTitle: string;
  hookSummary: string;
  searchIntent: string;
  difficulty: 'low' | 'medium' | 'high';
  template: string;
  reasoning: string;
  status: 'discovered' | 'approved' | 'dismissed';
  discoveredAt: string;
}

interface SeedRefreshResult {
  dailyTopic: string;
  refreshed: boolean;
  reason: string;
  seeds: string[];
  estimatedGeminiCalls: number;
}

const MAX_SEEDS_PER_RUN = Number(process.env.KEYWORD_MAX_SEEDS_PER_RUN || 2);
const MAX_KEYWORDS_TO_QUEUE_PER_RUN = Number(process.env.KEYWORD_MAX_QUEUE_ADD || 3);
const MIN_PENDING_TOPICS_BEFORE_DISCOVERY = Number(process.env.KEYWORD_MIN_PENDING_TOPICS || 4);
const AUTO_REFRESH_SEEDS = process.env.KEYWORD_AUTO_REFRESH_SEEDS !== 'false';
const SEED_REFRESH_INTERVAL_DAYS = Number(process.env.KEYWORD_SEED_REFRESH_INTERVAL_DAYS || 7);
const AUTO_REFRESH_SEED_COUNT = Number(process.env.KEYWORD_AUTO_REFRESH_SEED_COUNT || 8);
const SEED_REFRESH_REDIS_KEY = 'admin:last_seed_refresh_at';
const DELAY_BETWEEN_CALLS_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendEmail(fromUser: string, to: string, subject: string, html: string) {
  const mailOptions = { from: fromUser, to, subject, html };
  const info = await transporter.sendMail(mailOptions);
  console.log('Email sent: ' + info.response);
  return info;
}

async function generateContentWithRetry(ai: any, params: any, maxRetries = 2) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await ai.models.generateContent(params);
    } catch (e: any) {
      attempt++;
      const isRetryable = isRetryableGeminiError(e);
      if (attempt > maxRetries || !isRetryable) {
        throw e;
      }
      const waitTime = Math.pow(2, attempt) * 2000;
      console.warn(`[daily-digest] Gemini retry in ${waitTime}ms. Attempt ${attempt}/${maxRetries}`);
      await delay(waitTime);
    }
  }
}

function parseJsonArray(text: string): any[] {
  const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleanText);
  if (!Array.isArray(parsed)) {
    throw new Error('Gemini response is not a JSON array');
  }
  return parsed;
}

function uniqueSeedList(seeds: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const seed of seeds) {
    const trimmed = String(seed || '').trim();
    const key = trimmed.replace(/\s+/g, '').toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

async function refreshSeedTopicIfDue(currentDailyTopic: string, settings: any): Promise<SeedRefreshResult> {
  const fallbackSeeds = parseSeedList(currentDailyTopic);
  const fallbackTopic = fallbackSeeds.length > 0 ? fallbackSeeds.join(', ') : DEFAULT_DAILY_TOPIC;

  if (!AUTO_REFRESH_SEEDS) {
    return {
      dailyTopic: fallbackTopic,
      refreshed: false,
      reason: 'Auto seed refresh disabled.',
      seeds: fallbackSeeds,
      estimatedGeminiCalls: 0,
    };
  }

  if (!API_KEY) {
    return {
      dailyTopic: fallbackTopic,
      refreshed: false,
      reason: 'API key not configured.',
      seeds: fallbackSeeds,
      estimatedGeminiCalls: 0,
    };
  }

  const now = new Date();
  const lastRefresh = await redis.get<string>(SEED_REFRESH_REDIS_KEY);
  if (lastRefresh) {
    const elapsedDays = (now.getTime() - new Date(lastRefresh).getTime()) / 86_400_000;
    if (elapsedDays < SEED_REFRESH_INTERVAL_DAYS) {
      return {
        dailyTopic: fallbackTopic,
        refreshed: false,
        reason: `Next refresh in ${(SEED_REFRESH_INTERVAL_DAYS - elapsedDays).toFixed(1)} days.`,
        seeds: fallbackSeeds,
        estimatedGeminiCalls: 0,
      };
    }
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const today = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
  const currentSeeds = fallbackSeeds.length > 0 ? fallbackSeeds : CLIMATE_INSIGHT_DEFAULT_SEEDS;

  const prompt = `오늘은 ${today}입니다.
당신은 기후인사이트 블로그의 SEO 편집장입니다.

현재 SEO 시드 키워드:
${currentSeeds.join(', ')}

기본 시드 풀:
${CLIMATE_INSIGHT_DEFAULT_SEEDS.join(', ')}

임무:
Google Search 결과를 근거로 앞으로 1주일 동안 기후인사이트 자동 발행에 사용할 SEO 시드 키워드 ${AUTO_REFRESH_SEED_COUNT}개를 추천하세요.

추천 기준:
1. 기후정책, ESG 공시, 탄소중립, 에너지 비용, 수출 탄소규제, 지원사업, 기업 실무 대응과 직접 관련되어야 합니다.
2. 최근 6~12개월 안에 실제 검색 수요나 정책/산업 변화가 확인되어야 합니다.
3. 너무 넓은 단어보다 2~5단어의 시드 키워드를 추천합니다.
4. 기존 시드와 완전히 같은 표현은 피하되, 성격이 맞는 핵심 주제는 더 구체적으로 갱신해도 됩니다.
5. 연예, 일상, 정치 공방, 공포 마케팅, 블로그 주제와 무관한 트래픽성 키워드는 제외합니다.

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "keyword": "추천 시드 키워드",
    "reason": "추천 이유 한 문장"
  }
]

IMPORTANT:
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- 모든 내용은 한국어로 작성합니다.`;

  try {
    console.log('[daily-digest] Refreshing SEO seed topic list...');
    const response = await generateContentWithRetry(ai, {
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    }, 1);

    const parsed = parseJsonArray(response.text || '');
    const refreshedSeeds = uniqueSeedList(
      parsed
        .map((item: any) => item?.keyword)
        .filter((seed: any) => typeof seed === 'string')
    ).slice(0, AUTO_REFRESH_SEED_COUNT);

    if (refreshedSeeds.length < Math.min(4, AUTO_REFRESH_SEED_COUNT)) {
      return {
        dailyTopic: fallbackTopic,
        refreshed: false,
        reason: 'Gemini returned too few usable seeds.',
        seeds: fallbackSeeds,
        estimatedGeminiCalls: 1,
      };
    }

    const refreshedTopic = refreshedSeeds.join(', ');
    await redis.set('admin:settings', { ...(settings || {}), dailyTopic: refreshedTopic });
    await redis.set(SEED_REFRESH_REDIS_KEY, now.toISOString());

    return {
      dailyTopic: refreshedTopic,
      refreshed: true,
      reason: 'Seed topic list refreshed.',
      seeds: refreshedSeeds,
      estimatedGeminiCalls: 1,
    };
  } catch (error: any) {
    console.error('[daily-digest] Seed refresh failed:', error.message);
    if (isGeminiUsageLimitError(error)) {
      throw error;
    }

    return {
      dailyTopic: fallbackTopic,
      refreshed: false,
      reason: `Seed refresh failed: ${getPublicGeminiErrorMessage(error)}`,
      seeds: fallbackSeeds,
      estimatedGeminiCalls: 1,
    };
  }
}

async function discoverForSingleSeed(ai: any, seed: string): Promise<DiscoveredKeyword[]> {
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const factPrompt = `오늘은 ${today}입니다.
당신은 기후, ESG, 에너지 정책 분야의 팩트체크 전문 AI입니다.

주제: "${seed}"

Google Search 결과를 사용해 최근 6~12개월 사이 실제로 확인되는 변화, 정책 발표, 규제 일정, 기업 대응, 지원사업, 시장 데이터를 조사하세요.

조사 기준:
1. 공식 기관, 정부, 국제기구, 기업 공시, 신뢰할 수 있는 언론/전문기관 자료를 우선합니다.
2. 과거 학습 기억에 의존하지 말고 검색 결과에서 확인되는 내용만 요약합니다.
3. 기후인사이트 독자가 실무적으로 활용할 만한 쟁점 3~5개를 bullet point로 정리합니다.
4. 최신 변화가 명확하지 않으면 "최신 변화 없음"이라고 명시합니다.`;

  console.log(`  [Step 1] Fact checking "${seed}"...`);
  const factResponse = await generateContentWithRetry(ai, {
    model: 'gemini-2.5-flash',
    contents: factPrompt,
    config: { tools: [{ googleSearch: {} }] },
  });

  const factText = factResponse.text || "최신 정보 없음";

  const generatePrompt = `오늘은 ${today}입니다.
당신은 100만 구독자를 보유한 기후/ESG 전문 블로거이자 SEO 전략가입니다.
아래 [최신 팩트체크 결과]만을 근거로 "${seed}" 주제의 블로그 발행 후보 키워드 2개를 발굴하세요.

[최신 팩트체크 결과]
${factText}

발굴 기준:
1. 기후인사이트 독자에게 맞는 기후정책, ESG 공시, 탄소중립, 에너지 비용, 기업 실무, 수출규제, 지원사업 중심 키워드여야 합니다.
2. 검색 의도는 명확해야 하며, 막연한 트렌드어보다 "대상", "확인 방법", "비교", "체크리스트", "지원금", "일정"이 붙는 롱테일 키워드를 우선합니다.
3. 제목은 클릭을 유도하되 과장, 공포 조장, 근거 없는 단정 표현을 피합니다.
4. 제목은 34~58자 내외를 목표로 하고, 검색어를 앞부분에 자연스럽게 배치합니다.

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "seed": "${seed}",
    "mainKeyword": "SEO 최적화 한국어 롱테일 키워드",
    "subKeywords": ["보조 키워드 1", "보조 키워드 2", "보조 키워드 3"],
    "suggestedTitle": "검증된 사실에 근거한 클릭 유도형 한국어 제목",
    "hookSummary": "독자가 클릭해야 할 이유를 담은 한 문장",
    "searchIntent": "one of: 정보탐색, 비교분석, 방법가이드, 트렌드분석, 사례해설",
    "difficulty": "one of: low, medium, high",
    "template": "one of: default, review, interview, qa, investment",
    "reasoning": "이 키워드가 좋은 이유를 사실 기반으로 한 문장 설명"
  }
]

IMPORTANT:
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- 모든 텍스트는 한국어로 작성합니다.
- 최신성이 필요한 글에만 연도를 넣고, evergreen 가이드에는 불필요한 연도를 넣지 않습니다.`;

  console.log(`  [Step 2] Generating JSON for "${seed}"...`);
  const response = await generateContentWithRetry(ai, {
    model: 'gemini-2.5-flash',
    contents: generatePrompt,
  });

  try {
    const parsed = parseJsonArray(response.text || "");
    return parsed.map((item: any) => {
      const difficulty = ['low', 'medium', 'high'].includes(item.difficulty) ? item.difficulty : 'medium';
      return {
        id: `kw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        seed: item.seed || seed,
        mainKeyword: item.mainKeyword || '',
        subKeywords: Array.isArray(item.subKeywords) ? item.subKeywords : [],
        suggestedTitle: item.suggestedTitle || '',
        hookSummary: item.hookSummary || '',
        searchIntent: item.searchIntent || '정보탐색',
        difficulty,
        template: item.template || 'default',
        reasoning: item.reasoning || '',
        status: 'discovered' as const,
        discoveredAt: new Date().toISOString(),
      };
    });
  } catch (e) {
    console.error(`Failed to parse response for seed "${seed}":`, e);
    console.error("Raw text:", response.text || "");
    return [];
  }
}

async function discoverSEOKeywords(seeds: string[]): Promise<DiscoveredKeyword[]> {
  if (!API_KEY) throw new Error("API_KEY not set");
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const selectedSeeds = seeds.slice(0, MAX_SEEDS_PER_RUN);
  const allKeywords: DiscoveredKeyword[] = [];

  for (let i = 0; i < selectedSeeds.length; i++) {
    const seed = selectedSeeds[i];
    console.log(`[daily-digest ${i + 1}/${selectedSeeds.length}] Discovering for: "${seed}"`);

    try {
      const keywords = await discoverForSingleSeed(ai, seed);
      allKeywords.push(...keywords);
      console.log(`  Found ${keywords.length} keywords`);
    } catch (e: any) {
      console.error(`  ERROR for seed "${seed}":`, e.message);
      if (isGeminiUsageLimitError(e)) {
        throw e;
      }
    }

    if (i < selectedSeeds.length - 1) {
      await delay(DELAY_BETWEEN_CALLS_MS);
    }
  }

  return allKeywords;
}

function normalizeForDuplicateCheck(text: string): string {
  return (text || '').replace(/\s+/g, '').toLowerCase();
}

function filterDuplicateKeywords(
  keywords: DiscoveredKeyword[],
  existingTopics: any[],
  existingKeywords: DiscoveredKeyword[]
): DiscoveredKeyword[] {
  const seen = new Set<string>();

  for (const topic of existingTopics) {
    seen.add(normalizeForDuplicateCheck(topic.title || ''));
    seen.add(normalizeForDuplicateCheck(topic.mainKeyword || ''));
  }

  for (const keyword of existingKeywords) {
    seen.add(normalizeForDuplicateCheck(keyword.suggestedTitle || ''));
    seen.add(normalizeForDuplicateCheck(keyword.mainKeyword || ''));
  }

  return keywords.filter(keyword => {
    const titleKey = normalizeForDuplicateCheck(keyword.suggestedTitle);
    const keywordKey = normalizeForDuplicateCheck(keyword.mainKeyword);
    if (!titleKey || seen.has(titleKey) || seen.has(keywordKey)) return false;
    seen.add(titleKey);
    seen.add(keywordKey);
    return true;
  });
}

function getDifficultyBadge(diff: string): string {
  switch (diff) {
    case 'low': return '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">경쟁 낮음</span>';
    case 'medium': return '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">중간</span>';
    case 'high': return '<span style="background:#fecaca;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">경쟁 높음</span>';
    default: return '';
  }
}

function getIntentBadge(intent: string): string {
  return `<span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${intent}</span>`;
}

function buildBaseUrl(req: any): string {
  let baseUrl = process.env.APP_URL;
  if (!baseUrl) {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers.host;
    baseUrl = `${protocol}://${host}`;
  }
  return baseUrl.replace(/\/$/, '');
}

function buildEmailHtml(keywords: DiscoveredKeyword[], seeds: string[], baseUrl: string, cronSecret: string): string {
  const keywordCards = keywords.map((kw) => {
    const previewLink = `${baseUrl}/?keyword=${encodeURIComponent(kw.mainKeyword)}&auto=true`;
    const publishLink = `${baseUrl}/api/trigger-publish?topic=${encodeURIComponent(kw.suggestedTitle)}&template=${kw.template}&secret=${cronSecret}`;

    return `
      <div style="margin-bottom:16px;padding:16px;background:#f8fafc;border-radius:12px;border:1px solid #e2e8f0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap;">
          <span style="background:#0ea5e9;color:white;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;">#${kw.seed}</span>
          ${getDifficultyBadge(kw.difficulty)}
          ${getIntentBadge(kw.searchIntent)}
        </div>
        <div style="font-size:17px;font-weight:700;color:#0f172a;margin-bottom:4px;line-height:1.4;">${kw.suggestedTitle}</div>
        <div style="font-size:13px;color:#64748b;margin-bottom:6px;"><strong>${kw.mainKeyword}</strong></div>
        <div style="font-size:13px;color:#475569;margin-bottom:8px;font-style:italic;">${kw.hookSummary}</div>
        <div style="font-size:12px;color:#94a3b8;margin-bottom:10px;">${kw.reasoning}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <a href="${previewLink}" style="display:inline-block;padding:6px 14px;background:#f1f5f9;color:#475569;border-radius:8px;text-decoration:none;font-size:13px;">미리보기</a>
          <a href="${publishLink}" style="display:inline-block;padding:6px 14px;background:linear-gradient(135deg,#06b6d4,#3b82f6);color:white;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;">즉시 발행</a>
        </div>
      </div>
    `;
  }).join('');

  return `
    <div style="font-family:'Apple SD Gothic Neo','Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;">
      <div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0c4a6e 100%);color:white;padding:28px;border-radius:16px 16px 0 0;">
        <h1 style="margin:0;font-size:24px;">기후인사이트 SEO 키워드 발굴 리포트</h1>
        <p style="margin:8px 0 0;color:#94a3b8;font-size:14px;">선택 시드: ${seeds.join(', ')} · ${new Date().toLocaleDateString('ko-KR')}</p>
        <p style="margin:4px 0 0;color:#67e8f9;font-size:13px;">발굴 후보 ${keywords.length}개 · 예상 Gemini 호출 ${seeds.length * 2}회</p>
      </div>
      <div style="padding:20px;background:white;border:1px solid #e2e8f0;border-top:none;">
        <p style="color:#64748b;margin-bottom:16px;font-size:14px;">
          아래 키워드는 기후인사이트 성격과 최신 검색 근거를 기준으로 발굴된 롱테일 후보입니다.
          바로 발행하거나 <a href="${baseUrl}/admin" style="color:#0ea5e9;">관리자 대시보드</a>에서 검토하세요.
        </p>
        ${keywordCards}
      </div>
      <div style="padding:16px;background:#f1f5f9;border-radius:0 0 16px 16px;border:1px solid #e2e8f0;border-top:none;text-align:center;">
        <a href="${baseUrl}/admin" style="display:inline-block;padding:10px 24px;background:#0f172a;color:white;border-radius:10px;text-decoration:none;font-size:14px;font-weight:600;">관리자에서 전체 관리하기</a>
      </div>
    </div>
  `;
}

export default async function handler(req: any, res: any) {
  const authHeader = req.headers.authorization;
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}` && req.query.key !== CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    let recipientEmail = process.env.GMAIL_USER || '';
    let dailyTopic = process.env.DAILY_TOPIC || DEFAULT_DAILY_TOPIC;
    let settings: any = {};

    try {
      const loadedSettings = await redis.get<any>('admin:settings');
      if (loadedSettings) {
        settings = loadedSettings;
        if (settings.recipientEmail) recipientEmail = settings.recipientEmail;
        if (settings.dailyTopic) dailyTopic = settings.dailyTopic;
      }
    } catch (e) {
      console.error('Redis Load Settings Error:', e);
    }

    const seedRefresh = await refreshSeedTopicIfDue(dailyTopic, settings);
    dailyTopic = seedRefresh.dailyTopic;
    console.log(`[daily-digest] Seed refresh: ${seedRefresh.refreshed ? 'refreshed' : 'skipped'} (${seedRefresh.reason})`);

    const topicsKey = 'admin:topics_queue';
    const existingTopics = await redis.get<any[]>(topicsKey) || [];
    const pendingTopics = existingTopics.filter(topic => topic.status === 'pending');

    if (pendingTopics.length >= MIN_PENDING_TOPICS_BEFORE_DISCOVERY) {
      console.log(`[daily-digest] Pending queue has ${pendingTopics.length} topics. Skipping Gemini discovery to control cost.`);
      return res.status(200).json({
        message: 'Skipped keyword discovery because pending queue is sufficiently stocked.',
        pendingCount: pendingTopics.length,
        minPendingBeforeDiscovery: MIN_PENDING_TOPICS_BEFORE_DISCOVERY,
        seedRefresh,
        estimatedGeminiCalls: seedRefresh.estimatedGeminiCalls,
      });
    }

    const configuredSeeds = parseSeedList(dailyTopic);
    const recentTopicTitles = existingTopics.slice(0, 20).map(topic => topic.title || '');
    const seeds = selectSeedsForRun(configuredSeeds, MAX_SEEDS_PER_RUN, recentTopicTitles);

    console.log(`[daily-digest] Selected seeds: ${seeds.join(', ')}`);
    const estimatedGeminiCalls = seedRefresh.estimatedGeminiCalls + seeds.length * 2;
    console.log(`[daily-digest] Cost guard: max ${MAX_SEEDS_PER_RUN} seeds, estimated Gemini calls ${estimatedGeminiCalls}`);

    const discoveredKeywords = await discoverSEOKeywords(seeds);

    if (discoveredKeywords.length === 0) {
      return res.status(200).json({
        message: 'No keywords discovered.',
        seedCount: seeds.length,
        seedRefresh,
        estimatedGeminiCalls,
      });
    }

    const existing = await redis.get<DiscoveredKeyword[]>('admin:discovered_keywords') || [];
    const keywords = filterDuplicateKeywords(discoveredKeywords, existingTopics, existing);

    if (keywords.length === 0) {
      return res.status(200).json({
        message: 'Keywords discovered but all were duplicates.',
        discoveredCount: discoveredKeywords.length,
        queuedCount: 0,
        seedRefresh,
        estimatedGeminiCalls,
      });
    }

    const merged = [...keywords, ...existing].slice(0, 30);
    await redis.set('admin:discovered_keywords', merged);

    const keywordsToQueue = keywords.slice(0, MAX_KEYWORDS_TO_QUEUE_PER_RUN);
    const newTopicItems = keywordsToQueue.map((kw) => ({
      id: `t_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      title: kw.suggestedTitle,
      template: kw.template,
      status: 'pending',
      createdAt: new Date().toISOString(),
      source: 'cron-seo-auto',
      mainKeyword: kw.mainKeyword,
    }));

    await redis.set(topicsKey, [...newTopicItems, ...existingTopics]);

    const baseUrl = buildBaseUrl(req);
    const html = buildEmailHtml(keywords, seeds, baseUrl, process.env.CRON_SECRET || '');

    if (recipientEmail && process.env.GMAIL_USER) {
      await sendEmail(
        process.env.GMAIL_USER,
        recipientEmail,
        `기후인사이트 SEO 키워드 리포트: ${seeds.join(', ')} (${new Date().toLocaleDateString('ko-KR')})`,
        html
      );
    } else {
      console.warn('[daily-digest] Email skipped because recipientEmail or GMAIL_USER is not configured.');
    }

    return res.status(200).json({
      message: recipientEmail && process.env.GMAIL_USER ? 'SEO keyword report sent' : 'SEO keywords discovered; email skipped',
      seedCount: seeds.length,
      keywordCount: keywords.length,
      queuedCount: keywordsToQueue.length,
      seedRefresh,
      estimatedGeminiCalls,
      keywords,
    });
  } catch (error: any) {
    console.error(error);
    return res.status(getGeminiErrorStatusCode(error)).json({
      error: getPublicGeminiErrorMessage(error),
    });
  }
}
