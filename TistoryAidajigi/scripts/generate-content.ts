#!/usr/bin/env npx tsx
/**
 * generate-content.ts (aidajigi.tistory.com)
 * ==================
 * GitHub Actions에서 실행되는 AI 전문 블로그 콘텐츠 생성 스크립트
 * 
 * Usage: npx tsx TistoryAidajigi/scripts/generate-content.ts "주제" "template"
 * Output: JSON to stdout with { title, html, tags, category }
 */

import { readFileSync } from "fs";
import { resolve } from "path";

// ── Gemini API ──────────────────────────────────────────────
import { GoogleGenAI } from "@google/genai";
import { XMLParser } from "fast-xml-parser";

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
const tplNews = loadDirective("tpl_news.md");
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

    const analysisResult = await genAI.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
    });

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
    case "news": return tplNews;
    default: return "";
  }
}

// ── Category classification (aidajigi AI 전문 카테고리) ─────
const CATEGORIES = [
  "AI 뉴스 & 트렌드",
  "AI 모델 리뷰",
  "생성형 AI",
  "AI 기업 동향",
  "기업 AI 전환(AX)",
  "AI 정책 & 표준",
  "AI 활용 가이드",
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
      model: "gemini-2.5-flash",
      contents: prompt,
    });
    const num = parseInt((result.text || "7").trim());
    return CATEGORIES[num] || "기타";
  } catch {
    return "기타";
  }
}

// ── RSS related posts (aidajigi.tistory.com) ────────────────
async function fetchRelatedPosts(category: string): Promise<{title: string, link: string}[]> {
  try {
    console.error("[generate] Fetching RSS feed for related posts...");
    const res = await fetch("https://aidajigi.tistory.com/rss");
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
    
    // Pick the latest 3 items as related internal links
    const topItems = arr.slice(0, 3).map((i: any) => ({
      title: i.title || "",
      link: i.link || ""
    }));

    return topItems;
  } catch (error) {
    console.error("[generate] RSS fetch failed:", error);
    return [];
  }
}

// ── Main generation ─────────────────────────────────────────
async function main() {
  const topic = process.argv[2];
  const template = process.argv[3] || "news";

  if (!topic) {
    console.error("Usage: npx tsx TistoryAidajigi/scripts/generate-content.ts <topic> [template]");
    process.exit(1);
  }

  console.error(`[generate] Topic: "${topic}", Template: "${template}"`);

  const templateDirective = getTemplateDirective(template);
  const dateRangeText = "최신";

  // 도입부/결론 스타일을 스크립트에서 랜덤 지정.
  // (모델은 이전 글을 기억하지 못해 "랜덤하게 선택하라"는 지시만으로는
  //  매번 같은 스타일로 수렴함 → 애드센스 boilerplate 판정 위험)
  const introStyles = ["A (현장 스케치형)", "B (반전 팩트형)", "C (질문 폭탄형)"];
  const conclusionStyles = ["A (실행 계획형)", "B (핵심 요점 요약형)", "C (실무자 FAQ/Q&A형)"];
  const introStyle = introStyles[Math.floor(Math.random() * introStyles.length)];
  const conclusionStyle = conclusionStyles[Math.floor(Math.random() * conclusionStyles.length)];
  console.error(`[generate] Intro style: ${introStyle}, Conclusion style: ${conclusionStyle}`);

  const finalPrompt = `
    Role: You are a professional AI tech blog writer specializing in artificial intelligence trends, models, and applications.
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

    STYLE ASSIGNMENT (이번 글에 반드시 적용):
    - 이번 글의 도입부 스타일: ${introStyle}
    - 이번 글의 결론 스타일: ${conclusionStyle}
  `;

  console.error("[generate] Calling Gemini API...");

  let result: any;
  const maxRetries = 3;
  let attempt = 0;

  while (attempt <= maxRetries) {
    try {
      result = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        config: {
          tools: [{ googleSearch: {} }],
          responseModalities: ["TEXT"],
        },
      });
      break;
    } catch (e: any) {
      attempt++;
      if (attempt > maxRetries || (!e.message?.includes("429") && !e.message?.includes("503"))) throw e;
      const delay = Math.pow(2, attempt) * 2000;
      console.error(`[generate] Rate limit or high demand (503). Retry in ${delay}ms...`);
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

  // Strip "다음에 검색해볼 키워드" remnants from POST
  post = post.replace(/<p[^>]*>\s*<strong>\s*다음에 검색해볼 키워드[^<]*<\/strong>[^<]*<\/p>/gi, "");
  post = post.replace(/다음에 검색해볼 키워드[^<]*/gi, "");

  // Strip "예상 독서 시간" / "읽기 시간" sentences from POST
  post = post.replace(/예상 독서 시간[^.]*\./g, "");
  post = post.replace(/읽기 시간[^.]*\./g, "");
  post = post.replace(/약 \d+분입니다\./g, "");

  // 투자(YMYL) 글: 면책 문구가 빠졌으면 자동 삽입 (애드센스 필수)
  if (template === "investment" && !/투자.{0,20}(권유|추천이 아|책임)/.test(post)) {
    console.error("[generate] Investment disclaimer missing — auto-appending");
    post += `\n<p style="margin-top:2rem;padding:1rem;background:#f8fafc;border-radius:8px;font-size:0.85rem;color:#64748b;">⚠️ 본 글은 산업 동향에 대한 정보 제공을 목적으로 하며, 특정 종목의 매수·매도 추천이 아닙니다. 모든 투자의 책임은 투자자 본인에게 있으며, 투자 결정 전 반드시 전문가와 상담하시기 바랍니다.</p>`;
  }

  // Build reference section from [SOURCES] block only (plain text, no links)
  // NOTE: Gemini grounding URLs (vertexaisearch.cloud.google.com/grounding-api-redirect/...)
  // are temporary redirect URLs that expire quickly and look spammy to search engines.
  // We intentionally do NOT use them. Source titles are shown as plain text citations.
  const sourceTitles = sourcesMatch
    ? sourcesMatch[1].trim().split("\n").map(s => s.trim()).filter(Boolean)
    : [];

  // Limit references to max 5 most relevant sources
  const MAX_REFERENCES = 5;
  const limitedSourceTitles = sourceTitles.slice(0, MAX_REFERENCES);

  if (limitedSourceTitles.length > 0) {
    let refHtml = '<div class="references" style="margin-top:2rem;padding-top:1rem;border-top:1px solid #e5e7eb;">';
    refHtml += '<details style="cursor:pointer;"><summary style="font-size:1.1rem;font-weight:bold;color:#475569;">📚 본문 출처 및 참고자료 (클릭하여 펼치기)</summary>';
    refHtml += '<ul style="list-style:disc;padding-left:1.5rem;margin-top:1rem;font-size:0.9rem;color:#64748b;">';

    for (const st of limitedSourceTitles) {
      refHtml += `<li style="margin-bottom:0.5rem;">${st}</li>`;
    }

    refHtml += "</ul></details></div>";
    post += refHtml;
    console.error(`[generate] Reference sources: ${limitedSourceTitles.length} (text-only, no redirect links)`);
  }

  // ── Inject images from Pexels ──
  console.error("[generate] Fetching and injecting images...");
  post = await fetchAndInjectImages(post);

  // ── Classify category ──
  console.error("[generate] Classifying category...");
  const category = await classifyCategory(title, post);
  console.error(`[generate] Category: ${category}`);

  // ── Inject related internal links (CTA) ──
  const relatedPosts = await fetchRelatedPosts(category);
  if (relatedPosts.length > 0) {
    console.error(`[generate] Injecting ${relatedPosts.length} related posts...`);
    
    // 5 premium, beautiful styling options to randomize CSS structure and bypass boilerplate footprints
    const ctaPalettes = [
      { bg: "#eff6ff", border: "#bfdbfe", title: "#1e40af", link: "#0369a1", emoji: "👉" },
      { bg: "#f0fdf4", border: "#bbf7d0", title: "#166534", link: "#15803d", emoji: "💡" },
      { bg: "#fffbeb", border: "#fef3c7", title: "#92400e", link: "#b45309", emoji: "🔍" },
      { bg: "#f5f3ff", border: "#ddd6fe", title: "#5b21b6", link: "#6d28d9", emoji: "🚀" },
      { bg: "#fff1f2", border: "#fecdd3", title: "#9f1239", link: "#be123c", emoji: "✨" }
    ];
    
    const palette = ctaPalettes[Math.floor(Math.random() * ctaPalettes.length)];
    
    let ctaHtml = `
<div style="margin: 3rem 0; padding: 1.5rem; background-color: ${palette.bg}; border: 1px solid ${palette.border}; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
  <h3 style="margin-top: 0; color: ${palette.title}; font-size: 1.25rem; font-weight: 700; border-bottom: 2px solid ${palette.border}; padding-bottom: 0.5rem; margin-bottom: 1rem;">🤖 AI 인사이트 더 보기</h3>
  <ul style="list-style-type: none; padding-left: 0; margin: 0;">`;
    
    for (const p of relatedPosts) {
      ctaHtml += `<li style="margin-bottom: 0.75rem; display: flex; align-items: center;"><span style="margin-right: 8px;">${palette.emoji}</span> <a href="${p.link}" target="_blank" rel="noopener" style="color: ${palette.link}; text-decoration: none; font-weight: 500; font-size: 1.05rem;">${p.title}</a></li>`;
    }

    ctaHtml += `
  </ul>
</div>`;
    post += ctaHtml;
  }

  // ── Output JSON ──
  const output = { title, html: post, tags, category };
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error("[generate] FATAL:", err);
  process.exit(1);
});
