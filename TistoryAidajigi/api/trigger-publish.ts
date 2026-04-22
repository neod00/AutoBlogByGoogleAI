/**
 * /api/trigger-publish.ts
 * =======================
 * ?´ë©”??ë§í¬ ?´ë¦­ ??GitHub Actions repository_dispatch ?¸ë¦¬ê±? *
 * GET /api/trigger-publish?topic=ì£¼ì œ&secret=xxx
 *
 * ?„ìš”???˜ê²½ë³€??
 * - CRON_SECRET: ?¸ì¦ ?œí¬ë¦? * - GITHUB_TOKEN: GitHub Personal Access Token (repo scope)
 * - GITHUB_REPO: owner/repo (?? username/AutoBlogByGoogleAI)
 */

export default async function handler(req: any, res: any) {
  const { topic, template = "review", secret } = req.query;

  // ?¸ì¦ ?•ì¸
  const CRON_SECRET = process.env.CRON_SECRET;
  if (!CRON_SECRET || secret !== CRON_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!topic) {
    return res.status(400).json({ error: "Missing topic parameter" });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_REPO = process.env.GITHUB_REPO; // e.g. "username/AutoBlogByGoogleAI"

  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    return res.status(500).json({ error: "GITHUB_TOKEN or GITHUB_REPO not configured" });
  }

  try {
    const { redis } = require('./_lib/redis.ts');
    let recipientEmail = '';
    try {
      const settings = await redis.get('admin:settings');
      if (settings && settings.recipientEmail) {
        recipientEmail = settings.recipientEmail;
      }
    } catch(e) {
      console.error(e);
    }

    // GitHub repository_dispatch ?´ë²¤???„ì†¡
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
            topic: decodeURIComponent(topic as string),
            template: template as string,
            recipientEmail: recipientEmail,
          },
        }),
      }
    );

    if (response.status === 204) {
      // ?±ê³µ ???¬ìš©?ì—ê²??•ì¸ ?˜ì´ì§€ ?„ì†¡
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>ë¸”ë¡œê·??ë™ ë°œí–‰ ?œì‘</title>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
              font-family: 'Apple SD Gothic Neo', -apple-system, sans-serif;
              background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
              color: white;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            .card {
              background: rgba(255,255,255,0.05);
              backdrop-filter: blur(12px);
              border: 1px solid rgba(255,255,255,0.1);
              border-radius: 16px;
              padding: 40px;
              max-width: 480px;
              text-align: center;
            }
            .emoji { font-size: 48px; margin-bottom: 16px; }
            h1 { font-size: 22px; margin-bottom: 12px; }
            .topic {
              background: rgba(16,185,129,0.15);
              color: #34d399;
              padding: 8px 16px;
              border-radius: 8px;
              margin: 16px 0;
              font-weight: 600;
            }
            p { color: #94a3b8; line-height: 1.6; margin-top: 12px; }
            .note { font-size: 13px; color: #64748b; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="emoji">??</div>
            <h1>?ë™ ë°œí–‰???œì‘?˜ì—ˆ?µë‹ˆ??</h1>
            <div class="topic">${decodeURIComponent(topic as string)}</div>
            <p>AIê°€ ë¸”ë¡œê·?ê¸€???ì„±?˜ê³  ?°ìŠ¤? ë¦¬??ë°œí–‰?©ë‹ˆ??<br>
               ?„ë£Œ?˜ë©´ ?´ë©”?¼ë¡œ ê²°ê³¼ë¥??Œë ¤?œë¦½?ˆë‹¤.</p>
            <p class="note">ë³´í†µ 3~5ë¶??•ë„ ?Œìš”?©ë‹ˆ??</p>
          </div>
        </body>
        </html>
      `);
    } else {
      const errorBody = await response.text();
      console.error("GitHub dispatch failed:", response.status, errorBody);
      return res.status(500).json({
        error: "Failed to trigger publish",
        status: response.status,
        detail: errorBody,
      });
    }
  } catch (error: any) {
    console.error("Trigger error:", error);
    return res.status(500).json({ error: error.message });
  }
}

