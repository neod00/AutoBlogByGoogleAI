import { redis, isAuthenticated } from '../_lib/redis.js';

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
    // Redis?먯꽌 愿由ъ옄 ?ㅼ젙(?대찓???? ?쎌뼱?ㅺ린
    let recipientEmail = '';
    const settings = await redis.get<any>('admin:settings');
    if (settings && settings.recipientEmail) {
      recipientEmail = settings.recipientEmail;
    }

    // 1. ?몃━嫄?GitHub Actions
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
          event_type: "dailyengtips_publish_post",
          client_payload: {
            topic: topic,
            template: template,
            publish_id: id || '', // 異뷀썑 ?뱁썒?쇰줈 ?깃났 ?꾨즺 泥섎━ ???ъ슜 媛€??            
            app_url: process.env.APP_URL || '',
            recipientEmail: recipientEmail,
          },
        }),
      }
    );

    if (response.status !== 204) {
        const errorBody = await response.text();
        console.error("GitHub dispatch failed:", response.status, errorBody);
        return res.status(500).json({ error: "Failed to trigger GitHub Actions", detail: errorBody });
    }

    // 2. 留뚯빟 DB(KV)???덈뒗 二쇱젣??ㅻ㈃ ?곹깭瑜?"publishing"?쇰줈 ?낅뜲?댄듃
    if (id) {
        const key = 'admin:topics_queue';
        let topics = await redis.get<any[]>(key) || [];
        const index = topics.findIndex(t => t.id === id);
        if (index !== -1) {
            topics[index].status = 'publishing';
            await redis.set(key, topics);
        }
        // 통계용/오토파일럿 방지용 마지막 발행 시간 업데이트
        await redis.set('admin:last_posted_at', new Date().toISOString());
    }

    return res.status(200).json({ success: true, message: 'Publishing triggered successfully' });

  } catch (error: any) {
    console.error("Publish API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}


