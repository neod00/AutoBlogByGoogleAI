import { isAuthenticated } from '../_lib/redis.js';

export default async function handler(req: any, res: any) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // isAuthenticated checks if the Bearer token matches process.env.ADMIN_PASSWORD
  if (isAuthenticated(req)) {
    return res.status(200).json({ success: true, message: 'Authenticated' });
  } else {
    return res.status(401).json({ error: 'Invalid password' });
  }
}


