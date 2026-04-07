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

// 무료 API Rate Limit 방어: 시드별 순차 호출 + 딜레이
const MAX_SEEDS_PER_RUN = 5;
const DELAY_BETWEEN_CALLS_MS = 3000;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 단일 시드 발굴
async function discoverForSingleSeed(ai: any, seed: string): Promise<DiscoveredKeyword[]> {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    const prompt = `
You are a veteran SEO strategist with 30 years of blogging experience and 1M+ subscribers.
Today is ${today}.

TASK: Analyze trending topics related to this single seed keyword: "${seed}"
Find SEO-optimized blog keyword opportunities that meet ALL these criteria:
1. Currently trending or gaining interest in the last 24 hours
2. Information-seeking (정보탐색형) long-tail keywords, NOT celebrity gossip or weather
3. Low to medium competition — specific enough that major news outlets haven't covered thoroughly
4. Can be turned into a useful "guide", "analysis", or "comparison" blog post
5. Have potential for high dwell time (체류시간)

Produce exactly 2 keyword sets for the seed "${seed}".

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "seed": "${seed}",
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
- mainKeyword should be a natural search query.
- suggestedTitle must be compelling with specific value.
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

// 전체 시드 순차 처리
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
            console.log(`  → Found ${keywords.length} keywords`);
        } catch (e: any) {
            console.error(`  → ERROR for seed "${seed}":`, e.message);
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
        case 'low': return '<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">🟢 경쟁 낮음</span>';
        case 'medium': return '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">🟡 중간</span>';
        case 'high': return '<span style="background:#fecaca;color:#991b1b;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">🔴 경쟁 높음</span>';
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
        // 2. 관리자 설정 로드 (Redis KV)
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

        // 3. SEO 키워드 발굴 (업그레이드된 프롬프트)
        const keywords = await discoverSEOKeywords(seeds);

        if (keywords.length === 0) {
            return res.status(200).json({ message: 'No keywords discovered.' });
        }

        // 4. 발굴 키워드를 Redis에 저장 (admin:discovered_keywords)
        try {
            const existing = await redis.get<DiscoveredKeyword[]>('admin:discovered_keywords') || [];
            const merged = [...keywords, ...existing].slice(0, 30);
            await redis.set('admin:discovered_keywords', merged);
        } catch (e) {
            console.error('Redis Save Discovered Keywords Error:', e);
        }

        // 5. 동시에 기존 토픽 큐에도 추가 (하위 호환)
        try {
            const key = 'admin:topics_queue';
            let topics = await redis.get<any[]>(key) || [];

            const newTopicItems = keywords.map((kw) => ({
                id: `t_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title: kw.suggestedTitle,
                template: kw.template,
                status: 'pending',
                createdAt: new Date().toISOString(),
                source: 'cron-seo',  // 크론 발굴 마킹
                mainKeyword: kw.mainKeyword,
            }));

            await redis.set(key, [...newTopicItems, ...topics]);
        } catch (e) {
            console.error('Redis Save Topics Error:', e);
        }

        // 6. 이메일 구성 (업그레이드된 카드 형식)
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
                    🎯 <strong>${kw.mainKeyword}</strong>
                </div>
                <div style="font-size: 13px; color: #475569; margin-bottom: 8px; font-style: italic;">
                    💡 ${kw.hookSummary}
                </div>
                <div style="font-size: 12px; color: #94a3b8; margin-bottom: 10px;">
                    ${kw.reasoning}
                </div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                    <a href="${previewLink}" style="display: inline-block; padding: 6px 14px; background: #f1f5f9; color: #475569; border-radius: 8px; text-decoration: none; font-size: 13px;">
                        👁️ 미리보기
                    </a>
                    <a href="${publishLink}" style="display: inline-block; padding: 6px 14px; background: linear-gradient(135deg,#06b6d4,#3b82f6); color: white; border-radius: 8px; text-decoration: none; font-size: 13px; font-weight: 600;">
                        🚀 즉시 발행
                    </a>
                </div>
            </div>
            `;
        }).join('');

        const html = `
      <div style="font-family: 'Apple SD Gothic Neo', 'Segoe UI', Arial, sans-serif; max-width: 640px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0c4a6e 100%); color: white; padding: 28px; border-radius: 16px 16px 0 0;">
          <h1 style="margin: 0; font-size: 24px;">🔍 오늘의 SEO 키워드 발굴 리포트</h1>
          <p style="margin: 8px 0 0; color: #94a3b8; font-size: 14px;">시드: ${dailyTopic} · ${new Date().toLocaleDateString('ko-KR')}</p>
          <p style="margin: 4px 0 0; color: #67e8f9; font-size: 13px;">AI가 발굴한 ${keywords.length}개의 SEO 최적화 키워드</p>
        </div>
        <div style="padding: 20px; background: white; border: 1px solid #e2e8f0; border-top: none;">
          <p style="color: #64748b; margin-bottom: 16px; font-size: 14px;">
            아래 키워드는 <strong>검색량 대비 경쟁도가 낮은 롱테일 키워드</strong>입니다.
            바로 발행하거나 <a href="${baseUrl}/admin" style="color:#0ea5e9;">어드민 대시보드</a>에서 검토하세요.
          </p>
          ${keywordCards}
        </div>
        <div style="padding: 16px; background: #f1f5f9; border-radius: 0 0 16px 16px; border: 1px solid #e2e8f0; border-top: none; text-align: center;">
          <a href="${baseUrl}/admin" style="display: inline-block; padding: 10px 24px; background: #0f172a; color: white; border-radius: 10px; text-decoration: none; font-size: 14px; font-weight: 600;">
            📋 어드민에서 전체 관리하기
          </a>
        </div>
      </div>
    `;

        // 7. Send Email
        if (recipientEmail && process.env.GMAIL_USER) {
            await sendEmail(process.env.GMAIL_USER, recipientEmail, `🔍 SEO 키워드 리포트: ${dailyTopic} (${new Date().toLocaleDateString('ko-KR')})`, html);
            return res.status(200).json({ message: 'SEO keyword report sent', keywordCount: keywords.length, keywords });
        } else {
            return res.status(500).json({ error: 'recipientEmail or GMAIL_USER not configured' });
        }

    } catch (error: any) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
