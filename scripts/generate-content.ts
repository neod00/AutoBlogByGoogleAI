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

const MAIN_MODEL = "gemini-2.5-flash";
// 이미지 위치 분석·카테고리 분류처럼 단순한 보조 작업은 저가 모델로, 추론 없이 처리한다.
const LIGHT_MODEL = process.env.GEMINI_LIGHT_MODEL || "gemini-2.5-flash-lite";
const NO_THINKING = { thinkingConfig: { thinkingBudget: 0 } };

async function generateLightContent(contents: any, logPrefix: string): Promise<{ text: string }> {
  try {
    return await generateContentWithAiFallback(genAI, { model: LIGHT_MODEL, contents, config: NO_THINKING }, 1, logPrefix);
  } catch (error) {
    // 2.5 계열은 과거 사용 이력이 있는 계정에만 열려 있어 Flash-Lite가 거부될 수 있다. 그때는 기본 모델로 되돌린다.
    console.error(`${logPrefix} ${LIGHT_MODEL} failed, retrying with ${MAIN_MODEL}:`, error);
    return generateContentWithAiFallback(genAI, { model: MAIN_MODEL, contents, config: NO_THINKING }, 1, logPrefix);
  }
}

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

    const analysisResult = await generateLightContent(
      [{ role: "user", parts: [{ text: analysisPrompt }] }],
      "[images]"
    );

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
// 이름은 티스토리 카테고리와 정확히 같아야 한다 (auto-publish.yml의 --categories).
// "카테고리 없음"·"기타"·"ai 신기술 및 이슈"는 기후 글에 맞지 않아 선택지에서 뺐다.
// 예전에는 번호로 답하게 하고 parseInt로 읽어서, 모델이 "기후금융"이나 "**4**"처럼 답하면 "기타"로 떨어졌다
// (2026-09 기준 136편 중 61편이 "기타"). 이제 이름으로 받고, 못 읽으면 키워드 규칙으로 정한다.
// keywords 순서가 우선순위다. 보조금·바우처 같은 제도 글이 전기차·에너지 키워드보다 먼저 잡히게 둔다.
const CATEGORY_GUIDE: Array<{ name: string; hint: string; keywords: RegExp }> = [
  {
    name: "정책과 제도",
    hint: "법·규제·공시 의무·CBAM·정부 지원사업·보조금·바우처·환급·요금 제도",
    keywords: /공시|규제|법안|법률|개정안|시행령|제도|의무화|CBAM|탄소국경|실사|지원사업|지원금|보조금|바우처|환급|누진제|로드맵/,
  },
  {
    name: "기후금융",
    hint: "녹색금융·택소노미·ESG 투자·녹색채권·기후 관련 금융상품과 카드",
    keywords: /금융|택소노미|채권|투자|펀드|대출|보험|그린카드|에코머니/,
  },
  {
    name: "국제협력",
    hint: "COP·국제 협상·국가 간 협정과 공동 대응",
    keywords: /COP\d*|파리협정|UNFCCC|국제협력|협상|양자협정|유엔/,
  },
  {
    name: "기후변화 이슈",
    hint: "폭염·가뭄·홍수 같은 기후 현상과 피해·적응",
    keywords: /폭염|폭우|가뭄|홍수|산불|이상기후|기온|해수면|기후 ?적응|미세먼지/,
  },
  {
    name: "과학과 기술",
    hint: "기후테크·배터리·수소·탄소포집·에너지 저장·전기차 기술",
    keywords: /기술|배터리|수소|CCUS|탄소포집|에너지 ?저장|ESS|전기차|충전/,
  },
  {
    name: "탄소중립",
    hint: "감축·배출권·재생에너지·RE100·PPA·에너지 절약·분리배출·자원순환·탄소발자국·탄소중립포인트",
    keywords: /탄소중립|배출권|감축|재생에너지|RE100|PPA|태양광|풍력|절약|난방|전기세|전기요금|에너지|분리배출|자원순환|재활용|폐가전|탄소발자국|포인트|Scope ?3|스코프 ?3/,
  },
];
const DEFAULT_CATEGORY = "탄소중립";

function stripHtmlText(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// 모델 답에 들어 있는 카테고리 이름을 찾는다. 긴 이름부터 비교해 부분 일치 오인을 막는다.
function pickCategoryFromResponse(text: string): string | null {
  const names = CATEGORY_GUIDE.map(c => c.name).sort((a, b) => b.length - a.length);
  const cleaned = (text || "").replace(/[*_`"'「」]/g, "");
  return names.find(name => cleaned.includes(name)) || null;
}

function categoryByKeywords(title: string, tags: string[], body: string): string {
  // 제목과 태그를 먼저 보고, 없으면 본문 앞부분까지 본다.
  for (const text of [`${title} ${tags.join(" ")}`, body]) {
    const hit = CATEGORY_GUIDE.find(c => c.keywords.test(text));
    if (hit) return hit.name;
  }
  return DEFAULT_CATEGORY;
}

async function classifyCategory(title: string, html: string, tags: string[] = []): Promise<string> {
  const body = stripHtmlText(html).slice(0, 800);
  const guide = CATEGORY_GUIDE.map(c => `- ${c.name}: ${c.hint}`).join("\n");
  const prompt = `다음 블로그 글에 가장 맞는 카테고리 하나를 고르세요.

카테고리:
${guide}

제목: ${title}
태그: ${tags.join(", ")}
본문 앞부분: ${body}

위 카테고리 이름 중 하나만 그대로 출력하세요. 설명이나 번호는 쓰지 마세요.`;

  try {
    const result = await generateLightContent(prompt, "[classify]");
    const picked = pickCategoryFromResponse(result.text || "");
    if (picked) return picked;
    console.error(`[classify] Unrecognized answer "${(result.text || "").slice(0, 40)}", using keyword rules`);
  } catch (error) {
    console.error("[classify] Classification failed, using keyword rules:", error);
  }
  return categoryByKeywords(title, tags, body);
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
  [/선제적으로/g, "먼저"],
  [/선제적인/g, "사전"],
  [/선제적/g, "사전"],
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
  )
    .replace(/미리 준비한으로/g, "사전 준비 형태로")
    .replace(/미리 준비한인/g, "초기")
    .replace(/사전으로/g, "먼저")
    .replace(/사전인/g, "초기")
    .replace(/사전 대응적/g, "사전 대응")
    .replace(/사전 준비적/g, "사전 준비");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeSourceUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();
    const direct = parsed.searchParams.get("url") || parsed.searchParams.get("q");
    if (direct && /^https?:\/\//i.test(direct)) {
      return direct;
    }
    if (
      host.includes("google.") ||
      host.includes("vertexaisearch.") ||
      host.includes("googleusercontent.")
    ) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

type SourceRef = {
  title: string;
  publisher: string;
  url: string;
};

function parseSourceLine(line: string): SourceRef | null {
  const cleaned = line.replace(/^[-*]\s*/, "").trim();
  if (!cleaned) return null;

  const urlMatch = cleaned.match(/https?:\/\/[^\s)>\]]+/i);
  const url = normalizeSourceUrl(urlMatch?.[0] || "");
  const withoutUrl = urlMatch ? cleaned.replace(urlMatch[0], "").replace(/\s*[-–|]\s*$/, "").trim() : cleaned;
  const parts = withoutUrl.split(/\s+[-–|]\s+/).map(part => part.trim()).filter(Boolean);

  return {
    title: parts[0] || withoutUrl,
    publisher: parts.slice(1).join(" - "),
    url,
  };
}

function buildReferenceSection(sourceLines: string[], groundingChunks: any[]): string {
  const sourceRefs = sourceLines
    .map(parseSourceLine)
    .filter((source): source is SourceRef => Boolean(source));

  const groundingRefs: SourceRef[] = groundingChunks
    .map((chunk: any) => ({
      title: chunk?.web?.title || "",
      publisher: "",
      url: normalizeSourceUrl(chunk?.web?.uri || ""),
    }))
    .filter((source: SourceRef) => source.title || source.url);

  const refs: SourceRef[] = [];
  const seen = new Set<string>();

  for (const source of [...sourceRefs, ...groundingRefs]) {
    const key = (source.url || source.title).toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    refs.push(source);
    if (refs.length >= 5) break;
  }

  if (refs.length === 0) return "";

  let refHtml = '<div class="references" style="margin-top:2rem;padding-top:1rem;border-top:1px solid #e5e7eb;">';
  refHtml += '<h2 style="font-size:1.2rem;color:#334155;margin-bottom:0.75rem;">근거와 참고자료</h2>';
  refHtml += '<p style="font-size:0.92rem;color:#64748b;margin:0 0 0.75rem 0;">본문의 주요 수치와 규제 설명을 확인할 때 우선 볼 자료입니다.</p>';
  refHtml += '<ul style="list-style:disc;padding-left:1.5rem;margin-top:0.75rem;font-size:0.92rem;color:#475569;">';

  for (const source of refs) {
    const label = escapeHtml(source.publisher ? `${source.title} - ${source.publisher}` : source.title);
    refHtml += source.url
      ? `<li style="margin-bottom:0.5rem;"><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" style="color:#0369a1;text-decoration:underline;">${label}</a></li>`
      : `<li style="margin-bottom:0.5rem;">${label}</li>`;
  }

  refHtml += "</ul></div>";
  return refHtml;
}

function splitPlainParagraph(text: string, maxLength = 190): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    // 닫는 따옴표·괄호는 앞 문장에 붙여야 인용문이 두 문단으로 쪼개지지 않는다.
    .match(/[^.!?。]+(?:[.!?。]+['"’”」』)\]]*)?/g) || [text.trim()];

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

function normalizeParagraphLengths(html: string): string {
  return html.replace(/<p([^>]*)>([\s\S]*?)<\/p>/gi, (full, attrs, inner) => {
    const plain = inner.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (plain.length <= 200) return full;

    const shouldPreserveHtml = /<(img|a|iframe|table|ul|ol|li|br)\b/i.test(inner);
    if (shouldPreserveHtml) return full;

    return splitPlainParagraph(plain)
      .map(chunk => `<p${attrs}>${chunk}</p>`)
      .join("\n");
  });
}

function applyQualityGateGuards(title: string, html: string): { title: string; html: string } {
  const safeTitle = sanitizeBannedExpressions(title).replace(/!{2,}/g, "!");
  // 표가 없을 때 범용 표를 끼워 넣지 않는다. 표 누락은 품질 게이트가 판단한다.
  const safeHtml = normalizeParagraphLengths(sanitizeBannedExpressions(html));
  return { title: safeTitle, html: safeHtml };
}

type RssPost = { title: string; link: string };

// RSS 제목은 엔티티가 이중으로 인코딩되어 온다 (예: &amp;mdash;).
function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
    mdash: "—", ndash: "–", middot: "·", hellip: "…", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  };
  let decoded = value;
  for (let i = 0; i < 2; i++) {
    decoded = decoded
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&([a-z]+);/gi, (m, name) => named[name.toLowerCase()] ?? m);
  }
  return decoded;
}

async function fetchRssPosts(): Promise<RssPost[]> {
  try {
    console.error("[generate] Fetching RSS feed...");
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
    return arr
      .map((i: any) => ({ title: decodeEntities(String(i.title || "")), link: String(i.link || "") }))
      .filter((p: RssPost) => p.title && p.link);
  } catch (error) {
    console.error("[generate] RSS fetch failed:", error);
    return [];
  }
}

function decodeUrl(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

// 프롬프트에는 토큰을 아끼려고 한글로 풀어 쓴 주소를 준다(인코딩 주소는 약 3배 길다).
// 본문의 블로그 내부 링크는 RSS의 실제 주소로 되돌리고, 목록에 없는 주소(모델이 지어낸 링크)는 링크를 풀어 텍스트만 남긴다.
function restoreInternalLinks(html: string, posts: RssPost[]): string {
  const known = new Map(posts.map(p => [decodeUrl(p.link), p.link]));
  return html.replace(
    /<a\b[^>]*href="(https?:\/\/climate-insight\.tistory\.com\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (full, href, text) => {
      const canonical = known.get(decodeUrl(href));
      if (!canonical) {
        console.error(`[generate] Unknown internal link removed: ${decodeUrl(href)}`);
        return text;
      }
      return full.replace(href, () => canonical);
    }
  );
}

function pickRelatedPosts(posts: RssPost[], category: string, currentTitle: string): RssPost[] {
  const tokens = new Set([
    ...tokenizeForRelatedPosts(category),
    ...tokenizeForRelatedPosts(currentTitle),
  ]);

  const scored = posts
    .map((post, idx) => {
      const lowerTitle = post.title.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lowerTitle.includes(token)) score += 1;
      }
      if (post.title === currentTitle) score -= 100;
      return { ...post, score, idx };
    })
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  const related = scored.filter(p => p.score > 0).slice(0, 3);
  const fallback = scored.slice(0, 3);

  return (related.length > 0 ? related : fallback).map(({ title, link }) => ({ title, link }));
}

// ── Main generation ─────────────────────────────────────────
async function main() {
  const topic = process.argv[2];
  const template = process.argv[3] || "review";
  // 운영자가 직접 쓴 현장 메모. 있을 때만 1인칭 서술을 허용한다.
  const fieldNotes = (process.argv[4] || process.env.PUBLISH_FIELD_NOTES || "").trim();

  if (!topic) {
    console.error("Usage: npx tsx scripts/generate-content.ts <topic> [template] [field_notes]");
    process.exit(1);
  }

  console.error(`[generate] Topic: "${topic}", Template: "${template}"`);

  const templateDirective = getTemplateDirective(template);
  const today = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric",
  }).format(new Date());

  const existingPosts = await fetchRssPosts();
  const existingPostsBlock = existingPosts.length > 0
    ? existingPosts.map(p => `- ${p.title} | ${decodeUrl(p.link)}`).join("\n")
    : "(없음)";
  const fieldNotesBlock = fieldNotes || "(없음 — 1인칭 경험 서술 금지)";

  const finalPrompt = `
    Role: You are the senior editor of Climate Insight, a Korean climate/ESG business blog.
    Task: Write a high-quality blog post based on the User's Request and the following Directives.

    User Request:
    - Topic: "${topic}"
    - 오늘 날짜: ${today} (이 날짜 기준으로 지난 일정, 마감된 공고, 확정된 초안을 구분할 것)

    [EXISTING_POSTS]
    ${existingPostsBlock}
    [/EXISTING_POSTS]

    [FIELD_NOTES]
    ${fieldNotesBlock}
    [/FIELD_NOTES]

    STRICT Output Rules:
    1. Output ONLY the final result in the format specified below.
    2. Do NOT include any conversational text.
    3. Do NOT output the "Work Order" or "Plan". Just execute it.
    4. Ensure all tags ([TITLE], [POST], etc.) are present.
    5. Write in natural Korean sentences. Avoid mechanical replacements, slogan-like endings, and stiff AI summary tone.
    6. In [SOURCES], prefer official/government/international-organization/company pages. Use this format when a URL is available: "자료 제목 - 기관/언론사 - https://...".
    
    DIRECTIVES:
    ${blogBase}
    
    TEMPLATE SPECIFICS:
    ${templateDirective}
  `;

  console.error("[generate] Calling AI provider...");

  const result = await generateContentWithAiFallback(genAI, {
    model: MAIN_MODEL,
    contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
    config: {
      tools: [{ googleSearch: {} }],
      responseModalities: ["TEXT"],
    },
  }, 2, "[generate]", {
    // OpenAI 대체 시 본문 전체(약 4~5천 토큰)와 검색 시간이 들어가도록 여유를 준다.
    openaiMaxOutputTokens: 16_000,
    openaiTimeoutMs: 180_000,
  });

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
  post = restoreInternalLinks(post, existingPosts);

  // Build a compact, visible reference section from model sources and grounding metadata.
  const groundingMetadata = (result as any).candidates?.[0]?.groundingMetadata;
  const sourceLines = sourcesMatch
    ? sourcesMatch[1].trim().split("\n").map(s => s.trim()).filter(Boolean)
    : [];
  const referenceSection = buildReferenceSection(sourceLines, groundingMetadata?.groundingChunks || []);

  // ── Inject images from Pexels ──
  console.error("[generate] Fetching and injecting images...");
  post = await fetchAndInjectImages(post);

  if (referenceSection) {
    post += referenceSection;
  }

  // ── Classify category ──
  console.error("[generate] Classifying category...");
  const category = await classifyCategory(title, post, tags);
  console.error(`[generate] Category: ${category}`);

  // ── Inject related internal links (CTA) ──
  const relatedPosts = pickRelatedPosts(existingPosts, category, title);
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
  // existing_titles·field_notes는 품질 게이트의 주제 중복·지어낸 경험 검사에 쓰인다.
  const output = {
    title: guarded.title,
    html: guarded.html,
    tags,
    category,
    existing_titles: existingPosts.map(p => p.title),
    field_notes: fieldNotes,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch(err => {
  console.error("[generate] FATAL:", err);
  process.exit(1);
});
