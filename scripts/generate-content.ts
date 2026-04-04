#!/usr/bin/env npx tsx
/**
 * generate-content.ts
 * ==================
 * GitHub Actions에서 실행되는 블로그 콘텐츠 생성 스크립트
 * 
 * Usage: npx tsx scripts/generate-content.ts "주제" "template"
 * Output: JSON to stdout with { title, html, tags, category }
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Gemini API ──────────────────────────────────────────────
import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.GEMINI_API_KEY || "";
if (!API_KEY) {
  console.error("ERROR: GEMINI_API_KEY not set");
  process.exit(1);
}

const genAI = new GoogleGenAI({ apiKey: API_KEY });

// ── Load directives ─────────────────────────────────────────
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename_local = fileURLToPath(import.meta.url);
const __dirname_local = dirname(__filename_local);

function loadDirective(name: string): string {
  try {
    return readFileSync(resolve(__dirname_local, `../directives/${name}`), "utf-8");
  } catch {
    return "";
  }
}

const blogBase = loadDirective("blog_instructions.md");
const tplReview = loadDirective("tpl_review.md");
const tplInterview = loadDirective("tpl_interview.md");
const tplQA = loadDirective("tpl_qa.md");
const tplInvestment = loadDirective("tpl_investment.md");

function getTemplateDirective(template: string): string {
  switch (template) {
    case "review": return tplReview;
    case "interview": return tplInterview;
    case "qa": return tplQA;
    case "investment": return tplInvestment;
    default: return "";
  }
}

// ── Category classification ─────────────────────────────────
const CATEGORIES = [
  "카테고리 없음",
  "ai 신기술 및 이슈",
  "기후변화 이슈",
  "정책과 제도",
  "기후금융",
  "국제협력",
  "과학과 기술",
  "탄소중립",
  "기타",
];

async function classifyCategory(title: string, content: string): Promise<string> {
  const catList = CATEGORIES.map((c, i) => `${i}. ${c}`).join("\n");
  const prompt = `다음 블로그 글의 제목과 본문 앞부분을 보고, 가장 적합한 카테고리 번호를 하나만 숫자로 답하세요.

카테고리:
${catList}

제목: ${title}
본문 (앞 500자): ${content.substring(0, 500)}

답 (숫자만):`;

  try {
    const result = await genAI.models.generateContent({
      model: "gemini-2.0-flash",
      contents: prompt,
    });
    const num = parseInt((result.text || "8").trim());
    return CATEGORIES[num] || "기타";
  } catch {
    return "기타";
  }
}

// ── Main generation ─────────────────────────────────────────
async function main() {
  const topic = process.argv[2];
  const template = process.argv[3] || "review";

  if (!topic) {
    console.error("Usage: npx tsx scripts/generate-content.ts <topic> [template]");
    process.exit(1);
  }

  console.error(`[generate] Topic: "${topic}", Template: "${template}"`);

  const templateDirective = getTemplateDirective(template);
  const dateRangeText = "최신";

  const finalPrompt = `
    Role: You are a professional tech blog writer.
    Task: Write a high-quality blog post based on the User's Request and the following Directives.
    
    User Request:
    - Topic: "${topic}"
    - Timeframe: ${dateRangeText}
    
    STRICT Output Rules:
    1. Output ONLY the final result in the format specified below.
    2. Do NOT include any conversational text.
    3. Do NOT output the "Work Order" or "Plan". Just execute it.
    4. Ensure all tags ([TITLE], [POST], etc.) are present.
    
    DIRECTIVES:
    ${blogBase}
    
    TEMPLATE SPECIFICS:
    ${templateDirective}
  `;

  console.error("[generate] Calling Gemini API...");

  let result: any;
  const maxRetries = 3;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      result = await genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
          responseModalities: ["TEXT"],
        },
      });
      break;
    } catch (e: any) {
      attempt++;
      if (attempt > maxRetries || !e.message?.includes("429")) throw e;
      const delay = Math.pow(2, attempt) * 2000;
      console.error(`[generate] Rate limit. Retry in ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  if (!result) throw new Error("Failed to generate content");

  const rawText = result.text || "";

  // ── Parse output ──
  const titleMatch = rawText.match(/\[TITLE\]([\s\S]*?)\[\/TITLE\]/);
  const postMatch = rawText.match(/\[POST\]([\s\S]*?)\[\/POST\]/);
  const tagsMatch = rawText.match(/\[TAGS\]([\s\S]*?)\[\/TAGS\]/);
  const sourcesMatch = rawText.match(/\[SOURCES\]([\s\S]*?)\[\/SOURCES\]/);

  let post = postMatch ? postMatch[1].trim() : rawText;
  const title = titleMatch ? titleMatch[1].trim() : topic;
  const tags = tagsMatch ? tagsMatch[1].split(",").map(t => t.trim()).filter(Boolean) : [];

  // Strip accidental reference sections from POST
  post = post.replace(/<h[23][^>]*>\s*(참고|참고:|참고 자료|출처)[^<]*<\/h[23]>[\s\S]*?(?=<h[23]|$)/gi, "");

  // Build reference section from grounding metadata
  const groundingMetadata = (result as any).candidates?.[0]?.groundingMetadata;
  const groundingUrls = (groundingMetadata?.groundingChunks || [])
    .map((c: any) => ({ url: c?.web?.uri || "", domain: c?.web?.title || "" }))
    .filter((u: any) => u.url);

  const sourceTitles = sourcesMatch
    ? sourcesMatch[1].trim().split("\n").map(s => s.trim()).filter(Boolean)
    : [];

  if (sourceTitles.length > 0 || groundingUrls.length > 0) {
    let refHtml = '<div class="references" style="margin-top:2rem;padding-top:1rem;border-top:1px solid #e5e7eb;"><h2 style="font-size:1.5rem;margin-bottom:1rem;">📚 참고 자료</h2><ul style="list-style:disc;padding-left:1.5rem;">';
    const usedUrls = new Set<string>();

    for (const st of sourceTitles) {
      let matchedUrl = "";
      for (const g of groundingUrls) {
        if (!usedUrls.has(g.url)) {
          matchedUrl = g.url;
          usedUrls.add(g.url);
          break;
        }
      }
      refHtml += matchedUrl
        ? `<li style="margin-bottom:0.5rem;"><a href="${matchedUrl}" target="_blank" rel="noopener" style="color:#06b6d4;text-decoration:underline;">${st}</a></li>`
        : `<li style="margin-bottom:0.5rem;">${st}</li>`;
    }

    refHtml += "</ul></div>";
    post += refHtml;
  }

  // ── Classify category ──
  console.error("[generate] Classifying category...");
  const category = await classifyCategory(title, post);
  console.error(`[generate] Category: ${category}`);

  // ── Output JSON ──
  const output = { title, html: post, tags, category };
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error("[generate] FATAL:", err);
  process.exit(1);
});
