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

    try {
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

        // 4. Probability Logic (Targeting ~0.75 posts/day)
        // We run this every 2 hours (12 times/day).
        // To get 0.75 posts/day, total probability per day should be 0.75.
        // Per run probability = 0.75 / 12 = 0.0625 (6.25%)
        
        let probability = 0.06; // Default low probability for "random" feel

        if (hoursSinceLastRun < 12) {
            probability = 0.01; // Very low if recently posted
        } else if (hoursSinceLastRun > 48) {
            probability = 1.0;  // Force post if more than 2 days passed
        } else if (hoursSinceLastRun > 36) {
            probability = 0.5;  // High chance if 1.5 days passed
        } else if (hoursSinceLastRun > 24) {
            probability = 0.2;  // Decent chance if 1 day passed
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
            console.log('[AutoPilot] No pending topics in queue. Discovery needed?');
            // Optional: Could trigger discovery here if empty, 
            // but daily-digest already does it.
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
                    },
                }),
            }
        );

        if (response.status !== 204) {
            const error = await response.text();
            throw new Error(`GitHub trigger failed: ${error}`);
        }

        // 7. Update State
        // Mark topic as "processing" or "approved" (though autopilot bypasses approval)
        const updatedTopics = topics.map(t => 
            t.id === pendingTopic.id ? { ...t, status: 'published', publishedAt: now.toISOString() } : t
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
