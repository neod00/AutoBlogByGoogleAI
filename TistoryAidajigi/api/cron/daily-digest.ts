import { GoogleGenAI } from "@google/genai";
import nodemailer from 'nodemailer';
import { redis } from '../_lib/redis.ts';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});

async function sendEmail(fromUser: string, to: string, subject: string, html: string) {
    const mailOptions = {
        from: fromUser,
        to,
        subject,
        html,
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Email sent: ' + info.response);
        return info;
    } catch (error) {
        console.error('Error sending email:', error);
        throw error;
    }
}

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

// ë¬´ë£Œ API Rate Limit ë°©ì–´: ?œë“œë³??œì°¨ ?¸ì¶œ + ?œë ˆ??
const MAX_SEEDS_PER_RUN = 5;
const DELAY_BETWEEN_CALLS_MS = 3000;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ?¨ì¼ ?œë“œ ë°œêµ´
async function discoverForSingleSeed(ai: any, seed: string): Promise<DiscoveredKeyword[]> {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    // [Step 1] ?©íŠ¸ ì²´ì»¤ (êµ¬ê? ê²€???„ìš©)
    const factPrompt = `ëª…ì‹¬?´ë¼. ?¤ëŠ˜?€ ${today} ?´ë‹¤. ?ˆì˜ ê³¼ê±° ê¸°ì–µ?€ ?€?¸ì„ ?•ë¥ ???’ë‹¤.
?„ë¬´: ?¹ì‹ ?€ ?©íŠ¸ì²´í¬ ?„ë¬¸ AI?…ë‹ˆ?? ?œê³µ??ì£¼ì œ "${seed}"???€??êµ¬ê? ê²€???´ì„ ?¬ìš©?˜ì—¬ ê°€??ìµœì‹ ??ê²€ì¦ëœ ?¬ì‹¤(?„ì¬ ?œì  ê¸°ì?)ë§?ì¡°ì‚¬?˜ì‹­?œì˜¤.

ê²€??ë°??”ì•½ ê¸°ì?:
1. ??ì£¼ì œ?€ ê´€?¨í•´ ìµœê·¼ 6~12ê°œì›” ?¬ì´???ˆë¡­ê²?ë°”ë€??¬ì‹¤, ìµœì‹  ë°œí‘œ, ?¼ì • ë³€ê²? ìµœì‹  ?¸ë Œ?? ?ëŠ” ?€ì¤‘ì˜ ì£¼ìš” ?´ìŠˆê°€ ?ˆëŠ”ì§€ ê²€?‰í•˜?¸ìš”.
2. ?¹ì‹ ??ê³¼ê±° ?™ìŠµ ?°ì´??ê¸°ì–µ)???˜ì¡´?˜ì? ë§ˆì‹­?œì˜¤. ?¤ì§ ê²€??ê²°ê³¼?ì„œ ?•ì¸???´ìš©ë§??”ì•½?´ì•¼ ?©ë‹ˆ??
3. ë¶„ì•¼???ê??†ì´ ìµœì‹  ?µì‹¬ ?•ë³´ 3~5ê°€ì§€ë¥??œê? ë¶ˆë¦¿ ?¬ì¸??Bullet point)ë¡??”ì•½?˜ì„¸??
4. ê²€??ê²°ê³¼ê°€ ëª…í™•?˜ì? ?Šê±°??ìµœì‹  ?•ë³´ê°€ ?†ë‹¤ë©? "ìµœì‹  ë³€???¬í•­ ?†ìŒ"?¼ê³  ?”ì§?˜ê²Œ ëª…ì‹œ?˜ì„¸??`;

    console.log(`  ??[Step 1] Fact checking "${seed}"...`);
    const factResponse = await ai.models.generateContent({
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
- ?œëª©???°ë„(?? 2026??ë¥??£ì„ì§€ ?¬ë???ê¸€???±ê²©???°ë¼ ?ë‹¨?˜ì„¸??
  ???°ë„ë¥??£ì–´???˜ëŠ” ê²½ìš°: ?•ì±…/ë²•ë¥  ë³€ê²? ?°ê°„ ?¸ë Œ???„ë§, ?œì¦Œë³??œí’ˆ ë¹„êµ ???œì˜?±ì´ ?µì‹¬??ê¸€
  ???°ë„ë¥??£ì? ë§ì•„???˜ëŠ” ê²½ìš°: ê°œë… ?¤ëª…, ?ë¦¬ ?´ì„¤, ?¼ë°˜?ì¸ ë°©ë²•ë¡?ê°€?´ë“œ ???œê°„??êµ¬ì• ë°›ì? ?ŠëŠ” ?ë²„ê·¸ë¦°(Evergreen) ì½˜í…ì¸?;

    console.log(`  ??[Step 2] Generating JSON for "${seed}"...`);
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

// ?„ì²´ ?œë“œ ?œì°¨ ì²˜ë¦¬
async function discoverSEOKeywords(seeds: string[]): Promise<DiscoveredKeyword[]> {
    if (!API_KEY) throw new Error("API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    let selectedSeeds = seeds;
    if (seeds.length > MAX_SEEDS_PER_RUN) {
        const shuffled = [...seeds].sort(() => Math.random() - 0.5);
        selectedSeeds = shuffled.slice(0, MAX_SEEDS_PER_RUN);
        console.log(`Too many seeds in cron. Selected ${MAX_SEEDS_PER_RUN}: ${selectedSeeds.join(', ')}`);
    }

    const allKeywords: DiscoveredKeyword[] = [];

    for (let i = 0; i < selectedSeeds.length; i++) {
        const seed = selectedSeeds[i];
        console.log(`[Cron ${i + 1}/${selectedSeeds.length}] Discovering for: "${seed}"`);

        try {
            const keywords = await discoverForSingleSeed(ai, seed);
            allKeywords.push(...keywords);
            console.log(`  ??Found ${keywords.length} keywords`);
        } catch (e: any) {
            console.error(`  ??ERROR for seed "${seed}":`, e.message);
        }

        if (i < selectedSeeds.length - 1) {
            await delay(DELAY_BETWEEN_CALLS_MS);
        }
    }

    return allKeywords;
}

// Difficulty badge color helper
function getDifficultyBadge(diff: string): string {
    switch (diff) {
        case 'low': return '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">?Ÿ¢ ê²½ìŸ ??Œ</span>';
        case 'medium': return '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">?Ÿ¡ ì¤‘ê°„</span>';
        case 'high': return '<span style="background:#fecaca;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">?”´ ê²½ìŸ ?’ìŒ</span>';
        default: return '';
    }
}

function getIntentBadge(intent: string): string {
    return `<span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${intent}</span>`;
}

export default async function handler(req: any, res: any) {
    // 1. Authentication
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${CRON_SECRET}` && req.query.key !== CRON_SECRET) {
        // Allow Vercel cron or manual query param
    }

    try {
        // 2. ê´€ë¦¬ì ?¤ì • ë¡œë“œ (Redis KV)
        let recipientEmail = process.env.GMAIL_USER || '';
        let dailyTopic = process.env.DAILY_TOPIC || 'AI Trends';

        try {
            const settings = await redis.get<any>('admin:settings');
            if (settings) {
                if (settings.recipientEmail) recipientEmail = settings.recipientEmail;
                if (settings.dailyTopic) dailyTopic = settings.dailyTopic;
            }
        } catch (e) {
            console.error('Redis Load Settings Error:', e);
        }

        const seeds = dailyTopic.split(',').map((s: string) => s.trim()).filter((s: string) => s);

        // 3. SEO ?¤ì›Œ??ë°œêµ´ (?…ê·¸?ˆì´?œëœ ?„ë¡¬?„íŠ¸)
        const keywords = await discoverSEOKeywords(seeds);

        if (keywords.length === 0) {
            return res.status(200).json({ message: 'No keywords discovered.' });
        }

        // 4. ë°œêµ´ ?¤ì›Œ?œë? Redis???€??(admin:discovered_keywords)
        try {
            const existing = await redis.get<DiscoveredKeyword[]>('admin:discovered_keywords') || [];
            const merged = [...keywords, ...existing].slice(0, 30);
            await redis.set('admin:discovered_keywords', merged);
        } catch (e) {
            console.error('Redis Save Discovered Keywords Error:', e);
        }

        // 5. ?™ì‹œ??ê¸°ì¡´ ? í”½ ?ì—??ì¶”ê? (?˜ìœ„ ?¸í™˜)
        try {
            const key = 'admin:topics_queue';
            let topics = await redis.get<any[]>(key) || [];

            const newTopicItems = keywords.map((kw) => ({
                id: `t_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: kw.suggestedTitle,
                template: kw.template,
                status: 'pending',
                createdAt: new Date().toISOString(),
                source: 'cron-seo',  // ?¬ë¡  ë°œêµ´ ë§ˆí‚¹
                mainKeyword: kw.mainKeyword,
            }));

            await redis.set(key, [...newTopicItems, ...topics]);
        } catch (e) {
            console.error('Redis Save Topics Error:', e);
        }

        // 6. ?´ë©”??êµ¬ì„± (?…ê·¸?ˆì´?œëœ ì¹´ë“œ ?•ì‹)
        let baseUrl = process.env.APP_URL;
        if (!baseUrl) {
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            const host = req.headers.host;
            baseUrl = `${protocol}://${host}`;
        }
        baseUrl = baseUrl.replace(/\/$/, '');
        const cronSecret = process.env.CRON_SECRET || '';

        const keywordCards = keywords.map((kw, index) => {
            const previewLink = `${baseUrl}/?keyword=${encodeURIComponent(kw.mainKeyword)}&auto=true`;
            const publishLink = `${baseUrl}/api/trigger-publish?topic=${encodeURIComponent(kw.suggestedTitle)}&template=${kw.template}&secret=${cronSecret}`;

            return `
            <div style="margin-bottom: 16px; padding: 16px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap;">
                    <span style="background:#0ea5e9;color:white;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:700;">#${kw.seed}</span>
                    ${getDifficultyBadge(kw.difficulty)}
                    ${getIntentBadge(kw.searchIntent)}
                </div>
                <div style="font-size: 17px; font-weight: 700; color: #0f172a; margin-bottom: 4px; line-height: 1.4;">
                    ${kw.suggestedTitle}
                </div>
                <div style="font-size: 13px; color: #64748b; margin-bottom: 6px;">
                    ?¯ <strong>${kw.mainKeyword}</strong>
                </div>
                <div style="font-size: 13px; color: #475569; margin-bottom: 8px; font-style: italic;">
                    ?’¡ ${kw.hookSummary}
                </div>
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 10px;">
                    ${kw.reasoning}
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <a href="${previewLink}" style="display: inline-block; padding: 6px 14px; background: #f1f5f9; color: #475569; border-radius: 8px; text-decoration: none; font-size: 13px;">
                        ?‘ï¸?ë¯¸ë¦¬ë³´ê¸°
                    </a>
                    <a href="${publishLink}" style="display: inline-block; padding: 6px 14px; background: linear-gradient(135deg,#06b6d4,#3b82f6); color: white; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">
                        ?? ì¦‰ì‹œ ë°œí–‰
                    </a>
                </div>
            </div>
            `;
        }).join('');

        const html = `
      <div style="font-family: 'Apple SD Gothic Neo', 'Segoe UI', Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0c4a6e 100%); color: white; padding: 28px; border-radius: 16px 16px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">?” ?¤ëŠ˜??SEO ?¤ì›Œ??ë°œêµ´ ë¦¬í¬??/h1>
          <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">?œë“œ: ${dailyTopic} Â· ${new Date().toLocaleDateString('ko-KR')}</p>
          <p style="margin: 4px 0 0; color: #67e8f9; font-size: 13px;">AIê°€ ë°œêµ´??${keywords.length}ê°œì˜ SEO ìµœì ???¤ì›Œ??/p>
        </div>
        <div style="padding: 20px; background: white; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #64748b; margin-bottom: 16px; font-size: 14px;">
            ?„ë˜ ?¤ì›Œ?œëŠ” <strong>ê²€?‰ëŸ‰ ?€ë¹?ê²½ìŸ?„ê? ??? ë¡±í…Œ???¤ì›Œ??/strong>?…ë‹ˆ??
            ë°”ë¡œ ë°œí–‰?˜ê±°??<a href="${baseUrl}/admin" style="color:#0ea5e9;">?´ë“œë¯??€?œë³´??/a>?ì„œ ê²€? í•˜?¸ìš”.
          </p>
          ${keywordCards}
        </div>
        <div style="padding: 16px; background: #f1f5f9; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none; text-align: center;">
          <a href="${baseUrl}/admin" style="display: inline-block; padding: 10px 24px; background: #0f172a; color: white; border-radius: 10px; text-decoration: none; font-size: 14px; font-weight: 600;">
            ?“‹ ?´ë“œë¯¼ì—???„ì²´ ê´€ë¦¬í•˜ê¸?
          </a>
        </div>
      </div>
    `;

        // 7. Send Email
        if (recipientEmail && process.env.GMAIL_USER) {
            await sendEmail(process.env.GMAIL_USER, recipientEmail, `?” SEO ?¤ì›Œ??ë¦¬í¬?? ${dailyTopic} (${new Date().toLocaleDateString('ko-KR')})`, html);
            return res.status(200).json({ message: 'SEO keyword report sent', keywordCount: keywords.length, keywords });
        } else {
            return res.status(500).json({ error: 'recipientEmail or GMAIL_USER not configured' });
        }

    } catch (error: any) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}

