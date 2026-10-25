#!/usr/bin/env npx tsx
/**
 * repair-content.ts
 * =================
 * 품질 게이트에 걸린 글을 한 번만 고친다. 실패 항목만 모델에 알려주고, 그 항목만 고치게 한다.
 *
 * Usage: npx tsx scripts/repair-content.ts <blog_output.json> <quality_gate_result.json>
 * 성공하면 blog_output.json을 고친 글로 덮어쓰고 0으로 끝난다. 고칠 수 없거나 결과가 이상하면 원본을 그대로 두고 1로 끝난다.
 *
 * 배경 (2026-10): 분량을 1,200~2,200자로 줄인 뒤 시험 6회 중 1회만 게이트를 통과했다.
 * 실패 항목은 매번 달랐다 (기준일 누락, 표 누락, 접수기간 누락, 제목 콜론). 하나씩 막는 대신 실패 항목을 고치는 단계를 둔다.
 */

import { readFileSync, writeFileSync, renameSync } from "fs";
import { GoogleGenAI } from "@google/genai";
import { generateContentWithAiFallback, hasOpenAIKey } from "../api/_lib/aiProviders.js";

const MODEL = "gemini-2.5-flash";
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } };

// 생성 스크립트가 본문 뒤에 붙이는 영역. 수리 대상이 아니므로 떼어 두었다가 다시 붙인다.
const APPENDIX_PATTERN = /<div[^>]*class=["']references["'][^>]*>|<div\s+style=["'][^"']*margin:\s*3rem/i;

// 모델이 고칠 수 없는 항목(사실이 필요한 것)과 고칠 수 있는 항목을 구분하지 않고 모두 알려준다.
// 다만 새 사실을 만들지 못하게 하므로, 사실이 없어서 실패한 항목은 수리 후에도 게이트가 다시 막는다.
function buildPrompt(title: string, body: string, failures: string[]): string {
  return `아래 블로그 글이 자동 품질 검사에서 다음 항목으로 실패했습니다. 이 항목만 고치세요.

[실패 항목]
${failures.map(f => `- ${f}`).join("\n")}

[고치는 방법]
- 제목 금지 패턴: 연도가 있는 제목에는 콜론(:)과 연도 뒤 쉼표를 쓰지 않습니다. "현명하게!" 같은 끝맺음도 쓰지 않습니다. 핵심어를 앞에 두고 대상·금액·행동으로 끝냅니다.
- 가치 요소 또는 비교표 누락: 본문에 이미 있는 사실(대상, 금액, 기간, 기관)로 <table>을 하나 만드세요. 첫 행은 <th> 헤더, 데이터 행은 2개 이상입니다. 새 수치를 만들지 마세요.
- 본문 분량 초과: 설명 문장과 반복 문장을 지워 줄입니다. 표·목록·날짜·금액은 유지합니다.
- 미확인 표현: "가능성 있음", "확인 필요"가 붙은 문장이나 항목을 지웁니다.
- 섹션 간 수치 반복: 같은 금액은 표 하나에만 남기고 다른 섹션의 반복 문장을 지웁니다.
- 접수기간 누락: 본문이나 표에 접수 시점(날짜 또는 "2월 초"처럼 월 단위)과 마감 방식("예산 소진 시 마감", "상시 신청")이 이미 있으면 한 문장으로 모아 쓰세요. 본문에 없는 날짜는 만들지 마세요.
- 그 밖의 항목: 실패 사유에 맞게 최소한으로 고칩니다.

[지킬 것]
- 새로운 사실, 수치, 날짜, 기관, 링크를 추가하지 않습니다.
- 실패 항목과 무관한 문장은 그대로 둡니다.
- <img>, <figure>, <figcaption> 태그는 위치와 내용을 그대로 둡니다.
- 출력 형식을 정확히 지킵니다. 설명이나 코드블록 표시는 쓰지 않습니다.

[출력 형식]
[TITLE]
제목
[/TITLE]
[POST]
HTML 본문
[/POST]

[현재 제목]
${title}

[현재 본문]
${body}`;
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) || []).length;
}

function plainLength(html: string): number {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
}

// 수리 결과가 원본의 구조를 잃었는지 본다. 잃었으면 수리하지 않은 것으로 친다.
function isSafeRepair(before: string, after: string): string | null {
  if (count(after, /<img\b/gi) !== count(before, /<img\b/gi)) return "이미지 개수가 바뀜";
  if (count(after, /<table\b/gi) < count(before, /<table\b/gi)) return "표가 사라짐";
  if (count(before, /<ol\b/gi) > 0 && count(after, /<ol\b/gi) === 0) return "번호 목록이 사라짐";
  if (count(after, /<h2\b/gi) < Math.min(3, count(before, /<h2\b/gi))) return "소제목이 너무 줄어듦";
  if (plainLength(after) < plainLength(before) * 0.5) return "본문이 절반 미만으로 줄어듦";
  if (plainLength(after) > plainLength(before) * 1.3) return "본문이 30% 넘게 늘어남";
  return null;
}

async function main() {
  const [contentPath, gatePath] = process.argv.slice(2);
  if (!contentPath || !gatePath) {
    console.error("Usage: npx tsx scripts/repair-content.ts <blog_output.json> <quality_gate_result.json>");
    process.exit(2);
  }

  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey && !hasOpenAIKey()) {
    console.error("[repair] GEMINI_API_KEY or OPENAI_API_KEY not set");
    process.exit(1);
  }
  const genAI = apiKey ? new GoogleGenAI({ apiKey }) : null;

  const content = JSON.parse(readFileSync(contentPath, "utf-8"));
  const gate = JSON.parse(readFileSync(gatePath, "utf-8"));
  const failures: string[] = (gate.details || [])
    .filter((d: any) => d.icon === "❌")
    .map((d: any) => `${d.name}: ${d.detail}`);

  if (failures.length === 0) {
    console.error("[repair] No failed checks. Nothing to repair.");
    process.exit(1);
  }
  console.error(`[repair] Repairing ${failures.length} failed check(s): ${failures.map(f => f.split(":")[0]).join(", ")}`);

  const html: string = content.html || "";
  const match = html.match(APPENDIX_PATTERN);
  const splitAt = match?.index ?? html.length;
  const body = html.slice(0, splitAt);
  const appendix = html.slice(splitAt);

  const result = await generateContentWithAiFallback(genAI, {
    model: MODEL,
    contents: [{ role: "user", parts: [{ text: buildPrompt(content.title || "", body, failures) }] }],
    config: NO_THINKING,
  }, 1, "[repair]", { openaiMaxOutputTokens: 8_000, openaiTimeoutMs: 120_000 });

  const text = result.text || "";
  const newTitle = text.match(/\[TITLE\]([\s\S]*?)\[\/TITLE\]/)?.[1]?.trim();
  const newBody = text.match(/\[POST\]([\s\S]*?)\[\/POST\]/)?.[1]
    ?.replace(/^\s*```(?:html)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  if (!newTitle || !newBody) {
    console.error("[repair] Model output missing [TITLE] or [POST]. Keeping original.");
    process.exit(1);
  }

  const problem = isSafeRepair(body, newBody);
  if (problem) {
    console.error(`[repair] Rejected repair (${problem}). Keeping original.`);
    process.exit(1);
  }

  const repaired = { ...content, title: newTitle, html: `${newBody}\n${appendix}` };
  // 중간에 실패해도 원본이 깨지지 않도록 임시 파일에 쓴 뒤 바꾼다.
  const tmpPath = `${contentPath}.repair.tmp`;
  writeFileSync(tmpPath, JSON.stringify(repaired, null, 2), "utf-8");
  renameSync(tmpPath, contentPath);
  console.error(`[repair] Repaired. Title: ${newTitle.slice(0, 60)} | Body: ${plainLength(body)} -> ${plainLength(newBody)} chars`);
}

main().catch(error => {
  console.error("[repair] FATAL (keeping original):", error);
  process.exit(1);
});
