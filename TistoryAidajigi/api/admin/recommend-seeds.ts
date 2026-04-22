import { GoogleGenAI } from "@google/genai";
import { isAuthenticated } from '../_lib/redis.js';

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

// 釉붾줈洹?移댄뀒怨좊━ 紐⑸줉 (generate-content.ts? ?숆린??
const BLOG_CATEGORIES = [
  "ai ?좉린??諛??댁뒋",
  "湲고썑蹂???댁뒋",
  "?뺤콉怨??쒕룄",
  "湲고썑湲덉쑖",
  "援?젣?묐젰",
  "怨쇳븰怨?湲곗닠",
  "?꾩냼以묐┰",
  "湲고?",
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

    const prompt = `?ㅻ뒛? ${today} ?낅땲?? ?뱀떊? ?쒓뎅 理쒓퀬??SEO ?꾨Ц媛?댁옄, ??1000留뚯썝 ?섏씡???대뒗 ?꾨Ц 釉붾줈嫄곗엯?덈떎.

?꾨옒????釉붾줈洹몄쓽 移댄뀒怨좊━ 紐⑸줉?낅땲??
${BLOG_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${currentSeeds ? `?꾩옱 ?ㅼ젙???쒕뱶 ?ㅼ썙?? ${currentSeeds}` : '?꾩옱 ?ㅼ젙???쒕뱶 ?ㅼ썙?쒓? ?놁뒿?덈떎.'}

?꾨Т: 援ш? 寃?됱쓣 ?듯빐 ??移댄뀒怨좊━?ㅺ낵 愿?⑦븯??吏湲??쒓뎅?먯꽌 媛??寃?됰웾???믨굅??湲됱긽??以묒씤 SEO ?쒕뱶 ?ㅼ썙?쒕? 異붿쿇?섏꽭??

異붿쿇 湲곗?:
1. ?꾨Ц 移댄뀒怨좊━(1~7踰?: 理쒓렐 1二쇱씪 ?대궡 湲됱긽??以묒씠嫄곕굹 吏?띿쟻?쇰줈 寃?됰웾???믪? ?꾨Ц ?ㅼ썙??
2. "湲고?" 移댄뀒怨좊━(?몃옒???좊룄??: 釉붾줈洹?硫붿씤 二쇱젣(AI/湲고썑)? ?꾩쟾??遺꾨━???쇰컲 ?以묒쓽 愿?ъ궗(?앺솢 轅?? ?ы뀒?? ?ㅼ깮???レ씠?? 臾명솕 ??濡쒕쭔 援ъ꽦?섏꽭??
3. ?대? ?ㅼ젙???쒕뱶 ?ㅼ썙?쒖? 以묐났?섏? ?딅뒗 ?덈줈???ㅼ썙??4. 釉붾줈洹?湲濡??묒꽦?섍린 醫뗭? ?뺣낫?먯깋???ㅼ썙??(?덈Т ?볤굅??紐⑦샇?섏? ?딆쓣 寃?

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "keyword": "異붿쿇 ?쒕뱶 ?ㅼ썙??(2~5?⑥뼱, ?쒓?)",
    "category": "?대떦 移댄뀒怨좊━紐?,
    "reason": "?????ㅼ썙?쒓? 吏湲?醫뗭?吏 ??以??ㅻ챸 (?쒓?)",
    "trend": "one of: 湲됱긽?? 袁몄??덈넂?? 怨꾩젅??
  }
]

IMPORTANT:
- 珥?10媛??댁쇅???ㅼ썙?쒕? 異붿쿇?섏꽭??
- ?꾩껜 異붿쿇 ?ㅼ썙??以?**諛섎뱶??2~3媛쒕뒗 "湲고?" 移댄뀒怨좊━濡??좊떦**?섏뿬, ?쇰컲 ?以묒씠 寃?됲븷 留뚰븳 踰붿슜?곸씤 ?レ씠?덈? ?ы븿?쒗궗 寃?
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- 紐⑤뱺 ?댁슜? ?쒓?濡??묒꽦?섏꽭??
- 怨쇨굅 ?숈뒿 ?곗씠?곗뿉 ?섏〈?섏? 留먭퀬, 諛섎뱶??援ш? 寃??寃곌낵瑜?湲곕컲?쇰줈 異붿쿇?섏꽭??`;

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
      return res.status(500).json({ error: 'AI ?묐떟 ?뚯떛 ?ㅽ뙣. ?ㅼ떆 ?쒕룄?댁＜?몄슂.' });
    }
  } catch (error: any) {
    console.error('[recommend-seeds] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}


