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

async function getTrendingTitles(topic: string): Promise<string[]> {
    if (!API_KEY) throw new Error("API_KEY not set");
    const ai = new GoogleGenAI({ apiKey: API_KEY });

    const prompt = `
    Find 5 trending news titles related to "${topic}" from the last 24 hours.
    Return ONLY the titles as a JSON array of strings. Do not include markdown formatting like \`\`\`json.
    Example: ["Title 1", "Title 2", ...]
  `;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            tools: [{ googleSearch: {} }],
        },
    });

    const text = response.text;
    if (!text) return [];

    try {
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("Failed to parse JSON from Gemini", e);
        return text.split('\n').filter(line => line.trim().length > 0).slice(0, 5);
    }
}

export default async function handler(req: any, res: any) {
    // 1. Authentication
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${CRON_SECRET}` && req.query.key !== CRON_SECRET) {
        // Allow Vercel cron or manual query param
        // return res.status(401).json({ error: 'Unauthorized' });
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

        // 3. Get Trending Titles
        const titles = await getTrendingTitles(dailyTopic);

        if (titles.length === 0) {
            return res.status(200).json({ message: 'No titles found.' });
        }

        // 4. 추출된 주제를 Admin Queue (Redis)에 저장
        try {
            const key = 'admin:topics_queue';
            let topics = await redis.get<any[]>(key) || [];
            
            const newTopicItems = titles.map((title) => ({
                id: `t_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                title,
                template: 'review',
                status: 'pending',
                createdAt: new Date().toISOString(),
            }));
            
            // 새 항목을 상단에 추가
            await redis.set(key, [...newTopicItems, ...topics]);
        } catch (e) {
            console.error('Redis Save Topics Error:', e);
        }

        // 5. Construct Email HTML
        let baseUrl = process.env.APP_URL;
        if (!baseUrl) {
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            const host = req.headers.host;
            baseUrl = `${protocol}://${host}`;
        }
        baseUrl = baseUrl.replace(/\/$/, '');

        const cronSecret = process.env.CRON_SECRET || '';

        const listItems = titles.map((title, index) => {
            const previewLink = `${baseUrl}/?keyword=${encodeURIComponent(title)}&auto=true`;
            const publishLink = `${baseUrl}/api/trigger-publish?topic=${encodeURIComponent(title)}&secret=${cronSecret}`;
            return `
            <li style="margin-bottom: 16px; padding: 12px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
                <div style="font-size: 16px; font-weight: 600; color: #1e293b; margin-bottom: 8px;">
                    ${index + 1}. ${title}
                </div>
                <div style="display: flex; gap: 8px;">
                    <a href="${previewLink}" style="display: inline-block; padding: 6px 14px; background: #f1f5f9; color: #475569; border-radius: 6px; text-decoration: none; font-size: 13px;">
                        👁️ 미리보기
                    </a>
                    <a href="${publishLink}" style="display: inline-block; padding: 6px 14px; background: #10b981; color: white; border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600;">
                        ▶ 자동 발행
                    </a>
                </div>
            </li>
        `;
        }).join('');

        const html = `
      <div style="font-family: 'Apple SD Gothic Neo', Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #0f172a, #1e293b); color: white; padding: 24px; border-radius: 12px 12px 0 0;">
          <h1 style="margin: 0; font-size: 22px;">📰 오늘의 블로그 주제</h1>
          <p style="margin: 8px 0 0; color: #94a3b8;">${dailyTopic} · ${new Date().toLocaleDateString('ko-KR')}</p>
        </div>
        <div style="padding: 20px; background: white; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #64748b; margin-bottom: 16px;">트렌딩 주제 5개입니다. <strong>자동 발행</strong>을 클릭하거나 <a href="${baseUrl}/admin">어드민 페이지</a>에서 승인하세요.</p>
          <ul style="list-style-type: none; padding: 0; margin: 0;">
            ${listItems}
          </ul>
        </div>
      </div>
    `;

        // 6. Send Email
        if (recipientEmail && process.env.GMAIL_USER) {
            await sendEmail(process.env.GMAIL_USER, recipientEmail, `Daily Blog Ideas: ${dailyTopic}`, html);
            return res.status(200).json({ message: 'Email sent successfully', titles });
        } else {
            return res.status(500).json({ error: 'recipientEmail or GMAIL_USER not configured' });
        }

    } catch (error: any) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
