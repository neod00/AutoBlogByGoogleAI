import { GoogleGenAI } from "@google/genai";
import { isAuthenticated } from '../_lib/redis.js';

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

// 블로그 카테고리 목록 (generate-content.ts와 동기화)
const BLOG_CATEGORIES = [
  "ai 신기술 및 이슈",
  "기후변화 이슈",
  "정책과 제도",
  "기후금융",
  "국제협력",
  "과학과 기술",
  "탄소중립",
  "기타",
];

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
    const currentSeeds = req.body?.currentSeeds || '';

    const prompt = `오늘은 ${today} 입니다. 당신은 한국 최고의 SEO 전문가이자, 월 1000만원 수익을 내는 전문 블로거입니다.

아래는 내 블로그의 카테고리 목록입니다:
${BLOG_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${currentSeeds ? `현재 설정된 시드 키워드: ${currentSeeds}` : '현재 설정된 시드 키워드가 없습니다.'}

임무: 구글 검색을 통해 위 카테고리들과 관련하여 지금 한국에서 가장 검색량이 높거나 급상승 중인 SEO 시드 키워드를 추천하세요.

추천 기준:
1. 각 카테고리에서 최근 1주일 이내 급상승 중인 토픽 또는 지속적으로 검색량이 높은 키워드
2. "기타" 카테고리에서는 현재 한국 사회에서 가장 핫한 이슈 (경제, 정치, 기술, 문화 등)
3. 이미 설정된 시드 키워드와 중복되지 않는 새로운 키워드
4. 블로그 글로 작성하기 좋은 정보탐색형 키워드 (너무 넓거나 모호하지 않을 것)

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "keyword": "추천 시드 키워드 (2~5단어, 한글)",
    "category": "해당 카테고리명",
    "reason": "왜 이 키워드가 지금 좋은지 한 줄 설명 (한글)",
    "trend": "one of: 급상승, 꾸준히높음, 계절성"
  }
]

IMPORTANT:
- 총 8~12개의 키워드를 추천하세요.
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- 모든 내용은 한글로 작성하세요.
- 과거 학습 데이터에 의존하지 말고, 반드시 구글 검색 결과를 기반으로 추천하세요.`;

    console.log('[recommend-seeds] Calling Gemini with Google Search...');
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: { tools: [{ googleSearch: {} }] },
    });

    const text = response.text || "";
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();

    try {
      const recommendations = JSON.parse(cleanText);
      return res.status(200).json({ recommendations });
    } catch (parseError) {
      console.error('[recommend-seeds] JSON parse error:', parseError);
      console.error('[recommend-seeds] Raw text:', text);
      return res.status(500).json({ error: 'AI 응답 파싱 실패. 다시 시도해주세요.' });
    }
  } catch (error: any) {
    console.error('[recommend-seeds] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}
