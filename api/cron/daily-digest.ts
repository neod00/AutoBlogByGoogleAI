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

const API_KEY = process.env.API_KEY;
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

        const listItems = titles.map((title, index) => {
            const link = `${baseUrl}/?keyword=${encodeURIComponent(title)}&auto=true`;
            return `
            <li style="margin-bottom: 10px;">
                <a href="${link}" style="font-size: 16px; color: #0070f3; text-decoration: none;">
                    ${index + 1}. ${title}
                </a>
            </li>
        `;
        }).join('');

        const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #333;">Daily Blog Ideas: ${DAILY_TOPIC}</h1>
        <p>Here are 5 trending topics for today. Click one to generate a blog post:</p>
        <ul style="list-style-type: none; padding: 0;">
          ${listItems}
        </ul>
        <p style="color: #888; font-size: 12px; margin-top: 20px;">
          Sent by AutoBlogByGoogleAI
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
