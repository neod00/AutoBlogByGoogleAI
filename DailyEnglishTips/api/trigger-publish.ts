/**
 * /api/trigger-publish.ts
 * =======================
 * ?대찓??留곹겕 ?대┃ ??GitHub Actions repository_dispatch ?몃━嫄? *
 * GET /api/trigger-publish?topic=二쇱젣&secret=xxx
 *
 * ?꾩슂???섍꼍蹂??
 * - CRON_SECRET: ?몄쬆 ?쒗겕由? * - GITHUB_TOKEN: GitHub Personal Access Token (repo scope)
 * - GITHUB_REPO: owner/repo (?? username/AutoBlogByGoogleAI)
 */

export default async function handler(req: any, res: any) {
  const { topic, template = "review", secret } = req.query;

  // ?몄쬆 ?뺤씤
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
    const { redis } = require('./_lib/redis.js');
    let recipientEmail = '';
    try {
      const settings = await redis.get('admin:settings');
      if (settings && settings.recipientEmail) {
        recipientEmail = settings.recipientEmail;
      }
    } catch(e) {
      console.error(e);
    }

    // GitHub repository_dispatch ?대깽???꾩넚
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
            topic: decodeURIComponent(topic as string),
            template: template as string,
            recipientEmail: recipientEmail,
          },
        }),
      }
    );

    if (response.status === 204) {
      // ?깃났 ???ъ슜?먯뿉寃??뺤씤 ?섏씠吏 ?꾩넚
      return res.status(200).send(`
        <!DOCTYPE html>
        <html lang="ko">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1">
          <title>釉붾줈洹??먮룞 諛쒗뻾 ?쒖옉</title>
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
            <h1>?먮룞 諛쒗뻾???쒖옉?섏뿀?듬땲??</h1>
            <div class="topic">${decodeURIComponent(topic as string)}</div>
            <p>AI媛 釉붾줈洹?湲???앹꽦?섍퀬 ?곗뒪?좊━??諛쒗뻾?⑸땲??<br>
               ?꾨즺?섎㈃ ?대찓?쇰줈 寃곌낵瑜??뚮젮?쒕┰?덈떎.</p>
            <p class="note">蹂댄넻 3~5遺??뺣룄 ?뚯슂?⑸땲??</p>
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


