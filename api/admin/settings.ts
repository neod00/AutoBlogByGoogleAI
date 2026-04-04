import { redis, isAuthenticated } from '../_lib/redis.js';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = 'admin:settings';

  try {
    // GET: 설정 조회
    if (req.method === 'GET') {
      const settings = await redis.get<any>(key) || {};
      
      // Default 값 머지 (최초 접근 시)
      return res.status(200).json({ 
        settings: {
          recipientEmail: settings.recipientEmail || process.env.GMAIL_USER || '',
          dailyTopic: settings.dailyTopic || process.env.DAILY_TOPIC || 'AI Trends',
          blogUrl: settings.blogUrl || 'https://climate-insight.tistory.com',
          ...settings
        }
      });
    }

    // PUT: 설정 수정
    if (req.method === 'PUT') {
      const currentSettings = await redis.get<any>(key) || {};
      const newSettings = { ...currentSettings, ...(req.body || {}) };
      
      await redis.set(key, newSettings);
      return res.status(200).json({ success: true, settings: newSettings });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    console.error("Settings API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
