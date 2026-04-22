import { GoogleGenAI } from "@google/genai";
import nodemailer from 'nodemailer';
import { redis } from '../_lib/redis.js';

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

// 臾대즺 API Rate Limit 諛⑹뼱: ?쒕뱶蹂??쒖감 ?몄텧 + ?쒕젅??
const MAX_SEEDS_PER_RUN = 5;
const DELAY_BETWEEN_CALLS_MS = 3000;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ?⑥씪 ?쒕뱶 諛쒓뎬
async function discoverForSingleSeed(ai: any, seed: string): Promise<DiscoveredKeyword[]> {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    // [Step 1] ?⑺듃 泥댁빱 (援ш? 寃???꾩슜)
    const factPrompt = `紐낆떖?대씪. ?ㅻ뒛? ${today} ?대떎. ?덉쓽 怨쇨굅 湲곗뼲? ??몄쓣 ?뺣쪧???믩떎.
?꾨Т: ?뱀떊? ?⑺듃泥댄겕 ?꾨Ц AI?낅땲?? ?쒓났??二쇱젣 "${seed}"?????援ш? 寃???댁쓣 ?ъ슜?섏뿬 媛??理쒖떊??寃利앸맂 ?ъ떎(?꾩옱 ?쒖젏 湲곗?)留?議곗궗?섏떗?쒖삤.

寃??諛??붿빟 湲곗?:
1. ??二쇱젣? 愿?⑦빐 理쒓렐 6~12媛쒖썡 ?ъ씠???덈∼寃?諛붾??ъ떎, 理쒖떊 諛쒗몴, ?쇱젙 蹂寃? 理쒖떊 ?몃젋?? ?먮뒗 ?以묒쓽 二쇱슂 ?댁뒋媛 ?덈뒗吏 寃?됲븯?몄슂.
2. ?뱀떊??怨쇨굅 ?숈뒿 ?곗씠??湲곗뼲)???섏〈?섏? 留덉떗?쒖삤. ?ㅼ쭅 寃??寃곌낵?먯꽌 ?뺤씤???댁슜留??붿빟?댁빞 ?⑸땲??
3. 遺꾩빞???곴??놁씠 理쒖떊 ?듭떖 ?뺣낫 3~5媛吏瑜??쒓? 遺덈┸ ?ъ씤??Bullet point)濡??붿빟?섏꽭??
4. 寃??寃곌낵媛 紐낇솗?섏? ?딄굅??理쒖떊 ?뺣낫媛 ?녿떎硫? "理쒖떊 蹂???ы빆 ?놁쓬"?쇨퀬 ?붿쭅?섍쾶 紐낆떆?섏꽭??`;

    console.log(`  ??[Step 1] Fact checking "${seed}"...`);
    const factResponse = await ai.models.generateContent({
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
- ?쒕ぉ???곕룄(?? 2026??瑜??ｌ쓣吏 ?щ???湲???깃꺽???곕씪 ?먮떒?섏꽭??
  ???곕룄瑜??ｌ뼱???섎뒗 寃쎌슦: ?뺤콉/踰뺣쪧 蹂寃? ?곌컙 ?몃젋???꾨쭩, ?쒖쫵蹂??쒗뭹 鍮꾧탳 ???쒖쓽?깆씠 ?듭떖??湲
  ???곕룄瑜??ｌ? 留먯븘???섎뒗 寃쎌슦: 媛쒕뀗 ?ㅻ챸, ?먮━ ?댁꽕, ?쇰컲?곸씤 諛⑸쾿濡?媛?대뱶 ???쒓컙??援ъ븷諛쏆? ?딅뒗 ?먮쾭洹몃┛(Evergreen) 肄섑뀗痢?;

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

// ?꾩껜 ?쒕뱶 ?쒖감 泥섎━
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
        case 'low': return '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">?윟 寃쎌웳 ??쓬</span>';
        case 'medium': return '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">?윞 以묎컙</span>';
        case 'high': return '<span style="background:#fecaca;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">?뵶 寃쎌웳 ?믪쓬</span>';
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
        // 2. 愿由ъ옄 ?ㅼ젙 濡쒕뱶 (Redis KV)
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

        // 3. SEO ?ㅼ썙??諛쒓뎬 (?낃렇?덉씠?쒕맂 ?꾨＼?꾪듃)
        const keywords = await discoverSEOKeywords(seeds);

        if (keywords.length === 0) {
            return res.status(200).json({ message: 'No keywords discovered.' });
        }

        // 4. 諛쒓뎬 ?ㅼ썙?쒕? Redis?????(admin:discovered_keywords)
        try {
            const existing = await redis.get<DiscoveredKeyword[]>('admin:discovered_keywords') || [];
            const merged = [...keywords, ...existing].slice(0, 30);
            await redis.set('admin:discovered_keywords', merged);
        } catch (e) {
            console.error('Redis Save Discovered Keywords Error:', e);
        }

        // 5. ?숈떆??湲곗〈 ?좏뵿 ?먯뿉??異붽? (?섏쐞 ?명솚)
        try {
            const key = 'admin:topics_queue';
            let topics = await redis.get<any[]>(key) || [];

            const newTopicItems = keywords.map((kw) => ({
                id: `t_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: kw.suggestedTitle,
                template: kw.template,
                status: 'pending',
                createdAt: new Date().toISOString(),
                source: 'cron-seo',  // ?щ줎 諛쒓뎬 留덊궧
                mainKeyword: kw.mainKeyword,
            }));

            await redis.set(key, [...newTopicItems, ...topics]);
        } catch (e) {
            console.error('Redis Save Topics Error:', e);
        }

        // 6. ?대찓??援ъ꽦 (?낃렇?덉씠?쒕맂 移대뱶 ?뺤떇)
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
                    ?렞 <strong>${kw.mainKeyword}</strong>
                </div>
                <div style="font-size: 13px; color: #475569; margin-bottom: 8px; font-style: italic;">
                    ?뮕 ${kw.hookSummary}
                </div>
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 10px;">
                    ${kw.reasoning}
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <a href="${previewLink}" style="display: inline-block; padding: 6px 14px; background: #f1f5f9; color: #475569; border-radius: 8px; text-decoration: none; font-size: 13px;">
                        ?몓截?誘몃━蹂닿린
                    </a>
                    <a href="${publishLink}" style="display: inline-block; padding: 6px 14px; background: linear-gradient(135deg,#06b6d4,#3b82f6); color: white; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">
                        ?? 利됱떆 諛쒗뻾
                    </a>
                </div>
            </div>
            `;
        }).join('');

        const html = `
      <div style="font-family: 'Apple SD Gothic Neo', 'Segoe UI', Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0c4a6e 100%); color: white; padding: 28px; border-radius: 16px 16px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">?뵇 ?ㅻ뒛??SEO ?ㅼ썙??諛쒓뎬 由ы룷??/h1>
          <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">?쒕뱶: ${dailyTopic} 쨌 ${new Date().toLocaleDateString('ko-KR')}</p>
          <p style="margin: 4px 0 0; color: #67e8f9; font-size: 13px;">AI媛 諛쒓뎬??${keywords.length}媛쒖쓽 SEO 理쒖쟻???ㅼ썙??/p>
        </div>
        <div style="padding: 20px; background: white; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #64748b; margin-bottom: 16px; font-size: 14px;">
            ?꾨옒 ?ㅼ썙?쒕뒗 <strong>寃?됰웾 ?鍮?寃쎌웳?꾧? ??? 濡깊뀒???ㅼ썙??/strong>?낅땲??
            諛붾줈 諛쒗뻾?섍굅??<a href="${baseUrl}/admin" style="color:#0ea5e9;">?대뱶誘???쒕낫??/a>?먯꽌 寃?좏븯?몄슂.
          </p>
          ${keywordCards}
        </div>
        <div style="padding: 16px; background: #f1f5f9; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none; text-align: center;">
          <a href="${baseUrl}/admin" style="display: inline-block; padding: 10px 24px; background: #0f172a; color: white; border-radius: 10px; text-decoration: none; font-size: 14px; font-weight: 600;">
            ?뱥 ?대뱶誘쇱뿉???꾩껜 愿由ы븯湲?
          </a>
        </div>
      </div>
    `;

        // 7. Send Email
        if (recipientEmail && process.env.GMAIL_USER) {
            await sendEmail(process.env.GMAIL_USER, recipientEmail, `?뵇 SEO ?ㅼ썙??由ы룷?? ${dailyTopic} (${new Date().toLocaleDateString('ko-KR')})`, html);
            return res.status(200).json({ message: 'SEO keyword report sent', keywordCount: keywords.length, keywords });
        } else {
            return res.status(500).json({ error: 'recipientEmail or GMAIL_USER not configured' });
        }

    } catch (error: any) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}


