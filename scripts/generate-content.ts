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
import { generateContentWithAiFallback, hasOpenAIKey } from "../api/_lib/aiProviders.js";
import { XMLParser } from "fast-xml-parser";

const API_KEY = process.env.GEMINI_API_KEY || "";
if (!API_KEY && !hasOpenAIKey()) {
  console.error("ERROR: GEMINI_API_KEY or OPENAI_API_KEY not set");
  process.exit(1);
}

const genAI = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;

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
const imagePlacementInstructions = loadDirective("image_placement_instructions.md");

// ── Pexels API ──────────────────────────────────────────────
const PEXELS_API_KEY = process.env.PEXELS_API_KEY || "";

interface PexelsPhoto {
  id: number;
  src: { large: string };
}

interface ImagePlacement {
  position: string;
  imageUrl: string;
  caption: string;
}

async function fetchImagesFromPexels(query: string, count: number = 5): Promise<PexelsPhoto[]> {
  if (!PEXELS_API_KEY) {
    console.error("[images] PEXELS_API_KEY not set, skipping images");
    return [];
  }
  try {
    const response = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&locale=ko-KR&orientation=landscape`,
      { headers: { Authorization: PEXELS_API_KEY } }
    );
    const data = await response.json() as { photos: PexelsPhoto[] };
    return data.photos || [];
  } catch (error) {
    console.error(`[images] Pexels fetch error for "${query}":`, error);
    return [];
  }
}

async function fetchAndInjectImages(post: string): Promise<string> {
  if (!PEXELS_API_KEY) {
    console.error("[images] No PEXELS_API_KEY, returning post without images");
    return post;
  }

  try {
    // Step 1: AI analyzes post and generates image placement data
    console.error("[images] Analyzing post for image placements...");
    const analysisPrompt = `${imagePlacementInstructions}\n\n---\n\n다음 블로그 글을 분석하고 이미지 배치 정보를 생성하세요:\n\n${post}`;

    const analysisResult = await generateContentWithAiFallback(genAI, {
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
    }, 1, "[images]");

    const analysisText = (analysisResult as any).text || "";

    // Step 2: Parse [IMAGE_PLACEMENTS] block
    const placementsMatch = analysisText.match(/\[IMAGE_PLACEMENTS\]([\s\S]*?)\[\/IMAGE_PLACEMENTS\]/);
    if (!placementsMatch) {
      console.error("[images] No IMAGE_PLACEMENTS found in AI response, skipping");
      return post;
    }

    const imgMatches = placementsMatch[1].matchAll(/\[IMG\d+\]([\s\S]*?)\[\/IMG\d+\]/g);
    const placements: ImagePlacement[] = [];
    const usedPhotoIds = new Set<number>();

    for (const match of imgMatches) {
      const block = match[1];
      const posMatch = block.match(/position:\s*(.+)/);
      const promptMatch = block.match(/imagePrompt:\s*(.+)/);
      const captionMatch = block.match(/caption:\s*(.+)/);

      if (posMatch && promptMatch && captionMatch) {
        const position = posMatch[1].trim();
        const imagePrompt = promptMatch[1].trim();
        const caption = captionMatch[1].trim();

        console.error(`[images] Searching Pexels: "${imagePrompt}"`);
        const photos = await fetchImagesFromPexels(imagePrompt);
        const uniquePhoto = photos.find(p => !usedPhotoIds.has(p.id));

        if (uniquePhoto) {
          usedPhotoIds.add(uniquePhoto.id);
          placements.push({ position, imageUrl: uniquePhoto.src.large, caption });
          console.error(`[images] ✅ Found image for "${imagePrompt}"`);
        } else if (photos.length > 0) {
          placements.push({ position, imageUrl: photos[0].src.large, caption });
          console.error(`[images] ✅ Found image (fallback) for "${imagePrompt}"`);
        } else {
          console.error(`[images] ❌ No image found for "${imagePrompt}"`);
        }
      }
    }

    // Step 3: Inject images at positions (reverse order to preserve indices)
    if (placements.length === 0) return post;

    console.error(`[images] Injecting ${placements.length} images into post...`);
    let result = post;

    const sortedPlacements = [...placements].sort((a, b) => {
      const getIdx = (pos: string) => {
        const m = pos.match(/:(\d+)/);
        return m ? parseInt(m[1], 10) : 0;
      };
      return getIdx(b.position) - getIdx(a.position);
    });

    for (const { position, imageUrl, caption } of sortedPlacements) {
      // Tistory's TinyMCE editor often strips <figure> and <figcaption> tags. 
      // Using standard <p> wrappers with inline styles is much safer for preserving external images.
      const imageHtml = `
<p style="text-align: center; margin: 2.5em 0 0.5em 0;"><img src="${imageUrl}" alt="${caption}" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" /></p>
<p style="text-align: center; font-size: 0.9em; color: #888; margin-bottom: 2.5em;">${caption}</p>
`;

      if (position.startsWith("after_h2:")) {
        const n = parseInt(position.split(":")[1], 10);
        let count = 0;
        result = result.replace(/<\/h2>/gi, (m) => {
          count++;
          return count === n ? m + imageHtml : m;
        });
      } else if (position.startsWith("paragraph:")) {
        const n = parseInt(position.split(":")[1], 10);
        let count = 0;
        result = result.replace(/<\/p>/gi, (m) => {
          count++;
          return count === n ? m + imageHtml : m;
        });
      }
    }

    return result;
  } catch (error) {
    console.error("[images] Image injection error:", error);
    return post;
  }
}

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
    const result = await generateContentWithAiFallback(genAI, {
      model: "gemini-2.5-flash",
      contents: prompt,
    }, 1, "[classify]");
    const num = parseInt((result.text || "8").trim());
    return CATEGORIES[num] || "기타";
  } catch {
    return "기타";
  }
}

// ── RSS related posts ──────────────────────────────────────────────
function tokenizeForRelatedPosts(text: string): string[] {
  const stopwords = new Set(["2026", "2025", "최신", "정리", "가이드", "방법", "이유", "전망"]);
  return text
    .toLowerCase()
    .split(/[\s,·:()［］\[\]\-—|!?'"“”‘’<>/]+/u)
    .map(t => t.trim())
    .filter(t => t.length >= 2 && !stopwords.has(t))
    .slice(0, 20);
}

const BANNED_REPLACEMENTS: Array<[RegExp, string]> = [
  [/자리매김/g, "위치를 갖게 됨"],
  [/자리 잡/g, "정착하"],
  [/원년/g, "시작 시기"],
  [/서막/g, "초기 단계"],
  [/이정표/g, "기준점"],
  [/쓰나미/g, "큰 변화"],
  [/파도/g, "흐름"],
  [/본격화/g, "확대"],
  [/주역/g, "핵심 참여자"],
  [/진화/g, "개선"],
  [/선제적/g, "미리 준비한"],
  [/변곡점/g, "전환 시점"],
  [/잠재력/g, "가능성"],
  [/패러다임/g, "기준"],
  [/지평/g, "범위"],
  [/주목할 만/g, "확인할 만"],
  [/장악/g, "확대"],
  [/혁신을 가져올/g, "변화를 만들"],
  [/열쇠입니다/g, "중요합니다"],
  [/달려 있습니다/g, "영향을 받습니다"],
  [/성공의 비결/g, "실행 기준"],
  [/체계적으로/g, "순서대로"],
  [/지 않을 수 없습니다/g, "해야 합니다"],
  [/할 때입니다/g, "확인할 시점입니다"],
  [/지속 가능한 미래/g, "배출 감축 목표"],
  [/친환경 패러다임/g, "저탄소 기준"],
  [/녹색 혁명/g, "저탄소 전환"],
  [/탄소중립의 원년/g, "탄소중립 실행 초기"],
  [/기후위기 쓰나미/g, "기후 리스크 확대"],
  [/지구의 미래를 위해/g, "배출 기준을 맞추기 위해"],
  [/더 나은 내일/g, "다음 규제 시점"],
  [/지금\s*당장/g, "먼저"],
  [/놀라운/g, "확인할"],
  [/충격적인/g, "예상 밖의"],
];

function sanitizeBannedExpressions(text: string): string {
  return BANNED_REPLACEMENTS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text
  );
}

function splitPlainParagraph(text: string, maxLength = 190): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .match(/[^.!?。]+[.!?。]?/g) || [text.trim()];

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences.map(s => s.trim()).filter(Boolean)) {
    const next = current ? `${current} ${sentence}` : sentence;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = sentence;
    } else if (sentence.length > maxLength) {
      if (current) {
        chunks.push(current);
        current = "";
      }
      for (let i = 0; i < sentence.length; i += maxLength) {
        chunks.push(sentence.slice(i, i + maxLength));
      }
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function ensureComparisonTable(html: string): string {
  if (/<table\b/i.test(html)) return html;

  const tableHtml = `
<table>
  <thead>
    <tr><th>확인 항목</th><th>실무 질문</th><th>먼저 볼 자료</th></tr>
  </thead>
  <tbody>
    <tr><td>적용 대상</td><td>우리 회사나 거래처가 직접 영향을 받는가?</td><td>정부 고시, 규제 로드맵</td></tr>
    <tr><td>시행 시점</td><td>계약, 조달, 보고 일정 중 어느 단계가 먼저 바뀌는가?</td><td>부처 보도자료, 국제기구 문서</td></tr>
    <tr><td>대응 비용</td><td>인증, 데이터 수집, 공급망 확인에 예산이 필요한가?</td><td>기업 공시, 산업 보고서</td></tr>
  </tbody>
</table>`;

  if (/<h2[^>]*>/i.test(html)) {
    return html.replace(/(<h2[^>]*>[\s\S]*?<\/h2>)/i, `$1\n${tableHtml}`);
  }

  return `${tableHtml}\n${html}`;
}
function normalizeParagraphLengths(html: string): string {
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs, inner) => {
    const plain = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (plain.length <= 200) return full;

    const hasNestedHtml = /<[^>]+>/.test(inner);
    if (hasNestedHtml) return full;

    return splitPlainParagraph(plain)
      .map(chunk => `<p${attrs}>${chunk}</p>`)
      .join("\n");
  });
}

function applyQualityGateGuards(title: string, html: string): { title: string; html: string } {
  const safeTitle = sanitizeBannedExpressions(title).replace(/!{2,}/g, "!");
  const safeHtml = ensureComparisonTable(normalizeParagraphLengths(sanitizeBannedExpressions(html)));
  return { title: safeTitle, html: safeHtml };
}
async function fetchRelatedPosts(category: string, currentTitle: string): Promise<{title: string, link: string}[]> {
  try {
    console.error("[generate] Fetching RSS feed for related posts...");
    const res = await fetch("https://climate-insight.tistory.com/rss");
    if (!res.ok) return [];
    const xml = await res.text();
    const parser = new XMLParser({ 
      processEntities: false, 
      ignoreDeclaration: true,
      stopNodes: ["rss.channel.item.description", "rss.channel.item.content:encoded"]
    });
    const obj = parser.parse(xml);
    const items = obj.rss?.channel?.item || [];
    
    // items can be array or object if only 1 item
    const arr = Array.isArray(items) ? items : [items];
    if (arr.length === 0) return [];
    
    const tokens = new Set([
      ...tokenizeForRelatedPosts(category),
      ...tokenizeForRelatedPosts(currentTitle),
    ]);

    const scored = arr
      .map((i: any, idx: number) => {
        const itemTitle = i.title || "";
        const lowerTitle = itemTitle.toLowerCase();
        let score = 0;
        for (const token of tokens) {
          if (lowerTitle.includes(token)) score += 1;
        }
        if (itemTitle === currentTitle) score -= 100;
        return {
          title: itemTitle,
          link: i.link || "",
          score,
          idx,
        };
      })
      .filter((i: any) => i.title && i.link)
      .sort((a: any, b: any) => b.score - a.score || a.idx - b.idx);

    const related = scored.filter((i: any) => i.score > 0).slice(0, 3);
    const fallback = scored.slice(0, 3);

    return (related.length > 0 ? related : fallback).map((i: any) => ({
      title: i.title,
      link: i.link,
    }));
  } catch (error) {
    console.error("[generate] RSS fetch failed:", error);
    return [];
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

  console.error("[generate] Calling AI provider...");

  const result = await generateContentWithAiFallback(genAI, {
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
    config: {
      tools: [{ googleSearch: {} }],
      responseModalities: ["TEXT"],
    },
  }, 2, "[generate]");

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
    .filter((u: any) => u.url)
    .slice(0, 5);

  const sourceTitles = sourcesMatch
    ? sourcesMatch[1].trim().split("\n").map(s => s.trim()).filter(Boolean)
    : [];
  const limitedSourceTitles = sourceTitles.slice(0, 5);

  if (limitedSourceTitles.length > 0 || groundingUrls.length > 0) {
    let refHtml = '<div class="references" style="margin-top:2rem;padding-top:1rem;border-top:1px solid #e5e7eb;">';
    refHtml += '<details style="cursor:pointer;"><summary style="font-size:1.1rem;font-weight:bold;color:#475569;">📚 본문 출처 및 참고자료 (클릭하여 펼치기)</summary>';
    refHtml += '<ul style="list-style:disc;padding-left:1.5rem;margin-top:1rem;font-size:0.9rem;color:#64748b;">';
    const usedUrls = new Set<string>();

    for (const st of limitedSourceTitles) {
      let matchedUrl = "";
      for (const g of groundingUrls) {
        if (!usedUrls.has(g.url)) {
          matchedUrl = g.url;
          usedUrls.add(g.url);
          break;
        }
      }
      refHtml += matchedUrl
        ? `<li style="margin-bottom:0.5rem;"><a href="${matchedUrl}" target="_blank" rel="noopener" style="color:#0ea5e9;text-decoration:underline;">${st}</a></li>`
        : `<li style="margin-bottom:0.5rem;">${st}</li>`;
    }

    refHtml += "</ul></details></div>";
    post += refHtml;
  }

  // ── Inject images from Pexels ──
  console.error("[generate] Fetching and injecting images...");
  post = await fetchAndInjectImages(post);

  // ── Classify category ──
  console.error("[generate] Classifying category...");
  const category = await classifyCategory(title, post);
  console.error(`[generate] Category: ${category}`);

  // ── Inject related internal links (CTA) ──
  const relatedPosts = await fetchRelatedPosts(category, title);
  if (relatedPosts.length > 0) {
    console.error(`[generate] Injecting ${relatedPosts.length} related posts...`);
    let ctaHtml = `
<div style="margin: 3rem 0; padding: 1.5rem; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
  <h3 style="margin-top: 0; color: #166534; font-size: 1.25rem; font-weight: 700; border-bottom: 2px solid #bbf7d0; padding-bottom: 0.5rem; margin-bottom: 1rem;">🌟 함께 읽으면 좋은 기후인사이트 글</h3>
  <ul style="list-style-type: none; padding-left: 0; margin: 0;">`;
    
    for (const p of relatedPosts) {
      ctaHtml += `<li style="margin-bottom: 0.75rem; display: flex; align-items: center;"><span style="margin-right: 8px;">👉</span> <a href="${p.link}" target="_blank" rel="noopener" style="color: #0369a1; text-decoration: none; font-weight: 500; font-size: 1.05rem;">${p.title}</a></li>`;
    }

    ctaHtml += `
  </ul>
</div>`;
    post += ctaHtml;
  }

  // ── Deterministic quality guards ──
  const guarded = applyQualityGateGuards(title, post);

  // ── Output JSON ──
  const output = { title: guarded.title, html: guarded.html, tags, category };
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error("[generate] FATAL:", err);
  process.exit(1);
});
