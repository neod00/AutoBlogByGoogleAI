import { GoogleGenAI } from "@google/genai";
import { redis, isAuthenticated } from '../_lib/redis.js';

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
const REDIS_KEY = 'admin:discovered_keywords';

interface DiscoveredKeyword {
  id: string;
  seed: string;           // 원본 시드 키워드
  mainKeyword: string;    // 발굴된 메인 키워드
  subKeywords: string[];  // 서브 키워드 3개
  suggestedTitle: string; // AI가 추천하는 블로그 제목 (H1)
  hookSummary: string;    // 독자 유인 한 줄 훅
  searchIntent: string;   // 검색 의도 (정보탐색, 비교분석, 방법론 등)
  difficulty: 'low' | 'medium' | 'high'; // SEO 경쟁도 예측
  template: string;       // 추천 템플릿
  reasoning: string;      // 왜 이 키워드가 좋은지 한 줄 설명
  status: 'discovered' | 'approved' | 'dismissed'; // 상태
  discoveredAt: string;
}

// 무료 API Rate Limit 방어: 시드별 순차 호출 + 딜레이
const MAX_SEEDS_PER_RUN = 5;       // 한 번 실행 시 최대 시드 수 (Vercel 60초 타임아웃 방어)
const DELAY_BETWEEN_CALLS_MS = 3000; // 호출 간 대기 시간 (무료 티어 15 RPM 방어)

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 단일 시드로 키워드 2개 발굴
async function discoverForSingleSeed(ai: any, seed: string): Promise<DiscoveredKeyword[]> {
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  // [Step 1] 팩트 체커 (구글 검색 전용)
  const factPrompt = \`명심해라. 오늘은 \${today} 이다. 너의 과거 기억은 틀렸을 확률이 높다.
임무: 당신은 팩트체크 전문 AI입니다. 제공된 주제 "\${seed}"에 대해 구글 검색 툴을 사용하여 가장 최신의 검증된 사실(현재 시점 기준)만 조사하십시오.

검색 및 요약 기준:
1. 이 주제와 관련해 최근 6~12개월 사이에 새롭게 바뀐 사실, 최신 발표, 일정 변경, 최신 트렌드, 또는 대중의 주요 이슈가 있는지 검색하세요.
2. 당신의 과거 학습 데이터(기억)에 의존하지 마십시오. 오직 검색 결과에서 확인된 내용만 요약해야 합니다.
3. 분야에 상관없이 최신 핵심 정보 3~5가지를 한글 불릿 포인트(Bullet point)로 요약하세요.
4. 검색 결과가 명확하지 않거나 최신 정보가 없다면, "최신 변동 사항 없음"이라고 솔직하게 명시하세요.\`;

  console.log(\`  → [Step 1] Fact checking "\${seed}"...\`);
  const factResponse = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: factPrompt,
    config: { tools: [{ googleSearch: {} }] },
  });
  
  const factText = factResponse.text || "최신 정보 없음";

  // [Step 2] SEO 기획자 (JSON 포맷팅 전용)
  const generatePrompt = \`오늘은 \${today} 입니다. 당신은 30년 경력의 베테랑 SEO 전략가입니다.
아래 제공된 [최신 팩트체크 결과]만을 절대적인 진리로 삼아, "\${seed}" 주제의 SEO 최적화 블로그 키워드 기회를 딱 2개 발굴하세요. 절대 너의 과거 기억(환각)을 섞어 쓰지 마세요.

[최신 팩트체크 결과]
\${factText}

발굴 기준:
1. 위 팩트체크 결과를 철저히 반영하여 현재 시점에 가장 유효한 키워드와 정보를 뽑을 것.
2. 경쟁도가 낮고 구체적인 롱테일 정보탐색형(Information-seeking) 키워드일 것.
3. 체류시간(Dwell time)이 높을 수 있는 구체적이고 실용적인 가이드, 분석, 비교 형식을 띌 것.

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "seed": "\${seed}",
    "mainKeyword": "SEO-optimized main keyword in Korean (long-tail, 10+ chars)",
    "subKeywords": ["sub keyword 1", "sub keyword 2", "sub keyword 3"],
    "suggestedTitle": "Click-worthy blog title in Korean matching the verified facts",
    "hookSummary": "One-sentence hook that makes the reader NEED to click (Korean)",
    "searchIntent": "one of: 정보탐색, 비교분석, 방법가이드, 트렌드분석, 심층해설",
    "difficulty": "one of: low, medium, high",
    "template": "one of: default, review, interview, qa, investment",
    "reasoning": "One sentence explaining WHY this keyword is good based strictly on the facts (Korean)"
  }
]

IMPORTANT:
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- All text content must be in Korean.
- suggestedTitle must be compelling and FACTUAL based on the facts provided.\`;

  console.log(\`  → [Step 2] Generating JSON for "\${seed}"...\`);
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: generatePrompt,
  });

  const text = response.text || "";

  try {
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanText);

    return parsed.map((item: any) => ({
      id: `kw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      seed: item.seed || seed,
      mainKeyword: item.mainKeyword || '',
      subKeywords: item.subKeywords || [],
      suggestedTitle: item.suggestedTitle || '',
      hookSummary: item.hookSummary || '',
      searchIntent: item.searchIntent || '정보탐색',
      difficulty: item.difficulty || 'medium',
      template: item.template || 'default',
      reasoning: item.reasoning || '',
      status: 'discovered' as const,
      discoveredAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.error(`Failed to parse response for seed "${seed}":`, e);
    console.error("Raw text:", text);
    return [];
  }
}

// 전체 시드 순차 처리 (Rate Limit 회피)
async function discoverKeywords(seeds: string[]): Promise<DiscoveredKeyword[]> {
  if (!API_KEY) throw new Error("API_KEY not set");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // 시드가 너무 많으면 랜덤으로 최대 N개만 선택 (Vercel 타임아웃 방어)
  let selectedSeeds = seeds;
  if (seeds.length > MAX_SEEDS_PER_RUN) {
    const shuffled = [...seeds].sort(() => Math.random() - 0.5);
    selectedSeeds = shuffled.slice(0, MAX_SEEDS_PER_RUN);
    console.log(`Too many seeds (${seeds.length}). Selected ${MAX_SEEDS_PER_RUN}: ${selectedSeeds.join(', ')}`);
  }

  const allKeywords: DiscoveredKeyword[] = [];

  for (let i = 0; i < selectedSeeds.length; i++) {
    const seed = selectedSeeds[i];
    console.log(`[${i + 1}/${selectedSeeds.length}] Discovering keywords for: "${seed}"`);

    try {
      const keywords = await discoverForSingleSeed(ai, seed);
      allKeywords.push(...keywords);
      console.log(`  → Found ${keywords.length} keywords for "${seed}"`);
    } catch (e: any) {
      console.error(`  → ERROR for seed "${seed}":`, e.message);
      // 개별 시드 실패 시 다음 시드로 계속 진행 (전체 실패 방지)
    }

    // 마지막 시드가 아니면 딜레이 적용 (Rate Limit 방어)
    if (i < selectedSeeds.length - 1) {
      console.log(`  → Waiting ${DELAY_BETWEEN_CALLS_MS}ms before next call...`);
      await delay(DELAY_BETWEEN_CALLS_MS);
    }
  }

  return allKeywords;
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // GET: 캐시된 발굴 키워드 조회
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const keywords = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      return res.status(200).json({ keywords });
    }

    // POST: 새로 발굴 실행
    if (req.method === 'POST') {
      // 설정에서 시드 키워드 가져오기
      const settings = await redis.get<any>('admin:settings') || {};
      const dailyTopic = req.body?.seeds || settings.dailyTopic || 'AI Trends';
      const seeds = dailyTopic.split(',').map((s: string) => s.trim()).filter((s: string) => s);

      if (seeds.length === 0) {
        return res.status(400).json({ error: 'No seed keywords configured. Update dailyTopic in settings.' });
      }

      const newKeywords = await discoverKeywords(seeds);

      // 기존 키워드와 병합 (최근 것이 위로, 최대 30개 보관)
      const existing = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      const merged = [...newKeywords, ...existing].slice(0, 30);
      await redis.set(REDIS_KEY, merged);

      return res.status(200).json({ keywords: merged, newCount: newKeywords.length });
    }

    // PUT: 키워드 상태 변경 (approved/dismissed)
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

    // DELETE: 키워드 삭제
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
