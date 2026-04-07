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

async function discoverKeywords(seeds: string[]): Promise<DiscoveredKeyword[]> {
  if (!API_KEY) throw new Error("API_KEY not set");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  const seedList = seeds.join(", ");
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  const prompt = `
You are a veteran SEO strategist with 30 years of blogging experience and 1M+ subscribers.
Today is ${today}.

TASK: Analyze trending topics related to these seed keywords: "${seedList}"
Find SEO-optimized blog keyword opportunities that meet ALL these criteria:
1. Currently trending or gaining interest in the last 24 hours
2. Information-seeking (정보탐색형) long-tail keywords, NOT celebrity gossip or weather
3. Low to medium competition — specific enough that major news outlets haven't covered thoroughly
4. Can be turned into a useful "guide", "analysis", or "comparison" blog post
5. Have potential for high dwell time (체류시간)

For each seed keyword, produce exactly 2 keyword sets.

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "seed": "the original seed keyword",
    "mainKeyword": "SEO-optimized main keyword in Korean (long-tail, 10+ chars)",
    "subKeywords": ["sub keyword 1", "sub keyword 2", "sub keyword 3"],
    "suggestedTitle": "Click-worthy blog title in Korean with numbers or specific value proposition",
    "hookSummary": "One-sentence hook that makes the reader NEED to click (Korean)",
    "searchIntent": "one of: 정보탐색, 비교분석, 방법가이드, 트렌드분석, 심층해설",
    "difficulty": "one of: low, medium, high",
    "template": "one of: default, review, interview, qa, investment",
    "reasoning": "One sentence explaining WHY this keyword is a good opportunity right now (Korean)"
  }
]

IMPORTANT:
- Output ONLY valid JSON array. No markdown, no explanation, no code fences.
- All text content must be in Korean.
- mainKeyword should be a natural search query (e.g. "엔비디아 실적 발표가 국내 AI 반도체주에 미치는 영향")
- suggestedTitle must be compelling (e.g. "2026년 엔비디아 실적 발표 핵심 요약 | 국내 투자자가 알아야 할 3가지")
- Avoid generic broad keywords. Be specific and actionable.
`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  const text = response.text || "";

  try {
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanText);

    return parsed.map((item: any) => ({
      id: `kw_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      seed: item.seed || '',
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
    console.error("Failed to parse keyword discovery response:", e);
    console.error("Raw text:", text);
    return [];
  }
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
