import { GoogleGenAI } from "@google/genai";
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD,
    },
});

async function sendEmail(to: string, subject: string, html: string) {
    const mailOptions = {
        from: process.env.GMAIL_USER,
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
const GMAIL_USER = process.env.GMAIL_USER;
const DAILY_TOPIC = process.env.DAILY_TOPIC || 'AI Trends';
const CRON_SECRET = process.env.CRON_SECRET;

// Helper to generate titles using Gemini (simplified version of geminiService)
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
            // responseMimeType: "application/json", // Cannot use with tools
            tools: [{ googleSearch: {} }],
        },
    });

    const text = response.text;
    if (!text) return [];

    try {
        // Remove markdown code blocks if present
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText);
    } catch (e) {
        console.error("Failed to parse JSON from Gemini", e);
        // Fallback: try to extract lines that look like titles if JSON fails
        return text.split('\n').filter(line => line.trim().length > 0).slice(0, 5);
    }
}

export default async function handler(req: any, res: any) {
    // 1. Authentication
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${CRON_SECRET}`) {
        // Allow manual testing if needed, or strictly enforce secret
        // For now, let's check if it's a Vercel Cron request
        // Vercel sends the secret in the Authorization header
        if (req.query.key !== CRON_SECRET) { // Fallback for manual testing via query param
            // return res.status(401).json({ error: 'Unauthorized' });
        }
    }

    try {
        // 2. Get Trending Titles
        const titles = await getTrendingTitles(DAILY_TOPIC);

        if (titles.length === 0) {
            return res.status(200).json({ message: 'No titles found.' });
        }

        // 3. Construct Email HTML
        // Use APP_URL env var if set, otherwise fall back to Vercel URL or request host
        let baseUrl = process.env.APP_URL;
        if (!baseUrl) {
            const protocol = req.headers['x-forwarded-proto'] || 'https';
            const host = req.headers.host;
            baseUrl = `${protocol}://${host}`;
        }
        // Ensure no trailing slash
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
          <p style="margin: 8px 0 0; color: #94a3b8;">${DAILY_TOPIC} · ${new Date().toLocaleDateString('ko-KR')}</p>
        </div>
        <div style="padding: 20px; background: white; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
          <p style="color: #64748b; margin-bottom: 16px;">트렌딩 주제 5개입니다. <strong>자동 발행</strong>을 클릭하면 바로 티스토리에 발행됩니다.</p>
          <ul style="list-style-type: none; padding: 0; margin: 0;">
            ${listItems}
          </ul>
        </div>
        <p style="color: #94a3b8; font-size: 11px; margin-top: 16px; text-align: center;">
          AutoBlogByGoogleAI · Automated Publishing Pipeline
        </p>
      </div>
    `;

        // 4. Send Email
        if (GMAIL_USER) {
            await sendEmail(GMAIL_USER, `Daily Blog Ideas: ${DAILY_TOPIC}`, html);
            return res.status(200).json({ message: 'Email sent successfully', titles });
        } else {
            return res.status(500).json({ error: 'GMAIL_USER not configured' });
        }

    } catch (error: any) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
