import { GoogleGenAI } from "@google/genai";
import * as imageService from "./execution/imageService";
import * as contentService from "./execution/contentService";

import blogBase from "../directives/blog_instructions.md?raw";
import shortsBase from "../directives/shorts_instructions.md?raw";
import longformBase from "../directives/longform_instructions.md?raw";
import tplReview from "../directives/tpl_review.md?raw";
import tplInterview from "../directives/tpl_interview.md?raw";
import tplQA from "../directives/tpl_qa.md?raw";
import tplInvestment from "../directives/tpl_investment.md?raw";
import imagePlacementInstructions from "../directives/image_placement_instructions.md?raw";

const API_KEY = process.env.GEMINI_API_KEY || process.env.API_KEY || "";
const genAI = new GoogleGenAI({ apiKey: API_KEY });

export interface BlogPostResult {
  title: string;
  post: string;
  tags: string[];
  imageKeywords?: string[];
  originalPost?: string;
}

function getTemplateDirective(template: string): string {
  switch (template) {
    case 'review': return tplReview;
    case 'interview': return tplInterview;
    case 'qa': return tplQA;
    case 'investment': return tplInvestment;
    default: return "";
  }
}

export async function generateBlogPost(keyword: string, dateRange: string, template: string): Promise<BlogPostResult> {
  const templateSpecific = getTemplateDirective(template);
  const dateRangeText = dateRange === 'all' ? '최신' : `지난 ${dateRange} 이내의`;

  const finalPrompt = `
    Role: You are a professional tech blog writer.
    Task: Write a high-quality blog post based on the User's Request and the following Directives.
    
    User Request:
    - Topic: "${keyword}"
    - Timeframe: ${dateRangeText}
    
    STRICT Output Rules:
    1. Output ONLY the final result in the format specified below.
    2. Do NOT include any conversational text (e.g., "Here is your blog post", "I will search now").
    3. Do NOT output the "Work Order" or "Plan". Just execute it.
    4. Ensure all tags ([TITLE], [POST], etc.) are present.
    
    DIRECTIVES:
    ${blogBase}
    
    TEMPLATE SPECIFICS:
    ${templateSpecific}
  `;

  try {
    let result;
    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        result = await (genAI as any).models.generateContent({
          model: "gemini-2.0-flash",
          contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
          config: {
            tools: [{ googleSearch: {} }],
            responseModalities: ["TEXT"],
          }
        });
        break; // Success, exit loop
      } catch (e: any) {
        attempt++;
        if (attempt > maxRetries || !e.message?.includes("429")) {
          throw e; // Not a rate limit error or max retries reached
        }
        const delay = Math.pow(2, attempt) * 2000; // Exponential backoff: 2s, 4s, 8s
        console.warn(`Rate limit hit. Retrying in ${delay}ms... (Attempt ${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    if (!result) throw new Error("Failed to generate content after retries.");

    const rawText = result.text || "";

    const titleMatch = rawText.match(/\[TITLE\]([\s\S]*?)\[\/TITLE\]/);
    const postMatch = rawText.match(/\[POST\]([\s\S]*?)\[\/POST\]/);
    const tagsMatch = rawText.match(/\[TAGS\]([\s\S]*?)\[\/TAGS\]/);
    const kwMatch = rawText.match(/\[IMAGE_KEYWORDS\]([\s\S]*?)\[\/IMAGE_KEYWORDS\]/);
    const sourcesMatch = rawText.match(/\[SOURCES\]([\s\S]*?)\[\/SOURCES\]/);

    let post = postMatch ? postMatch[1].trim() : rawText;
    const title = titleMatch ? titleMatch[1].trim() : contentService.extractTitle(rawText, post);
    const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()) : [];
    const imageKeywords = kwMatch ? kwMatch[1].split(',').map(k => k.trim()) : [];

    // Strip any "참고:" or "참고 자료" sections that AI may have included in POST
    post = post.replace(/<h[23][^>]*>\s*(참고|참고:|참고 자료|출처)[^<]*<\/h[23]>[\s\S]*?(?=<h[23]|$)/gi, '');
    post = post.replace(/<(p|div)[^>]*>\s*<strong>\s*(참고|참고:|참고 자료|출처)[^<]*<\/strong>[\s\S]*?(?=<h[23]|<\/div>|$)/gi, '');

    // Source matching with grounding URLs
    const sourceTitles = sourcesMatch ? sourcesMatch[1].trim().split('\n').map(s => s.trim()).filter(s => s) : [];

    // Check for grounding metadata in the new SDK format
    const groundingMetadata = (result as any).candidates?.[0]?.groundingMetadata;
    console.log('Grounding Metadata:', JSON.stringify(groundingMetadata, null, 2));

    const groundingUrls = (groundingMetadata?.groundingChunks || []).map((c: any) => ({
      url: c?.web?.uri || '',
      domain: c?.web?.title || ''
    })).filter((u: any) => u.url);
    console.log('Extracted Grounding URLs:', groundingUrls);

    // Build reference section - match source titles with grounding URLs
    if (sourceTitles.length > 0 || groundingUrls.length > 0) {
      let refHtml = '<div class="references" style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e5e7eb;"><h2 style="font-size: 1.5rem; margin-bottom: 1rem;">📚 참고 자료</h2><ul style="list-style: disc; padding-left: 1.5rem;">';

      if (sourceTitles.length > 0 && groundingUrls.length > 0) {
        // Try to match source titles with grounding URLs by domain
        const usedUrls = new Set<string>();

        sourceTitles.forEach((sourceTitle: string) => {
          // Extract media name from source title (e.g., "기사제목 - 조선일보" -> "조선")
          const mediaMatch = sourceTitle.match(/[-–—]\s*([^-–—]+)$/);
          const mediaName = mediaMatch ? mediaMatch[1].trim() : '';

          // Find matching grounding URL by domain
          let matchedUrl = '';
          for (const g of groundingUrls) {
            if (usedUrls.has(g.url)) continue;
            const domain = g.domain?.toLowerCase() || '';
            // Check if media name or domain matches
            if (mediaName && (
              domain.includes('chosun') && (mediaName.includes('조선') || mediaName.includes('Chosun')) ||
              domain.includes('joins') && (mediaName.includes('중앙') || mediaName.includes('JoongAng')) ||
              domain.includes('donga') && (mediaName.includes('동아') || mediaName.includes('Donga')) ||
              domain.includes('hani') && (mediaName.includes('한겨레') || mediaName.includes('Hani')) ||
              domain.includes('hankyung') && (mediaName.includes('한경') || mediaName.includes('한국경제')) ||
              domain.includes('mk.co') && (mediaName.includes('매경') || mediaName.includes('매일경제')) ||
              domain.includes('yna') && (mediaName.includes('연합') || mediaName.includes('Yonhap')) ||
              domain.includes('naver') && mediaName.includes('네이버') ||
              domain.includes('daum') && mediaName.includes('다음') ||
              domain.includes('aitimes') && mediaName.includes('AI타임스') ||
              domain.includes('eroun') && mediaName.includes('이로운') ||
              domain.includes('hyundai') && mediaName.includes('현대')
            )) {
              matchedUrl = g.url;
              usedUrls.add(g.url);
              break;
            }
          }

          // If no match found, use the first unused grounding URL
          if (!matchedUrl) {
            for (const g of groundingUrls) {
              if (!usedUrls.has(g.url)) {
                matchedUrl = g.url;
                usedUrls.add(g.url);
                break;
              }
            }
          }

          if (matchedUrl) {
            refHtml += `<li style="margin-bottom: 0.5rem;"><a href="${matchedUrl}" target="_blank" rel="noopener noreferrer" style="color: #06b6d4; text-decoration: underline;">${sourceTitle}</a></li>`;
          } else {
            refHtml += `<li style="margin-bottom: 0.5rem;">${sourceTitle}</li>`;
          }
        });
      } else if (groundingUrls.length > 0) {
        // Fallback: use grounding URLs with domain names
        groundingUrls.forEach((g: any) => {
          const displayText = g.domain || new URL(g.url).hostname;
          refHtml += `<li style="margin-bottom: 0.5rem;"><a href="${g.url}" target="_blank" rel="noopener noreferrer" style="color: #06b6d4; text-decoration: underline;">${displayText}</a></li>`;
        });
      } else {
        // Fallback: just list source titles without links
        sourceTitles.forEach((st: string) => {
          refHtml += `<li style="margin-bottom: 0.5rem;">${st}</li>`;
        });
      }

      refHtml += '</ul></div>';
      console.log('Generated Reference HTML:', refHtml);
      post += refHtml;
    }

    return { title, post, tags, imageKeywords };
  } catch (error) {
    console.error("Orchestration Error:", error);
    throw error;
  }
}

export async function fetchAndInjectImages(post: string, imageKeywords: string[], keyword: string, template: string): Promise<{ post: string }> {
  if (template === 'shorts' || template === 'longform') return { post };

  try {
    // Step 1: Ask AI to analyze post and determine better image search queries
    const analysisPrompt = `
      ${imagePlacementInstructions}
      
      ---
      
      다음 블로그 글을 분석하고 이미지 배치 정보를 생성하세요:
      
      ${post}
    `;

    const analysisResult = await (genAI as any).models.generateContent({
      model: "gemini-2.0-flash",
      contents: [{ role: "user", parts: [{ text: analysisPrompt }] }],
    });

    const analysisText = analysisResult.text || "";

    // Step 2: Parse image placement data
    const placementsMatch = analysisText.match(/\[IMAGE_PLACEMENTS\]([\s\S]*?)\[\/IMAGE_PLACEMENTS\]/);

    if (!placementsMatch) {
      console.warn("No image placements found in AI response, falling back to legacy method");
      const englishKws = await imageService.translateKeywordsToEnglish(imageKeywords, genAI);
      const images = await imageService.generateAIImages(englishKws);
      const finalPost = contentService.injectImagesIntoHtml(post, images, keyword);
      return { post: finalPost };
    }

    const placementText = placementsMatch[1];
    const imgMatches = placementText.matchAll(/\[IMG\d+\]([\s\S]*?)\[\/IMG\d+\]/g);

    const placements: contentService.ImagePlacement[] = [];

    for (const match of imgMatches) {
      const block = match[1];
      const posMatch = block.match(/position:\s*(.+)/);
      const promptMatch = block.match(/imagePrompt:\s*(.+)/);
      const captionMatch = block.match(/caption:\s*(.+)/);

      if (posMatch && promptMatch && captionMatch) {
        const position = posMatch[1].trim();
        const imagePrompt = promptMatch[1].trim();
        const caption = captionMatch[1].trim();

        // Step 3: Use AI-generated prompt for Pexels search (better relevance)
        console.log(`Searching Pexels for: ${imagePrompt.substring(0, 50)}...`);
        const images = await imageService.generateAIImages([imagePrompt]);

        if (images.length > 0) {
          placements.push({ position, imageUrl: images[0].url, caption });
        } else {
          console.warn(`Failed to find image for position ${position}`);
        }
      }
    }

    // Step 4: Inject images at specified positions
    if (placements.length > 0) {
      const finalPost = contentService.injectImagesAtPositions(post, placements);
      return { post: finalPost };
    }

    // If no images were generated, return original post
    return { post };

  } catch (error) {
    console.error("Agentic image workflow error:", error);
    // Fallback: return post without images
    return { post };
  }
}
