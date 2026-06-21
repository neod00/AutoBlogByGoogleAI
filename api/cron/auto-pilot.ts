import { redis } from '../_lib/redis.js';

const CRON_SECRET = process.env.CRON_SECRET;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const APP_URL = process.env.APP_URL || '';

export default async function handler(req: any, res: any) {
    // 1. Authentication
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${CRON_SECRET}` && req.query.key !== CRON_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    console.log('[AutoPilot] Starting check...');

    // Active hours check (KST 09:00 ~ 23:59 only).
    // This keeps KakaoTalk 2FA requests out of overnight hours.
    const nowKST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const hourKST = nowKST.getHours();
    if (hourKST < 9 || hourKST >= 24) {
        console.log(`[AutoPilot] Outside active hours (KST ${hourKST}:00). Skipping to avoid nighttime KakaoTalk alerts.`);
        return res.status(200).json({
            message: 'Outside active hours (KST 09:00-23:59)',
            currentHourKST: hourKST,
        });
    }
    console.log(`[AutoPilot] Active hours OK (KST ${hourKST}:00)`);

    try {
        // Log cookie state for observability. Publishing still proceeds because
        // the Selenium publisher can refresh login and request Kakao approval.
        const cookieStatus = await redis.get<any>('admin:cookie_status') || {};
        console.log(`[AutoPilot] Cookie status: ${cookieStatus.status || 'not set'}; proceeding if publish probability passes.`);

        // 2. Load Settings
        const settings = await redis.get<any>('admin:settings') || {};
        const isAutoPilotEnabled = settings.autoPilot === true;
        
        if (!isAutoPilotEnabled) {
            console.log('[AutoPilot] Disabled in settings. Skipping.');
            return res.status(200).json({ message: 'AutoPilot is disabled' });
        }

        // 3. Time Check
        const lastRun = await redis.get<string>('admin:last_posted_at');
        const lastRunDate = lastRun ? new Date(lastRun) : new Date(0);
        const now = new Date();
        const hoursSinceLastRun = (now.getTime() - lastRunDate.getTime()) / (1000 * 60 * 60);

        console.log(`[AutoPilot] Hours since last run: ${hoursSinceLastRun.toFixed(2)}`);

        // 4. Probability Logic
        // Target: roughly 1 post every 2 days, with a forced attempt after 48h.
        let probability = 0.01;

        if (hoursSinceLastRun > 48) {
            probability = 1.0;
        } else if (hoursSinceLastRun > 36) {
            probability = 0.25;
        } else if (hoursSinceLastRun > 24) {
            probability = 0.10;
        } else if (hoursSinceLastRun > 12) {
            probability = 0.05;
        }

        const roll = Math.random();
        const shouldTrigger = roll < probability;

        console.log(`[AutoPilot] Probability: ${probability}, Roll: ${roll.toFixed(4)}, Should Trigger: ${shouldTrigger}`);

        if (!shouldTrigger) {
            return res.status(200).json({ 
                message: 'Skipping this run based on probability',
                stats: { hoursSinceLastRun, probability, roll }
            });
        }

        // 5. Pick Topic from Queue
        const topicsKey = 'admin:topics_queue';
        const topics = await redis.get<any[]>(topicsKey) || [];
        const pendingTopic = topics.find(t => t.status === 'pending');

        if (!pendingTopic) {
            console.log('[AutoPilot] No pending topics in queue.');
            // Cost guard: do not call Gemini from the 2-hour autopilot loop.
            // daily-digest is responsible for refilling the queue when it is low.
            return res.status(200).json({ message: 'No pending topics found' });
        }

        console.log(`[AutoPilot] Selected topic: "${pendingTopic.title}"`);

        // 6. Trigger Publication
        if (!GITHUB_TOKEN || !GITHUB_REPO) {
            throw new Error('GitHub configuration missing');
        }

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
                    event_type: "publish_post",
                    client_payload: {
                        topic: pendingTopic.title,
                        template: pendingTopic.template || 'review',
                        recipientEmail: settings.recipientEmail || '',
                        publish_id: pendingTopic.id,
                        app_url: APP_URL,
                    },
                }),
            }
        );

        if (response.status !== 204) {
            const error = await response.text();
            throw new Error(`GitHub trigger failed: ${error}`);
        }

        // 7. Update State
        const updatedTopics = topics.map(t => 
            t.id === pendingTopic.id ? { ...t, status: 'publishing', publishedAt: now.toISOString() } : t
        );
        await redis.set(topicsKey, updatedTopics);
        await redis.set('admin:last_posted_at', now.toISOString());

        console.log('[AutoPilot] Successfully triggered publication!');

        return res.status(200).json({ 
            message: 'AutoPilot triggered publication',
            topic: pendingTopic.title,
            stats: { hoursSinceLastRun, probability, roll }
        });

    } catch (error: any) {
        console.error('[AutoPilot] Error:', error);
        return res.status(500).json({ error: error.message });
    }
}
