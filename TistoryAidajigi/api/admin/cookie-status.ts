import { redis, isAuthenticated } from '../_lib/redis.js';

const KV_KEY = 'admin:cookie_status';

interface CookieStatus {
  status: 'valid' | 'expired' | 'unknown';
  checkedAt: string;
  error: string;
  lastValidAt: string;
}

const DEFAULT_STATUS: CookieStatus = {
  status: 'unknown',
  checkedAt: '',
  error: '',
  lastValidAt: '',
};

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // GET: 荑좏궎 ?곹깭 議고쉶
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      const data = await redis.get<CookieStatus>(KV_KEY) || DEFAULT_STATUS;
      return res.status(200).json({ cookieStatus: data });
    }

    // POST: 荑좏궎 ?곹깭 ?낅뜲?댄듃 (GitHub Actions?먯꽌 ?몄텧)
    if (req.method === 'POST') {
      const { status, error } = req.body || {};

      if (!status || !['valid', 'expired', 'unknown'].includes(status)) {
        return res.status(400).json({ error: 'Invalid status. Must be valid|expired|unknown' });
      }

      const now = new Date().toISOString();
      const current = await redis.get<CookieStatus>(KV_KEY) || DEFAULT_STATUS;

      const updated: CookieStatus = {
        status,
        checkedAt: now,
        error: error || '',
        lastValidAt: status === 'valid' ? now : (current.lastValidAt || ''),
      };

      await redis.set(KV_KEY, updated);
      return res.status(200).json({ success: true, cookieStatus: updated });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err: any) {
    console.error('Cookie Status API Error:', err);
    return res.status(500).json({ error: err.message });
  }
}


