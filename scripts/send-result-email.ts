#!/usr/bin/env npx tsx
/**
 * send-result-email.ts
 * ====================
 * GitHub Actions에서 발행 결과를 이메일로 전송합니다.
 * /tmp/publish_result.json 파일을 읽어서 결과를 포맷합니다.
 */

import nodemailer from "nodemailer";
import { readFileSync, existsSync } from "fs";

const GMAIL_USER = process.env.GMAIL_USER || "";
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || "";

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error("GMAIL_USER or GMAIL_APP_PASSWORD not set, skipping email");
  process.exit(0);
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
});

interface PublishResult {
  success: boolean;
  url: string;
  error: string;
  title: string;
  category: string;
}

async function main() {
  // 발행 결과 읽기
  let result: PublishResult;
  const resultPath = "/tmp/publish_result.json";

  if (existsSync(resultPath)) {
    result = JSON.parse(readFileSync(resultPath, "utf-8"));
  } else {
    result = {
      success: false,
      url: "",
      error: "Result file not found",
      title: "Unknown",
      category: "Unknown",
    };
  }

  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const statusEmoji = result.success ? "✅" : "❌";
  const statusText = result.success ? "발행 성공" : "발행 실패";

  const html = `
    <div style="font-family: 'Apple SD Gothic Neo', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: ${result.success ? "linear-gradient(135deg, #10b981, #059669)" : "linear-gradient(135deg, #ef4444, #dc2626)"}; 
                  color: white; padding: 24px; border-radius: 12px; margin-bottom: 20px;">
        <h1 style="margin: 0; font-size: 24px;">${statusEmoji} 블로그 자동 발행 ${statusText}</h1>
        <p style="margin: 8px 0 0; opacity: 0.9;">${now}</p>
      </div>
      
      <div style="background: #f8fafc; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #64748b; width: 80px;">제목</td>
            <td style="padding: 8px 0; font-weight: 600;">${result.title}</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #64748b;">카테고리</td>
            <td style="padding: 8px 0;">${result.category}</td>
          </tr>
          ${result.url ? `
          <tr>
            <td style="padding: 8px 0; color: #64748b;">URL</td>
            <td style="padding: 8px 0;">
              <a href="${result.url}" style="color: #0ea5e9; text-decoration: underline;">${result.url}</a>
            </td>
          </tr>` : ""}
          ${result.error ? `
          <tr>
            <td style="padding: 8px 0; color: #64748b;">오류</td>
            <td style="padding: 8px 0; color: #ef4444;">${result.error}</td>
          </tr>` : ""}
        </table>
      </div>

      <p style="color: #94a3b8; font-size: 12px; margin-top: 20px; text-align: center;">
        AutoBlogByGoogleAI · Automated Publishing Pipeline
      </p>
    </div>
  `;

  const subject = result.success
    ? `✅ 블로그 발행 완료: ${result.title.substring(0, 40)}`
    : `❌ 블로그 발행 실패: ${result.error}`;

  await transporter.sendMail({
    from: GMAIL_USER,
    to: GMAIL_USER,
    subject,
    html,
  });

  console.log(`[email] Sent to ${GMAIL_USER}: ${subject}`);
}

main().catch(err => {
  console.error("[email] Failed:", err);
  process.exit(1);
});
