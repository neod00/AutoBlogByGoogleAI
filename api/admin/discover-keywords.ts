import { GoogleGenAI } from "@google/genai";
import { redis, isAuthenticated } from '../_lib/redis.js';
import { DEFAULT_DAILY_TOPIC, parseSeedList, selectSeedsForRun } from '../_lib/climateSeeds.js';

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
const REDIS_KEY = 'admin:discovered_keywords';

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

const MAX_SEEDS_PER_RUN = Number(process.env.KEYWORD_MAX_SEEDS_PER_RUN || 2);
const DELAY_BETWEEN_CALLS_MS = 3000;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateContentWithRetry(ai: any, params: any, maxRetries = 3) {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      return await ai.models.generateContent(params);
    } catch (e: any) {
      attempt++;
      const isRetryable = e.message?.includes("429") || e.message?.includes("503") || e.message?.includes("UNAVAILABLE");
      if (attempt > maxRetries || !isRetryable) {
        throw e;
      }
      const waitTime = Math.pow(2, attempt) * 2000;
      console.warn(`[API Retry] Temporary issue (429/503). Retrying in ${waitTime}ms... (Attempt ${attempt}/${maxRetries})`);
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

async function discoverKeywords(seeds: string[]): Promise<DiscoveredKeyword[]> {
  if (!API_KEY) throw new Error("API_KEY not set");
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const selectedSeeds = seeds.slice(0, MAX_SEEDS_PER_RUN);
  const allKeywords: DiscoveredKeyword[] = [];

  for (let i = 0; i < selectedSeeds.length; i++) {
    const seed = selectedSeeds[i];
    console.log(`[${i + 1}/${selectedSeeds.length}] Discovering keywords for: "${seed}"`);

    try {
      const keywords = await discoverForSingleSeed(ai, seed);
      allKeywords.push(...keywords);
      console.log(`  Found ${keywords.length} keywords for "${seed}"`);
    } catch (e: any) {
      console.error(`  ERROR for seed "${seed}":`, e.message);
    }

    if (i < selectedSeeds.length - 1) {
      console.log(`  Waiting ${DELAY_BETWEEN_CALLS_MS}ms before next seed...`);
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

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const keywords = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      return res.status(200).json({ keywords });
    }

    if (req.method === 'POST') {
      const settings = await redis.get<any>('admin:settings') || {};
      const dailyTopic = req.body?.seeds || settings.dailyTopic || process.env.DAILY_TOPIC || DEFAULT_DAILY_TOPIC;
      const configuredSeeds = parseSeedList(dailyTopic);
      const existingTopics = await redis.get<any[]>('admin:topics_queue') || [];
      const recentTopicTitles = existingTopics.slice(0, 20).map(topic => topic.title || '');
      const seeds = selectSeedsForRun(configuredSeeds, MAX_SEEDS_PER_RUN, recentTopicTitles);

      if (seeds.length === 0) {
        return res.status(400).json({ error: 'No seed keywords configured. Update dailyTopic in settings.' });
      }

      const discoveredKeywords = await discoverKeywords(seeds);
      const existing = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      const newKeywords = filterDuplicateKeywords(discoveredKeywords, existingTopics, existing);
      const merged = [...newKeywords, ...existing].slice(0, 30);
      await redis.set(REDIS_KEY, merged);

      return res.status(200).json({
        keywords: merged,
        newCount: newKeywords.length,
        discoveredCount: discoveredKeywords.length,
        selectedSeeds: seeds,
        estimatedGeminiCalls: seeds.length * 2,
      });
    }

    if (req.method === 'PUT') {
      const { id, status } = req.body || {};
      if (!id || !status) return res.status(400).json({ error: 'id and status required' });

      const keywords = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      const index = keywords.findIndex(k => k.id === id);
      if (index === -1) return res.status(404).json({ error: 'Keyword not found' });

      keywords[index].status = status;
      await redis.set(REDIS_KEY, keywords);

      return res.status(200).json({ success: true, keyword: keywords[index] });
    }

    if (req.method === 'DELETE') {
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });

      const keywords = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      const filtered = keywords.filter(k => k.id !== id);
      await redis.set(REDIS_KEY, filtered);

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("Discover Keywords API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
