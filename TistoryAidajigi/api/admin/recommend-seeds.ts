import { GoogleGenAI } from "@google/genai";
import { isAuthenticated } from '../_lib/redis.ts';

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";

// ë¸”ë¡œê·?ì¹´í…Œê³ ë¦¬ ëª©ë¡ (generate-content.ts?€ ?™ê¸°??
const BLOG_CATEGORIES = [
  "ai ? ê¸°??ë°??´ìŠˆ",
  "ê¸°í›„ë³€???´ìŠˆ",
  "?•ì±…ê³??œë„",
  "ê¸°í›„ê¸ˆìœµ",
  "êµ? œ?‘ë ¥",
  "ê³¼í•™ê³?ê¸°ìˆ ",
  "?„ì†Œì¤‘ë¦½",
  "ê¸°í?",
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

    const prompt = `?¤ëŠ˜?€ ${today} ?…ë‹ˆ?? ?¹ì‹ ?€ ?œêµ­ ìµœê³ ??SEO ?„ë¬¸ê°€?´ì, ??1000ë§Œì› ?˜ìµ???´ëŠ” ?„ë¬¸ ë¸”ë¡œê±°ì…?ˆë‹¤.

?„ë˜????ë¸”ë¡œê·¸ì˜ ì¹´í…Œê³ ë¦¬ ëª©ë¡?…ë‹ˆ??
${BLOG_CATEGORIES.map((c, i) => `${i + 1}. ${c}`).join('\n')}

${currentSeeds ? `?„ì¬ ?¤ì •???œë“œ ?¤ì›Œ?? ${currentSeeds}` : '?„ì¬ ?¤ì •???œë“œ ?¤ì›Œ?œê? ?†ìŠµ?ˆë‹¤.'}

?„ë¬´: êµ¬ê? ê²€?‰ì„ ?µí•´ ??ì¹´í…Œê³ ë¦¬?¤ê³¼ ê´€?¨í•˜??ì§€ê¸??œêµ­?ì„œ ê°€??ê²€?‰ëŸ‰???’ê±°??ê¸‰ìƒ??ì¤‘ì¸ SEO ?œë“œ ?¤ì›Œ?œë? ì¶”ì²œ?˜ì„¸??

ì¶”ì²œ ê¸°ì?:
1. ?„ë¬¸ ì¹´í…Œê³ ë¦¬(1~7ë²?: ìµœê·¼ 1ì£¼ì¼ ?´ë‚´ ê¸‰ìƒ??ì¤‘ì´ê±°ë‚˜ ì§€?ì ?¼ë¡œ ê²€?‰ëŸ‰???’ì? ?„ë¬¸ ?¤ì›Œ??
2. "ê¸°í?" ì¹´í…Œê³ ë¦¬(?¸ë˜??? ë„??: ë¸”ë¡œê·?ë©”ì¸ ì£¼ì œ(AI/ê¸°í›„)?€ ?„ì „??ë¶„ë¦¬???¼ë°˜ ?€ì¤‘ì˜ ê´€?¬ì‚¬(?í™œ ê¿€?? ?¬í…Œ?? ?¤ìƒ???«ì´?? ë¬¸í™” ??ë¡œë§Œ êµ¬ì„±?˜ì„¸??
3. ?´ë? ?¤ì •???œë“œ ?¤ì›Œ?œì? ì¤‘ë³µ?˜ì? ?ŠëŠ” ?ˆë¡œ???¤ì›Œ??4. ë¸”ë¡œê·?ê¸€ë¡??‘ì„±?˜ê¸° ì¢‹ì? ?•ë³´?ìƒ‰???¤ì›Œ??(?ˆë¬´ ?“ê±°??ëª¨í˜¸?˜ì? ?Šì„ ê²?

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "keyword": "ì¶”ì²œ ?œë“œ ?¤ì›Œ??(2~5?¨ì–´, ?œê?)",
    "category": "?´ë‹¹ ì¹´í…Œê³ ë¦¬ëª?,
    "reason": "?????¤ì›Œ?œê? ì§€ê¸?ì¢‹ì?ì§€ ??ì¤??¤ëª… (?œê?)",
    "trend": "one of: ê¸‰ìƒ?? ê¾¸ì??ˆë†’?? ê³„ì ˆ??
  }
]

IMPORTANT:
- ì´?10ê°??´ì™¸???¤ì›Œ?œë? ì¶”ì²œ?˜ì„¸??
- ?„ì²´ ì¶”ì²œ ?¤ì›Œ??ì¤?**ë°˜ë“œ??2~3ê°œëŠ” "ê¸°í?" ì¹´í…Œê³ ë¦¬ë¡?? ë‹¹**?˜ì—¬, ?¼ë°˜ ?€ì¤‘ì´ ê²€?‰í•  ë§Œí•œ ë²”ìš©?ì¸ ?«ì´?ˆë? ?¬í•¨?œí‚¬ ê²?
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- ëª¨ë“  ?´ìš©?€ ?œê?ë¡??‘ì„±?˜ì„¸??
- ê³¼ê±° ?™ìŠµ ?°ì´?°ì— ?˜ì¡´?˜ì? ë§ê³ , ë°˜ë“œ??êµ¬ê? ê²€??ê²°ê³¼ë¥?ê¸°ë°˜?¼ë¡œ ì¶”ì²œ?˜ì„¸??`;

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
      return res.status(500).json({ error: 'AI ?‘ë‹µ ?Œì‹± ?¤íŒ¨. ?¤ì‹œ ?œë„?´ì£¼?¸ìš”.' });
    }
  } catch (error: any) {
    console.error('[recommend-seeds] Error:', error.message);
    return res.status(500).json({ error: error.message });
  }
}

