import { redis, isAuthenticated } from '../_lib/redis.ts';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { id, topic, template = 'review' } = req.body || {};

  if (!topic) {
    return res.status(400).json({ error: 'Topic is required' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO; 

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return res.status(500).json({ error: 'GITHUB_TOKEN or GITHUB_REPO not configured' });
  }

  try {
    // Redis?êÏÑú Í¥ÄÎ¶¨Ïûê ?§Ï†ï(?¥Î©î???? ?ΩÏñ¥?§Í∏∞
    let recipientEmail = '';
    const settings = await redis.get<any>('admin:settings');
    if (settings && settings.recipientEmail) {
      recipientEmail = settings.recipientEmail;
    }

    // 1. ?∏Î¶¨Í±?GitHub Actions
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
          event_type: "aidajigi_publish_post",
          client_payload: {
            topic: topic,
            template: template,
            publish_id: id || '', // Ï∂îÌõÑ ?πÌõÖ?ºÎ°ú ?±Í≥µ ?ÑÎ£å Ï≤òÎ¶¨ ???¨Ïö© Í∞Ä??            recipientEmail: recipientEmail,
          },
        }),
      }
    );

    if (response.status !== 204) {
        const errorBody = await response.text();
        console.error("GitHub dispatch failed:", response.status, errorBody);
        return res.status(500).json({ error: "Failed to trigger GitHub Actions", detail: errorBody });
    }

    // 2. ÎßåÏïΩ DB(KV)???àÎäî Ï£ºÏ†ú?Ä?§Î©¥ ?ÅÌÉúÎ•?"publishing"?ºÎ°ú ?ÖÎç∞?¥Ìä∏
    if (id) {
        const key = 'admin:topics_queue';
        let topics = await redis.get<any[]>(key) || [];
        const index = topics.findIndex(t => t.id === id);
        if (index !== -1) {
            topics[index].status = 'publishing';
            await redis.set(key, topics);
        }
    }

    return res.status(200).json({ success: true, message: 'Publishing triggered successfully' });

  } catch (error: any) {
    console.error("Publish API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}

