import { isAuthenticated } from '../_lib/redis.js';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Accept both ADMIN_PASSWORD (from dashboard) and CRON_SECRET (from auto-pilot self-healing)
  const adminPassword = process.env.ADMIN_PASSWORD;
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization;
  const tokenProvided = authHeader ? authHeader.replace("Bearer ", "").trim() : "";
  
  if (tokenProvided !== adminPassword && tokenProvided !== cronSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO || 'neod00/AutoBlogByGoogleAI';

  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "refresh_cookie"
        }),
      }
    );

    if (response.status !== 204) {
        const errorBody = await response.text();
        console.error("GitHub dispatch failed:", response.status, errorBody);
        return res.status(500).json({ error: "Failed to trigger GitHub Actions", detail: errorBody });
    }

    return res.status(200).json({ success: true, message: 'Cookie refresh triggered successfully' });

  } catch (error: any) {
    console.error("Refresh API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}


