/**
 * Manual publish trigger used by email links.
 *
 * GET /api/trigger-publish?topic=...&template=review&secret=...
 */

import { redis } from './_lib/redis.js';

function getBaseUrl(req: any): string {
  const configured = process.env.APP_URL;
  if (configured) return configured.replace(/\/$/, '');

  const protocol = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers.host;
  return `${protocol}://${host}`.replace(/\/$/, '');
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default async function handler(req: any, res: any) {
  const { topic, template = "review", secret } = req.query;

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || secret !== cronSecret) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (!topic) {
    return res.status(400).json({ error: "Missing topic parameter" });
  }

  const githubToken = process.env.GITHUB_TOKEN;
  const githubRepo = process.env.GITHUB_REPO;

  if (!githubToken || !githubRepo) {
    return res.status(500).json({ error: "GITHUB_TOKEN or GITHUB_REPO not configured" });
  }

  try {
    let recipientEmail = '';
    try {
      const settings = await redis.get<any>('admin:settings');
      if (settings?.recipientEmail) {
        recipientEmail = settings.recipientEmail;
      }
    } catch (error) {
      console.error('[trigger-publish] Failed to load settings:', error);
    }

    const topicText = Array.isArray(topic) ? topic[0] : topic;
    const templateText = Array.isArray(template) ? template[0] : template;
    const baseUrl = getBaseUrl(req);

    const response = await fetch(
      `https://api.github.com/repos/${githubRepo}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${githubToken}`,
          Accept: "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          event_type: "publish_post",
          client_payload: {
            topic: topicText,
            template: templateText,
            recipientEmail,
            app_url: baseUrl,
          },
        }),
      }
    );

    if (response.status !== 204) {
      const errorBody = await response.text();
      console.error("GitHub dispatch failed:", response.status, errorBody);
      return res.status(500).json({
        error: "Failed to trigger publish",
        status: response.status,
        detail: errorBody,
      });
    }

    const safeTopic = htmlEscape(topicText);

    return res.status(200).send(`
      <!DOCTYPE html>
      <html lang="ko">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>기후인사이트 자동 발행 시작</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Apple SD Gothic Neo', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: white;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .card {
            background: rgba(255,255,255,0.06);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255,255,255,0.12);
            border-radius: 16px;
            padding: 40px;
            max-width: 520px;
            text-align: center;
          }
          .emoji { font-size: 48px; margin-bottom: 16px; }
          h1 { font-size: 22px; margin-bottom: 12px; }
          .topic {
            background: rgba(16,185,129,0.16);
            color: #34d399;
            padding: 8px 16px;
            border-radius: 8px;
            margin: 16px 0;
            font-weight: 600;
            line-height: 1.5;
          }
          p { color: #cbd5e1; line-height: 1.6; margin-top: 12px; }
          .note { font-size: 13px; color: #94a3b8; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="emoji">🌱</div>
          <h1>자동 발행이 시작되었습니다</h1>
          <div class="topic">${safeTopic}</div>
          <p>GitHub Actions가 글 생성, 품질 검사, 티스토리 발행을 순서대로 진행합니다.</p>
          <p class="note">완료 또는 실패 결과는 이메일로 발송됩니다.</p>
        </div>
      </body>
      </html>
    `);
  } catch (error: any) {
    console.error("Trigger error:", error);
    return res.status(500).json({ error: error.message });
  }
}
