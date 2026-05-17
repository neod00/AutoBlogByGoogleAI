import { GoogleGenAI } from "@google/genai";
import { redis, isAuthenticated } from '../_lib/redis.js';

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
const REDIS_KEY = 'admin:discovered_keywords';

interface DiscoveredKeyword {
  id: string;
  seed: string;           // ?먮낯 ?쒕뱶 ?ㅼ썙??
  mainKeyword: string;    // 諛쒓뎬??硫붿씤 ?ㅼ썙??
  subKeywords: string[];  // ?쒕툕 ?ㅼ썙??3媛?
  suggestedTitle: string; // AI媛 異붿쿇?섎뒗 釉붾줈洹??쒕ぉ (H1)
  hookSummary: string;    // ?낆옄 ?좎씤 ??以???
  searchIntent: string;   // 寃???섎룄 (?뺣낫?먯깋, 鍮꾧탳遺꾩꽍, 諛⑸쾿濡???
  difficulty: 'low' | 'medium' | 'high'; // SEO 寃쎌웳???덉륫
  template: string;       // 異붿쿇 ?쒗뵆由?
  reasoning: string;      // ?????ㅼ썙?쒓? 醫뗭?吏 ??以??ㅻ챸
  status: 'discovered' | 'approved' | 'dismissed'; // ?곹깭
  discoveredAt: string;
}

// 臾대즺 API Rate Limit 諛⑹뼱: ?쒕뱶蹂??쒖감 ?몄텧 + ?쒕젅??
const MAX_SEEDS_PER_RUN = 5;       // ??踰??ㅽ뻾 ??理쒕? ?쒕뱶 ??(Vercel 60珥???꾩븘??諛⑹뼱)
const DELAY_BETWEEN_CALLS_MS = 3000; // ?몄텧 媛??湲??쒓컙 (臾대즺 ?곗뼱 15 RPM 諛⑹뼱)

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

// ?⑥씪 ?쒕뱶濡??ㅼ썙??2媛?諛쒓뎬
async function discoverForSingleSeed(ai: any, seed: string): Promise<DiscoveredKeyword[]> {
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  // [Step 1] ?⑺듃 泥댁빱 (援ш? 寃???꾩슜)
  const factPrompt = `紐낆떖?대씪. ?ㅻ뒛? ${today} ?대떎. ?덉쓽 怨쇨굅 湲곗뼲? ??몄쓣 ?뺣쪧???믩떎.
?꾨Т: ?뱀떊? ?⑺듃泥댄겕 ?꾨Ц AI?낅땲?? ?쒓났??二쇱젣 "${seed}"?????援ш? 寃???댁쓣 ?ъ슜?섏뿬 媛??理쒖떊??寃利앸맂 ?ъ떎(?꾩옱 ?쒖젏 湲곗?)留?議곗궗?섏떗?쒖삤.

寃??諛??붿빟 湲곗?:
1. ??二쇱젣? 愿?⑦빐 理쒓렐 6~12媛쒖썡 ?ъ씠???덈∼寃?諛붾??ъ떎, 理쒖떊 諛쒗몴, ?쇱젙 蹂寃? 理쒖떊 ?몃젋?? ?먮뒗 ?以묒쓽 二쇱슂 ?댁뒋媛 ?덈뒗吏 寃?됲븯?몄슂.
2. ?뱀떊??怨쇨굅 ?숈뒿 ?곗씠??湲곗뼲)???섏〈?섏? 留덉떗?쒖삤. ?ㅼ쭅 寃??寃곌낵?먯꽌 ?뺤씤???댁슜留??붿빟?댁빞 ?⑸땲??
3. 遺꾩빞???곴??놁씠 理쒖떊 ?듭떖 ?뺣낫 3~5媛吏瑜??쒓? 遺덈┸ ?ъ씤??Bullet point)濡??붿빟?섏꽭??
4. 寃??寃곌낵媛 紐낇솗?섏? ?딄굅??理쒖떊 ?뺣낫媛 ?녿떎硫? "理쒖떊 蹂???ы빆 ?놁쓬"?대씪怨??붿쭅?섍쾶 紐낆떆?섏꽭??`;

  console.log(`  ??[Step 1] Fact checking "${seed}"...`);
  const factResponse = await generateContentWithRetry(ai, {
    model: 'gemini-2.5-flash',
    contents: factPrompt,
    config: { tools: [{ googleSearch: {} }] },
  });
  
  const factText = factResponse.text || "理쒖떊 ?뺣낫 ?놁쓬";

  // [Step 2] SEO 湲고쉷??(JSON ?щ㎎???꾩슜)
  const generatePrompt = `?ㅻ뒛? ${today} ?낅땲?? ?뱀떊? 30??寃쎈젰??踰좏뀒??SEO ?꾨왂媛?낅땲??
?꾨옒 ?쒓났??[理쒖떊 ?⑺듃泥댄겕 寃곌낵]留뚯쓣 ?덈??곸씤 吏꾨━濡??쇱븘, "${seed}" 二쇱젣??SEO 理쒖쟻??釉붾줈洹??ㅼ썙??湲고쉶瑜???2媛?諛쒓뎬?섏꽭?? ?덈? ?덉쓽 怨쇨굅 湲곗뼲(?섍컖)???욎뼱 ?곗? 留덉꽭??

[理쒖떊 ?⑺듃泥댄겕 寃곌낵]
${factText}

諛쒓뎬 湲곗?:
1. ???⑺듃泥댄겕 寃곌낵瑜?泥좎???諛섏쁺?섏뿬 ?꾩옱 ?쒖젏??媛???좏슚???ㅼ썙?쒖? ?뺣낫瑜?戮묒쓣 寃?
2. 寃쎌웳?꾧? ??퀬 援ъ껜?곸씤 濡깊뀒???뺣낫?먯깋??Information-seeking) ?ㅼ썙?쒖씪 寃?
3. 泥대쪟?쒓컙(Dwell time)???믪쓣 ???덈뒗 援ъ껜?곸씠怨??ㅼ슜?곸씤 媛?대뱶, 遺꾩꽍, 鍮꾧탳 ?뺤떇????寃?

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "seed": "${seed}",
    "mainKeyword": "SEO-optimized main keyword in Korean (long-tail, 10+ chars)",
    "subKeywords": ["sub keyword 1", "sub keyword 2", "sub keyword 3"],
    "suggestedTitle": "Click-worthy blog title in Korean matching the verified facts",
    "hookSummary": "One-sentence hook that makes the reader NEED to click (Korean)",
    "searchIntent": "one of: ?뺣낫?먯깋, 鍮꾧탳遺꾩꽍, 諛⑸쾿媛?대뱶, ?몃젋?쒕텇?? ?ъ링?댁꽕",
    "difficulty": "one of: low, medium, high",
    "template": "one of: default, review, interview, qa, investment",
    "reasoning": "One sentence explaining WHY this keyword is good based strictly on the facts (Korean)"
  }
]

IMPORTANT:
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- All text content must be in Korean.
- suggestedTitle must be compelling and FACTUAL based on the facts provided.
- 狩먲툘 TITLE GENERATION RULES (100留?釉붾줈嫄곗쓽 ?ㅼ쟾 留ㅻ돱?? 狩먲툘
  1. [?곕룄 ?ъ슜 ?쒗븳]: ?쒕ぉ???꾩옱 ?곕룄(?? 2026??瑜?媛뺣컯?곸쑝濡??ｌ? 留덉꽭?? 臾댁“嫄??쒖쓽?깆씠 ?듭떖??理쒖떊 ?몃젋???댁뒋 湲?먮쭔 留ㅼ슦 ?쒗븳?곸쑝濡??ъ슜?섏꽭?? (?꾩껜??20% 誘몃쭔)
  2. [Value-First ??: "?곕룄"??"?ㅼ썙??蹂대떎 ?낆옄媛 ?살쓣 ?대뱷(Benefit)?대굹 ?멸린??怨듦컧(Pain-point)???쒕ぉ 媛???욌?遺꾩뿉 諛곗튂?섏꽭??
     (Bad ?덉떆: "2026 湲고썑二쇨컙 ?꾨줈洹몃옩 5媛吏" -> Good ?덉떆: "二쇰쭚???꾩씠? ?ъ닔 媛꾨떎硫? 湲고썑二쇨컙 ?꾩닔 肄붿뒪 5")
  3. [?щ㎎ ?ㅼ뼇??: 由ъ뒪?명삎("~媛吏"), 吏덈Ц??"~?쇨퉴?"), ?명븯?고삎("~?섎뒗 踰?), 二쇱쓽/寃쎄퀬??"~?섍린 ???꾩닔 ?뺤씤") ???ㅼ뼇???뺥깭???쒕ぉ???쒖븞?섏꽭?? 泥쒗렪?쇰쪧?곸씤 ?⑦꽩???쇳븯?몄슂.`;

  console.log(`  ??[Step 2] Generating JSON for "${seed}"...`);
  const response = await generateContentWithRetry(ai, {
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
      searchIntent: item.searchIntent || '?뺣낫?먯깋',
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

// ?꾩껜 ?쒕뱶 ?쒖감 泥섎━ (Rate Limit ?뚰뵾)
async function discoverKeywords(seeds: string[]): Promise<DiscoveredKeyword[]> {
  if (!API_KEY) throw new Error("API_KEY not set");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // ?쒕뱶媛 ?덈Т 留롮쑝硫??쒕뜡?쇰줈 理쒕? N媛쒕쭔 ?좏깮 (Vercel ??꾩븘??諛⑹뼱)
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
      console.log(`  ??Found ${keywords.length} keywords for "${seed}"`);
    } catch (e: any) {
      console.error(`  ??ERROR for seed "${seed}":`, e.message);
      // 媛쒕퀎 ?쒕뱶 ?ㅽ뙣 ???ㅼ쓬 ?쒕뱶濡?怨꾩냽 吏꾪뻾 (?꾩껜 ?ㅽ뙣 諛⑹?)
    }

    // 留덉?留??쒕뱶媛 ?꾨땲硫??쒕젅???곸슜 (Rate Limit 諛⑹뼱)
    if (i < selectedSeeds.length - 1) {
      console.log(`  ??Waiting ${DELAY_BETWEEN_CALLS_MS}ms before next call...`);
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
    // GET: 罹먯떆??諛쒓뎬 ?ㅼ썙??議고쉶
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const keywords = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      return res.status(200).json({ keywords });
    }

    // POST: ?덈줈 諛쒓뎬 ?ㅽ뻾
    if (req.method === 'POST') {
      // ?ㅼ젙?먯꽌 ?쒕뱶 ?ㅼ썙??媛?몄삤湲?
      const settings = await redis.get<any>('admin:settings') || {};
      const dailyTopic = req.body?.seeds || settings.dailyTopic || 'AI Trends';
      const seeds = dailyTopic.split(',').map((s: string) => s.trim()).filter((s: string) => s);

      if (seeds.length === 0) {
        return res.status(400).json({ error: 'No seed keywords configured. Update dailyTopic in settings.' });
      }

      const newKeywords = await discoverKeywords(seeds);

      // 湲곗〈 ?ㅼ썙?쒖? 蹂묓빀 (理쒓렐 寃껋씠 ?꾨줈, 理쒕? 30媛?蹂닿?)
      const existing = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      const merged = [...newKeywords, ...existing].slice(0, 30);
      await redis.set(REDIS_KEY, merged);

      return res.status(200).json({ keywords: merged, newCount: newKeywords.length });
    }

    // PUT: ?ㅼ썙???곹깭 蹂寃?(approved/dismissed)
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

    // DELETE: ?ㅼ썙????젣
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


