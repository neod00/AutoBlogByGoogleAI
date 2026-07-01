import { GoogleGenAI } from "@google/genai";
import { isAuthenticated } from '../_lib/redis.js';
import { CLIMATE_INSIGHT_DEFAULT_SEEDS } from '../_lib/climateSeeds.js';
import { getGeminiErrorStatusCode, getPublicGeminiErrorMessage } from '../_lib/geminiErrors.js';

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

const CLIMATE_INSIGHT_CATEGORIES = [
  '기후정책과 제도',
  '탄소중립과 배출권',
  'ESG 공시와 공급망 실사',
  '재생에너지와 전력시장',
  '기후금융과 녹색투자',
  '수출기업 탄소규제',
  '중소기업 지원사업',
  '기후기술과 산업 전환',
];

function parseRecommendations(text: string): any[] {
  const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleanText);
  if (!Array.isArray(parsed)) {
    throw new Error('Gemini response is not a JSON array');
  }
  return parsed
    .filter(item => item && typeof item.keyword === 'string')
    .slice(0, 10);
}

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!API_KEY) {
    return res.status(500).json({ error: 'API_KEY not set' });
  }

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const currentSeeds = req.body?.currentSeeds || CLIMATE_INSIGHT_DEFAULT_SEEDS.join(', ');

    const prompt = `오늘은 ${today}입니다.
당신은 기후인사이트 블로그의 SEO 편집장입니다.

블로그 정체성:
- 한국 독자에게 기후정책, ESG 공시, 탄소중립, 에너지 비용, 수출 탄소규제, 기업 실무 대응을 쉽게 설명합니다.
- 단순 화제성, 연예/생활 잡담, 정치 공방, 공포 마케팅, 블로그 주제와 무관한 트래픽성 키워드는 제외합니다.

핵심 카테고리:
${CLIMATE_INSIGHT_CATEGORIES.map((category, index) => `${index + 1}. ${category}`).join('\n')}

현재 설정된 시드 키워드:
${currentSeeds}

기본 시드 풀 참고:
${CLIMATE_INSIGHT_DEFAULT_SEEDS.join(', ')}

임무:
Google Search 결과를 바탕으로 지금 기후인사이트에 추가하면 좋은 SEO 시드 키워드 8~10개를 추천하세요.

추천 기준:
1. 최근 6~12개월 안에 검색 수요나 정책/산업 변화가 확인되는 주제
2. 향후 여러 개의 롱테일 글감으로 확장 가능한 2~5단어 시드
3. 기존 시드와 완전히 중복되지 않는 주제
4. 기업 실무자, 수출기업, 중소기업, ESG 담당자, 에너지 비용에 관심 있는 독자가 검색할 만한 표현
5. 기후인사이트의 신뢰도를 해칠 수 있는 자극적 표현은 제외

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "keyword": "추천 시드 키워드",
    "category": "해당 카테고리",
    "reason": "왜 지금 좋은 시드인지 한 문장 설명",
    "trend": "one of: 급상승, 꾸준히높음, 계절성"
  }
]

IMPORTANT:
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- 모든 내용은 한국어로 작성합니다.
- "기타", "일상", "잡담", "화제성 뉴스" 성격의 추천은 만들지 않습니다.
- 검색 결과에서 근거가 약한 키워드는 추천하지 않습니다.`;

    console.log('[recommend-seeds] Calling Gemini with Google Search...');
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });

    const recommendations = parseRecommendations(response.text || "");
    return res.status(200).json({ recommendations });
  } catch (error: any) {
    console.error('[recommend-seeds] Error:', error.message);
    return res.status(getGeminiErrorStatusCode(error)).json({ error: getPublicGeminiErrorMessage(error) });
  }
}
