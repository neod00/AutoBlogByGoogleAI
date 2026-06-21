#!/usr/bin/env npx tsx
/**
 * Sends the GitHub Actions publish result email.
 *
 * The publisher writes /tmp/publish_result.json. The quality gate writes
 * /tmp/quality_gate_result.json when available.
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readPublishResult(): PublishResult {
  const resultPath = "/tmp/publish_result.json";

  if (!existsSync(resultPath)) {
    return {
      success: false,
      url: "",
      error: "publish_result.json 파일을 찾지 못했습니다.",
      title: "Unknown",
      category: "Unknown",
    };
  }

  const parsed = JSON.parse(readFileSync(resultPath, "utf-8"));
  return {
    success: Boolean(parsed.success),
    url: parsed.url || "",
    error: parsed.error || "",
    title: parsed.title || "Unknown",
    category: parsed.category || "Unknown",
  };
}

function buildQualityGateHtml(): string {
  const qgPath = "/tmp/quality_gate_result.json";
  if (!existsSync(qgPath)) return "";

  try {
    const qg = JSON.parse(readFileSync(qgPath, "utf-8"));
    const items = (qg.details || [])
      .map((d: any) => {
        const icon = escapeHtml(String(d.icon || ""));
        const name = escapeHtml(String(d.name || ""));
        const detail = d.detail ? ` - ${escapeHtml(String(d.detail))}` : "";
        return `<div style="padding:4px 0;font-size:13px;">${icon} <strong>${name}</strong>${detail}</div>`;
      })
      .join("");

    const qgStatus = qg.passed ? "PASS" : "FAIL";
    const qgColor = qg.passed ? "#10b981" : "#ef4444";

    return `
      <div style="background:#f8fafc;padding:16px 20px;border-radius:8px;border:1px solid #e2e8f0;margin-top:16px;">
        <h3 style="margin:0 0 12px;font-size:15px;color:#334155;">
          Quality Gate <span style="color:${qgColor}">${qgStatus}</span>
          <span style="font-weight:normal;color:#94a3b8;font-size:12px;">
            (${qg.passed_count || 0} pass / ${qg.failed_count || 0} fail / ${qg.warning_count || 0} warning)
          </span>
        </h3>
        ${items}
      </div>`;
  } catch (error) {
    console.error("[email] Failed to load quality gate result:", error);
    return "";
  }
}

async function main() {
  const result = readPublishResult();
  const now = new Date().toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  const statusEmoji = result.success ? "✅" : "❌";
  const statusText = result.success ? "발행 성공" : "발행 실패";
  const title = escapeHtml(result.title);
  const category = escapeHtml(result.category);
  const error = escapeHtml(result.error);
  const url = escapeHtml(result.url);
  const qgHtml = buildQualityGateHtml();

  const html = `
    <div style="font-family:'Apple SD Gothic Neo',Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">
      <div style="background:${result.success ? "linear-gradient(135deg,#10b981,#059669)" : "linear-gradient(135deg,#ef4444,#dc2626)"};color:white;padding:24px;border-radius:12px;margin-bottom:20px;">
        <h1 style="margin:0;font-size:24px;">${statusEmoji} 기후인사이트 자동 발행 ${statusText}</h1>
        <p style="margin:8px 0 0;opacity:0.9;">${now}</p>
      </div>

      <div style="background:#f8fafc;padding:20px;border-radius:8px;border:1px solid #e2e8f0;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;color:#64748b;width:90px;">제목</td>
            <td style="padding:8px 0;font-weight:600;">${title}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;">카테고리</td>
            <td style="padding:8px 0;">${category}</td>
          </tr>
          ${result.url ? `
          <tr>
            <td style="padding:8px 0;color:#64748b;">URL</td>
            <td style="padding:8px 0;"><a href="${url}" style="color:#0ea5e9;text-decoration:underline;">${url}</a></td>
          </tr>` : ""}
          ${result.error ? `
          <tr>
            <td style="padding:8px 0;color:#64748b;">오류</td>
            <td style="padding:8px 0;color:#ef4444;">${error}</td>
          </tr>` : ""}
        </table>
      </div>

      ${qgHtml}

      <p style="color:#94a3b8;font-size:12px;margin-top:20px;text-align:center;">
        AutoBlogByGoogleAI · Climate Insight Publishing Pipeline
      </p>
    </div>
  `;

  const subject = result.success
    ? `✅ 기후인사이트 발행 완료: ${result.title.substring(0, 40)}`
    : `❌ 기후인사이트 발행 실패: ${result.error || result.title}`;

  const recipientEmail = process.env.RECIPIENT_EMAIL || GMAIL_USER;

  await transporter.sendMail({
    from: GMAIL_USER,
    to: recipientEmail,
    subject,
    html,
  });

  console.log(`[email] Sent to ${recipientEmail}: ${subject}`);
}

main().catch(error => {
  console.error("[email] Failed:", error);
  process.exit(1);
});
