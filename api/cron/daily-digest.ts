import { GoogleGenAI } from "@google/genai";
import { sendEmail } from '../_services/emailService';

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
    Return ONLY the titles as a JSON array of strings.
    Example: ["Title 1", "Title 2", ...]
  `;

    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            tools: [{ googleSearch: {} }],
        },
    });

    const text = response.text;
    if (!text) return [];

    try {
        return JSON.parse(text);
    } catch (e) {
        console.error("Failed to parse JSON from Gemini", e);
        return [];
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
        // Assuming the app is hosted at the request's host or a configured domain
        // For Vercel, req.headers.host usually works
        const protocol = req.headers['x-forwarded-proto'] || 'http';
        const host = req.headers.host;
        const baseUrl = `${protocol}://${host}`;

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
