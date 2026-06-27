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
  category: string;
  reasoning: string;
  status: 'discovered' | 'approved' | 'dismissed';
  discoveredAt: string;
}

interface SeedRefreshResult {
  dailyTopic: string;
  refreshed: boolean;
  reason: string;
  seeds: string[];
  estimatedGeminiCalls: number;
}

const DEFAULT_DAILY_TOPIC = '최신 AI 기술 및 뉴스';
const AIDAJIGI_DEFAULT_SEEDS = [
  'ChatGPT 활용법',
  '생성형 AI 도구',
  'AI 모델 비교',
  'AI 에이전트',
  '업무 자동화 AI',
  '기업 AI 전환',
  'AI 정책 규제',
  '프롬프트 엔지니어링',
  'AI 이미지 생성',
  'AI 영상 생성',
  'LLM 활용 사례',
  'AI 생산성 도구',
];

// 무료 API Rate Limit 방어: 시드별 순차 호출 + 딜레이
const MAX_SEEDS_PER_RUN = 5;
const AUTO_REFRESH_SEEDS = process.env.KEYWORD_AUTO_REFRESH_SEEDS !== 'false';
const SEED_REFRESH_INTERVAL_DAYS = Number(process.env.KEYWORD_SEED_REFRESH_INTERVAL_DAYS || 7);
const AUTO_REFRESH_SEED_COUNT = Number(process.env.KEYWORD_AUTO_REFRESH_SEED_COUNT || 8);
const SEED_REFRESH_REDIS_KEY = 'admin:last_seed_refresh_at';
const DELAY_BETWEEN_CALLS_MS = 3000;

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateContentWithRetry(ai: any, params: any, maxRetries = 2) {
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
            console.warn(`[daily-digest] Gemini retry in ${waitTime}ms. Attempt ${attempt}/${maxRetries}`);
            await delay(waitTime);
        }
    }
}

function parseJsonArray(text: string): any[] {
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleanText);
    if (!Array.isArray(parsed)) {
        throw new Error('Gemini response is not a JSON array');
    }
    return parsed;
}

function parseSeedList(topic: string): string[] {
    return String(topic || '')
        .split(',')
        .map(seed => seed.trim())
        .filter(Boolean);
}

function uniqueSeedList(seeds: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const seed of seeds) {
        const trimmed = String(seed || '').trim();
        const key = trimmed.replace(/\s+/g, '').toLowerCase();
        if (!trimmed || seen.has(key)) continue;
        seen.add(key);
        result.push(trimmed);
    }

    return result;
}

async function refreshSeedTopicIfDue(currentDailyTopic: string, settings: any): Promise<SeedRefreshResult> {
    const fallbackSeeds = parseSeedList(currentDailyTopic);
    const fallbackTopic = fallbackSeeds.length > 0 ? fallbackSeeds.join(', ') : DEFAULT_DAILY_TOPIC;

    if (!AUTO_REFRESH_SEEDS) {
        return {
            dailyTopic: fallbackTopic,
            refreshed: false,
            reason: 'Auto seed refresh disabled.',
            seeds: fallbackSeeds,
            estimatedGeminiCalls: 0,
        };
    }

    if (!API_KEY) {
        return {
            dailyTopic: fallbackTopic,
            refreshed: false,
            reason: 'API key not configured.',
            seeds: fallbackSeeds,
            estimatedGeminiCalls: 0,
        };
    }

    const now = new Date();
    const lastRefresh = await redis.get<string>(SEED_REFRESH_REDIS_KEY);
    if (lastRefresh) {
        const elapsedDays = (now.getTime() - new Date(lastRefresh).getTime()) / 86_400_000;
        if (elapsedDays < SEED_REFRESH_INTERVAL_DAYS) {
            return {
                dailyTopic: fallbackTopic,
                refreshed: false,
                reason: `Next refresh in ${(SEED_REFRESH_INTERVAL_DAYS - elapsedDays).toFixed(1)} days.`,
                seeds: fallbackSeeds,
                estimatedGeminiCalls: 0,
            };
        }
    }

    const ai = new GoogleGenAI({ apiKey: API_KEY });
    const today = now.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
    const currentSeeds = fallbackSeeds.length > 0 ? fallbackSeeds : AIDAJIGI_DEFAULT_SEEDS;

    const prompt = `오늘은 ${today}입니다.
당신은 aidajigi.tistory.com 블로그의 SEO 편집장입니다.

블로그 성격:
- AI를 처음 접하는 직장인과 실무자를 위한 쉬운 설명
- ChatGPT, Gemini, Claude 등 AI 모델 비교와 사용법
- 생성형 AI, AI 에이전트, 업무 자동화, 기업 AI 전환, AI 정책/표준
- 단순 뉴스 요약보다 독자가 바로 실행할 수 있는 가이드와 비교 분석을 선호

현재 SEO 시드 키워드:
${currentSeeds.join(', ')}

기본 시드 풀:
${AIDAJIGI_DEFAULT_SEEDS.join(', ')}

임무:
Google Search 결과를 근거로 앞으로 1주일 동안 Aidajigi 자동 발행에 사용할 SEO 시드 키워드 ${AUTO_REFRESH_SEED_COUNT}개를 추천하세요.

추천 기준:
1. AI 모델 리뷰, 생성형 AI 활용법, AI 활용 가이드처럼 현재 부족한 카테고리를 우선합니다.
2. 기업 AI 전환(AX)은 이미 글이 많으므로 꼭 필요한 최신 이슈가 아니면 비중을 낮춥니다.
3. 최근 6~12개월 안에 실제 검색 수요나 제품/정책/산업 변화가 확인되어야 합니다.
4. 너무 넓은 단어보다 2~5단어의 한국어 시드 키워드를 추천합니다.
5. 연예, 단순 가십, 공포 마케팅, 블로그 주제와 무관한 트래픽성 키워드는 제외합니다.

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "keyword": "추천 시드 키워드",
    "category": "AI 뉴스 & 트렌드 | AI 모델 리뷰 | 생성형 AI | AI 기업 동향 | 기업 AI 전환(AX) | AI 정책 & 표준 | AI 활용 가이드",
    "reason": "추천 이유 한 문장"
  }
]

IMPORTANT:
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- 모든 내용은 한국어로 작성합니다.`;

    try {
        console.log('[daily-digest] Refreshing Aidajigi SEO seed topic list...');
        const response = await generateContentWithRetry(ai, {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] },
        }, 1);

        const parsed = parseJsonArray(response.text || '');
        const refreshedSeeds = uniqueSeedList(
            parsed
                .map((item: any) => item?.keyword)
                .filter((seed: any) => typeof seed === 'string')
        ).slice(0, AUTO_REFRESH_SEED_COUNT);

        if (refreshedSeeds.length < Math.min(4, AUTO_REFRESH_SEED_COUNT)) {
            return {
                dailyTopic: fallbackTopic,
                refreshed: false,
                reason: 'Gemini returned too few usable seeds.',
                seeds: fallbackSeeds,
                estimatedGeminiCalls: 1,
            };
        }

        const refreshedTopic = refreshedSeeds.join(', ');
        await redis.set('admin:settings', { ...(settings || {}), dailyTopic: refreshedTopic });
        await redis.set(SEED_REFRESH_REDIS_KEY, now.toISOString());

        return {
            dailyTopic: refreshedTopic,
            refreshed: true,
            reason: 'Seed topic list refreshed.',
            seeds: refreshedSeeds,
            estimatedGeminiCalls: 1,
        };
    } catch (error: any) {
        console.error('[daily-digest] Seed refresh failed:', error.message);
        return {
            dailyTopic: fallbackTopic,
            refreshed: false,
            reason: `Seed refresh failed: ${error.message}`,
            seeds: fallbackSeeds,
            estimatedGeminiCalls: 1,
        };
    }
}

// 단일 시드 발굴
async function discoverForSingleSeed(ai: any, seed: string): Promise<DiscoveredKeyword[]> {
    const today = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });

    // [Step 1] 팩트 체커 (구글 검색 전용)
    const factPrompt = `명심해라. 오늘은 ${today} 이다. 너의 과거 기억은 틀렸을 확률이 높다.
임무: 당신은 팩트체크 전문 AI입니다. 제공된 주제 "${seed}"에 대해 구글 검색 툴을 사용하여 가장 최신의 검증된 사실(현재 시점 기준)만 조사하십시오.

검색 및 요약 기준:
1. 이 주제와 관련해 최근 6~12개월 사이에 새롭게 바뀐 사실, 최신 발표, 일정 변경, 최신 트렌드, 또는 대중의 주요 이슈가 있는지 검색하세요.
2. 당신의 과거 학습 데이터(기억)에 의존하지 마십시오. 오직 검색 결과에서 확인된 내용만 요약해야 합니다.
3. 분야에 상관없이 최신 핵심 정보 3~5가지를 한글 불릿 포인트(Bullet point)로 요약하세요.
4. 검색 결과가 명확하지 않거나 최신 정보가 없다면, "최신 변동 사항 없음"라고 솔직하게 명시하세요.`;

    console.log(`  → [Step 1] Fact checking "${seed}"...`);
    const factResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: factPrompt,
        config: { tools: [{ googleSearch: {} }] },
    });
    
    const factText = factResponse.text || "최신 정보 없음";

    // [Step 2] SEO 기획자 (JSON 포맷팅 전용)
    const generatePrompt = `오늘은 ${today} 입니다. 당신은 30년 경력의 베테랑 SEO 전략가입니다.
아래 제공된 [최신 팩트체크 결과]만을 절대적인 진리로 삼아, "${seed}" 주제의 SEO 최적화 블로그 키워드 기회를 딱 2개 발굴하세요. 절대 너의 과거 기억(환각)을 섞어 쓰지 마세요.

[최신 팩트체크 결과]
${factText}

발굴 기준:
1. 위 팩트체크 결과를 철저히 반영하여 현재 시점에 가장 유효한 키워드와 정보를 뽑을 것.
2. 경쟁도가 낮고 구체적인 롱테일 정보탐색형(Information-seeking) 키워드일 것.
3. 체류시간(Dwell time)이 높을 수 있는 구체적이고 실용적인 가이드, 분석, 비교 형식을 띌 것.

[중요: 카테고리 분산 규칙]
블로그에는 다음 카테고리가 있습니다:
- AI 뉴스 & 트렌드: 속보성 AI 뉴스 분석
- AI 모델 리뷰: 특정 AI 모델/서비스 사용기, 벤치마크 비교
- 생성형 AI: 이미지/텍스트/영상 생성 AI 활용법
- AI 기업 동향: 빅테크 전략 분석, 스타트업 소식
- 기업 AI 전환(AX): 기업의 AI 도입 전략, 거버넌스
- AI 정책 & 표준: 법률, 규제, 표준화 동향
- AI 활용 가이드: 실무자를 위한 단계별 가이드, 프롬프트 팁

발굴하는 2개의 키워드는 **서로 다른 카테고리**에 해당하도록 하세요.
특히 "기업 AI 전환(AX)" 카테고리는 이미 글이 많으므로, 가능하면 "AI 모델 리뷰", "AI 활용 가이드", "생성형 AI" 등 다른 카테고리를 우선 선택하세요.

[중요: 제목 규칙]
- 제목에 "내년부터", "올해부터" 같은 상대적 시간 표현은 절대 금지.
- "~의 서막", "~로 진화하다", "~ 완벽 가이드" 같은 AI스러운 제목 금지.
- "20XX년, ~" 패턴 (연도 + 쉼표/콜론) 금지.

STRICT OUTPUT FORMAT (JSON array, no markdown fences):
[
  {
    "seed": "${seed}",
    "mainKeyword": "SEO-optimized main keyword in Korean (long-tail, 10+ chars)",
    "subKeywords": ["sub keyword 1", "sub keyword 2", "sub keyword 3"],
    "suggestedTitle": "Click-worthy blog title in Korean matching the verified facts",
    "hookSummary": "One-sentence hook that makes the reader NEED to click (Korean)",
    "searchIntent": "one of: 정보탐색, 비교분석, 방법가이드, 트렌드분석, 심층해설",
    "difficulty": "one of: low, medium, high",
    "template": "one of: default, review, interview, qa, investment",
    "category": "one of: AI 뉴스 & 트렌드, AI 모델 리뷰, 생성형 AI, AI 기업 동향, 기업 AI 전환(AX), AI 정책 & 표준, AI 활용 가이드",
    "reasoning": "One sentence explaining WHY this keyword is good based strictly on the facts (Korean)"
  }
]

IMPORTANT:
- Output ONLY a valid JSON array. No markdown, no explanation, no code fences.
- All text content must be in Korean.
- suggestedTitle must be compelling and FACTUAL based on the facts provided.
- 2개의 키워드는 반드시 서로 다른 category 값을 가져야 합니다.
- 제목에 연도(예: 2026년)를 넣을지 여부는 글의 성격에 따라 판단하세요:
  ✅ 연도를 넣어야 하는 경우: 정책/법률 변경, 연간 트렌드 전망, 시즌별 제품 비교 등 시의성이 핵심인 글
  ❌ 연도를 넣지 말아야 하는 경우: 개념 설명, 원리 해설, 일반적인 방법론 가이드 등 시간에 구애받지 않는 에버그린(Evergreen) 콘텐츠`;

    console.log(`  → [Step 2] Generating JSON for "${seed}"...`);
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
            searchIntent: item.searchIntent || '정보탐색',
            difficulty: item.difficulty || 'medium',
            template: item.template || 'default',
            category: item.category || '기타',
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
        let dailyTopic = process.env.DAILY_TOPIC || DEFAULT_DAILY_TOPIC;
        let settings: any = {};

        try {
            const loadedSettings = await redis.get<any>('admin:settings');
            if (loadedSettings) {
                settings = loadedSettings;
                if (settings.recipientEmail) recipientEmail = settings.recipientEmail;
                if (settings.dailyTopic) dailyTopic = settings.dailyTopic;
            }
        } catch (e) {
            console.error('Redis Load Settings Error:', e);
        }

        const seedRefresh = await refreshSeedTopicIfDue(dailyTopic, settings);
        dailyTopic = seedRefresh.dailyTopic;
        console.log(`[daily-digest] Seed refresh: ${seedRefresh.refreshed ? 'refreshed' : 'skipped'} (${seedRefresh.reason})`);

        const seeds = parseSeedList(dailyTopic);
        const selectedSeedCount = Math.min(seeds.length, MAX_SEEDS_PER_RUN);
        const estimatedGeminiCalls = seedRefresh.estimatedGeminiCalls + selectedSeedCount * 2;

        // 3. SEO 키워드 발굴 (업그레이드된 프롬프트)
        const keywords = await discoverSEOKeywords(seeds);

        if (keywords.length === 0) {
            return res.status(200).json({
                message: 'No keywords discovered.',
                seedRefresh,
                estimatedGeminiCalls,
            });
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
            return res.status(200).json({
                message: 'SEO keyword report sent',
                keywordCount: keywords.length,
                seedRefresh,
                estimatedGeminiCalls,
                keywords,
            });
        } else {
            return res.status(500).json({ error: 'recipientEmail or GMAIL_USER not configured' });
        }

    } catch (error: any) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
