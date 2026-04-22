import { GoogleGenAI } from "@google/genai";
import { redis, isAuthenticated } from '../_lib/redis.ts';

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
const REDIS_KEY = 'admin:discovered_keywords';

interface DiscoveredKeyword {
  id: string;
  seed: string;           // ?ë³¸ ?œë“œ ?¤ì›Œ??
  mainKeyword: string;    // ë°œêµ´??ë©”ì¸ ?¤ì›Œ??
  subKeywords: string[];  // ?œë¸Œ ?¤ì›Œ??3ê°?
  suggestedTitle: string; // AIê°€ ì¶”ì²œ?˜ëŠ” ë¸”ë¡œê·??œëª© (H1)
  hookSummary: string;    // ?…ì ? ì¸ ??ì¤???
  searchIntent: string;   // ê²€???˜ë„ (?•ë³´?ìƒ‰, ë¹„êµë¶„ì„, ë°©ë²•ë¡???
  difficulty: 'low' | 'medium' | 'high'; // SEO ê²½ìŸ???ˆì¸¡
  template: string;       // ì¶”ì²œ ?œí”Œë¦?
  reasoning: string;      // ?????¤ì›Œ?œê? ì¢‹ì?ì§€ ??ì¤??¤ëª…
  status: 'discovered' | 'approved' | 'dismissed'; // ?íƒœ
  discoveredAt: string;
}

// ë¬´ë£Œ API Rate Limit ë°©ì–´: ?œë“œë³??œì°¨ ?¸ì¶œ + ?œë ˆ??
const MAX_SEEDS_PER_RUN = 5;       // ??ë²??¤í–‰ ??ìµœë? ?œë“œ ??(Vercel 60ì´??€?„ì•„??ë°©ì–´)
const DELAY_BETWEEN_CALLS_MS = 3000; // ?¸ì¶œ ê°??€ê¸??œê°„ (ë¬´ë£Œ ?°ì–´ 15 RPM ë°©ì–´)

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

// ?¨ì¼ ?œë“œë¡??¤ì›Œ??2ê°?ë°œêµ´
async function discoverForSingleSeed(ai: any, seed: string): Promise<DiscoveredKeyword[]> {
  const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

  // [Step 1] ?©íŠ¸ ì²´ì»¤ (êµ¬ê? ê²€???„ìš©)
  const factPrompt = `ëª…ì‹¬?´ë¼. ?¤ëŠ˜?€ ${today} ?´ë‹¤. ?ˆì˜ ê³¼ê±° ê¸°ì–µ?€ ?€?¸ì„ ?•ë¥ ???’ë‹¤.
?„ë¬´: ?¹ì‹ ?€ ?©íŠ¸ì²´í¬ ?„ë¬¸ AI?…ë‹ˆ?? ?œê³µ??ì£¼ì œ "${seed}"???€??êµ¬ê? ê²€???´ì„ ?¬ìš©?˜ì—¬ ê°€??ìµœì‹ ??ê²€ì¦ëœ ?¬ì‹¤(?„ì¬ ?œì  ê¸°ì?)ë§?ì¡°ì‚¬?˜ì‹­?œì˜¤.

ê²€??ë°??”ì•½ ê¸°ì?:
1. ??ì£¼ì œ?€ ê´€?¨í•´ ìµœê·¼ 6~12ê°œì›” ?¬ì´???ˆë¡­ê²?ë°”ë€??¬ì‹¤, ìµœì‹  ë°œí‘œ, ?¼ì • ë³€ê²? ìµœì‹  ?¸ë Œ?? ?ëŠ” ?€ì¤‘ì˜ ì£¼ìš” ?´ìŠˆê°€ ?ˆëŠ”ì§€ ê²€?‰í•˜?¸ìš”.
2. ?¹ì‹ ??ê³¼ê±° ?™ìŠµ ?°ì´??ê¸°ì–µ)???˜ì¡´?˜ì? ë§ˆì‹­?œì˜¤. ?¤ì§ ê²€??ê²°ê³¼?ì„œ ?•ì¸???´ìš©ë§??”ì•½?´ì•¼ ?©ë‹ˆ??
3. ë¶„ì•¼???ê??†ì´ ìµœì‹  ?µì‹¬ ?•ë³´ 3~5ê°€ì§€ë¥??œê? ë¶ˆë¦¿ ?¬ì¸??Bullet point)ë¡??”ì•½?˜ì„¸??
4. ê²€??ê²°ê³¼ê°€ ëª…í™•?˜ì? ?Šê±°??ìµœì‹  ?•ë³´ê°€ ?†ë‹¤ë©? "ìµœì‹  ë³€???¬í•­ ?†ìŒ"?´ë¼ê³??”ì§?˜ê²Œ ëª…ì‹œ?˜ì„¸??`;

  console.log(`  ??[Step 1] Fact checking "${seed}"...`);
  const factResponse = await generateContentWithRetry(ai, {
    model: 'gemini-2.5-flash',
    contents: factPrompt,
    config: { tools: [{ googleSearch: {} }] },
  });
  
  const factText = factResponse.text || "ìµœì‹  ?•ë³´ ?†ìŒ";

  // [Step 2] SEO ê¸°íš??(JSON ?¬ë§·???„ìš©)
  const generatePrompt = `?¤ëŠ˜?€ ${today} ?…ë‹ˆ?? ?¹ì‹ ?€ 30??ê²½ë ¥??ë² í…Œ??SEO ?„ëµê°€?…ë‹ˆ??
?„ë˜ ?œê³µ??[ìµœì‹  ?©íŠ¸ì²´í¬ ê²°ê³¼]ë§Œì„ ?ˆë??ì¸ ì§„ë¦¬ë¡??¼ì•„, "${seed}" ì£¼ì œ??SEO ìµœì ??ë¸”ë¡œê·??¤ì›Œ??ê¸°íšŒë¥???2ê°?ë°œêµ´?˜ì„¸?? ?ˆë? ?ˆì˜ ê³¼ê±° ê¸°ì–µ(?˜ê°)???ì–´ ?°ì? ë§ˆì„¸??

[ìµœì‹  ?©íŠ¸ì²´í¬ ê²°ê³¼]
${factText}

ë°œêµ´ ê¸°ì?:
1. ???©íŠ¸ì²´í¬ ê²°ê³¼ë¥?ì² ì???ë°˜ì˜?˜ì—¬ ?„ì¬ ?œì ??ê°€??? íš¨???¤ì›Œ?œì? ?•ë³´ë¥?ë½‘ì„ ê²?
2. ê²½ìŸ?„ê? ??³  êµ¬ì²´?ì¸ ë¡±í…Œ???•ë³´?ìƒ‰??Information-seeking) ?¤ì›Œ?œì¼ ê²?
3. ì²´ë¥˜?œê°„(Dwell time)???’ì„ ???ˆëŠ” êµ¬ì²´?ì´ê³??¤ìš©?ì¸ ê°€?´ë“œ, ë¶„ì„, ë¹„êµ ?•ì‹????ê²?

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "seed": "${seed}",
    "mainKeyword": "SEO-optimized main keyword in Korean (long-tail, 10+ chars)",
    "subKeywords": ["sub keyword 1", "sub keyword 2", "sub keyword 3"],
    "suggestedTitle": "Click-worthy blog title in Korean matching the verified facts",
    "hookSummary": "One-sentence hook that makes the reader NEED to click (Korean)",
    "searchIntent": "one of: ?•ë³´?ìƒ‰, ë¹„êµë¶„ì„, ë°©ë²•ê°€?´ë“œ, ?¸ë Œ?œë¶„?? ?¬ì¸µ?´ì„¤",
    "difficulty": "one of: low, medium, high",
    "template": "one of: default, review, interview, qa, investment",
    "reasoning": "One sentence explaining WHY this keyword is good based strictly on the facts (Korean)"
  }
]

IMPORTANT:
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- All text content must be in Korean.
- suggestedTitle must be compelling and FACTUAL based on the facts provided.
- â­ï¸ TITLE GENERATION RULES (100ë§?ë¸”ë¡œê±°ì˜ ?¤ì „ ë§¤ë‰´?? â­ï¸
  1. [?°ë„ ?¬ìš© ?œí•œ]: ?œëª©???„ì¬ ?°ë„(?? 2026??ë¥?ê°•ë°•?ìœ¼ë¡??£ì? ë§ˆì„¸?? ë¬´ì¡°ê±??œì˜?±ì´ ?µì‹¬??ìµœì‹  ?¸ë Œ???´ìŠˆ ê¸€?ë§Œ ë§¤ìš° ?œí•œ?ìœ¼ë¡??¬ìš©?˜ì„¸?? (?„ì²´??20% ë¯¸ë§Œ)
  2. [Value-First ??: "?°ë„"??"?¤ì›Œ??ë³´ë‹¤ ?…ìê°€ ?»ì„ ?´ë“(Benefit)?´ë‚˜ ?¸ê¸°??ê³µê°(Pain-point)???œëª© ê°€???ë?ë¶„ì— ë°°ì¹˜?˜ì„¸??
     (Bad ?ˆì‹œ: "2026 ê¸°í›„ì£¼ê°„ ?„ë¡œê·¸ë¨ 5ê°€ì§€" -> Good ?ˆì‹œ: "ì£¼ë§???„ì´?€ ?¬ìˆ˜ ê°„ë‹¤ë©? ê¸°í›„ì£¼ê°„ ?„ìˆ˜ ì½”ìŠ¤ 5")
  3. [?¬ë§· ?¤ì–‘??: ë¦¬ìŠ¤?¸í˜•("~ê°€ì§€"), ì§ˆë¬¸??"~?¼ê¹Œ?"), ?¸í•˜?°í˜•("~?˜ëŠ” ë²?), ì£¼ì˜/ê²½ê³ ??"~?˜ê¸° ???„ìˆ˜ ?•ì¸") ???¤ì–‘???•íƒœ???œëª©???œì•ˆ?˜ì„¸?? ì²œí¸?¼ë¥ ?ì¸ ?¨í„´???¼í•˜?¸ìš”.`;

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
      searchIntent: item.searchIntent || '?•ë³´?ìƒ‰',
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

// ?„ì²´ ?œë“œ ?œì°¨ ì²˜ë¦¬ (Rate Limit ?Œí”¼)
async function discoverKeywords(seeds: string[]): Promise<DiscoveredKeyword[]> {
  if (!API_KEY) throw new Error("API_KEY not set");
  const ai = new GoogleGenAI({ apiKey: API_KEY });

  // ?œë“œê°€ ?ˆë¬´ ë§ìœ¼ë©??œë¤?¼ë¡œ ìµœë? Nê°œë§Œ ? íƒ (Vercel ?€?„ì•„??ë°©ì–´)
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
      // ê°œë³„ ?œë“œ ?¤íŒ¨ ???¤ìŒ ?œë“œë¡?ê³„ì† ì§„í–‰ (?„ì²´ ?¤íŒ¨ ë°©ì?)
    }

    // ë§ˆì?ë§??œë“œê°€ ?„ë‹ˆë©??œë ˆ???ìš© (Rate Limit ë°©ì–´)
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
    // GET: ìºì‹œ??ë°œêµ´ ?¤ì›Œ??ì¡°íšŒ
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      const keywords = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      return res.status(200).json({ keywords });
    }

    // POST: ?ˆë¡œ ë°œêµ´ ?¤í–‰
    if (req.method === 'POST') {
      // ?¤ì •?ì„œ ?œë“œ ?¤ì›Œ??ê°€?¸ì˜¤ê¸?
      const settings = await redis.get<any>('admin:settings') || {};
      const dailyTopic = req.body?.seeds || settings.dailyTopic || 'AI Trends';
      const seeds = dailyTopic.split(',').map((s: string) => s.trim()).filter((s: string) => s);

      if (seeds.length === 0) {
        return res.status(400).json({ error: 'No seed keywords configured. Update dailyTopic in settings.' });
      }

      const newKeywords = await discoverKeywords(seeds);

      // ê¸°ì¡´ ?¤ì›Œ?œì? ë³‘í•© (ìµœê·¼ ê²ƒì´ ?„ë¡œ, ìµœë? 30ê°?ë³´ê?)
      const existing = await redis.get<DiscoveredKeyword[]>(REDIS_KEY) || [];
      const merged = [...newKeywords, ...existing].slice(0, 30);
      await redis.set(REDIS_KEY, merged);

      return res.status(200).json({ keywords: merged, newCount: newKeywords.length });
    }

    // PUT: ?¤ì›Œ???íƒœ ë³€ê²?(approved/dismissed)
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

    // DELETE: ?¤ì›Œ???? œ
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

