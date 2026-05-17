import { redis, isAuthenticated } from '../_lib/redis.js';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const key = 'admin:settings';

  try {
    // GET: ?ㅼ젙 議고쉶
    if (req.method === 'GET') {
      const settings = await redis.get<any>(key) || {};
      
      // Default 媛?癒몄? (理쒖큹 ?묎렐 ??
      return res.status(200).json({ 
        settings: {
          recipientEmail: settings.recipientEmail || process.env.GMAIL_USER || '',
          dailyTopic: settings.dailyTopic || process.env.DAILY_TOPIC || '최신 AI 기술 및 뉴스',
          blogUrl: settings.blogUrl || 'https://aidajigi.tistory.com',
          ...settings
        }
      });
    }

    // PUT: ?ㅼ젙 ?섏젙
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


