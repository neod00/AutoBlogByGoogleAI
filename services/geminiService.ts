import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.API_KEY;
const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export interface BlogPostResult {
  title: string;
  post: string;
  tags: string[];
  imageKeywords?: string[];
}

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  photographer_id: number;
  avg_color: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
    portrait: string;
    landscape: string;
    tiny: string;
  };
  alt: string;
}

interface PexelsResponse {
  total_results: number;
  page: number;
  per_page: number;
  photos: PexelsPhoto[];
  next_page?: string;
}

/**
 * Validates and checks if Pexels API Key is available
 */
function isPexelsConfigured(): boolean {
  return !!PEXELS_API_KEY;
}

/**
 * Fetches images from Pexels API based on a query
 */
async function fetchImagesFromPexels(query: string, count: number = 3): Promise<PexelsPhoto[]> {
  if (!isPexelsConfigured()) {
    console.warn("PEXELS_API_KEY is not set. Skipping image fetch.");
    return [];
  }

  try {
    const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&locale=ko-KR`, {
      headers: {
        Authorization: PEXELS_API_KEY!,
      },
    });

    if (!response.ok) {
      throw new Error(`Pexels API Error: ${response.status} ${response.statusText}`);
    }

    const data: PexelsResponse = await response.json();
    return data.photos || [];
  } catch (error) {
    console.error("Failed to fetch images from Pexels:", error);
    return [];
  }
}

/**
 * Stage 2: Extract title from the raw AI response content
 * Tries multiple strategies to find a suitable title
 */
function extractTitleFromContent(rawText: string, post: string): string {
  // Try to find H1 tag in the content
  const h1Match = post.match(/<h1[^>]*>(.*?)<\/h1>/i);
  if (h1Match && h1Match[1].trim()) {
    return h1Match[1].trim().replace(/<[^>]*>/g, ''); // Remove any HTML tags
  }

  // Try to find the first H2 tag as a fallback
  const h2Match = post.match(/<h2[^>]*>(.*?)<\/h2>/i);
  if (h2Match && h2Match[1].trim()) {
    return h2Match[1].trim().replace(/<[^>]*>/g, '');
  }

  // Try to extract the first line from raw text that looks like a title
  const lines = rawText.split('\n').map(line => line.trim()).filter(Boolean);
  for (const line of lines) {
    // Skip lines that are tags like [TITLE], [POST], etc.
    if (line.match(/^\[\/?\w+\]$/)) continue;

    // Skip lines that are HTML tags
    if (line.match(/^<\/?[\w\s="':;.#-\/\?\&]+>$/)) continue;

    // If the line is reasonably short (title-like) and doesn't start with HTML
    if (line.length > 10 && line.length < 150 && !line.startsWith('<')) {
      const plainText = line.replace(/<[^>]*>/g, '').trim();
      if (plainText.length > 10) {
        return plainText;
      }
    }
  }

  return '';
}

/**
 * Stage 3: Generate meaningful fallback title based on keyword and content
 */
function generateFallbackTitle(keyword: string, post: string): string {
  // Extract some context from the post to make the title more meaningful
  const textContent = post.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

  // Common patterns for generating contextual titles
  const templates = [
    `${keyword}: 최신 동향과 분석`,
    `${keyword}에 대한 모든 것`,
    `${keyword} 완벽 가이드`,
    `알아야 할 ${keyword} 핵심 정보`,
    `${keyword} 시장 분석 리포트`
  ];

  // Try to detect the type of content and choose appropriate template
  if (textContent.includes('투자') || textContent.includes('시장')) {
    return `${keyword} 시장 동향 및 투자 전망`;
  } else if (textContent.includes('기술') || textContent.includes('혁신')) {
    return `${keyword}: 기술 혁신과 미래 전망`;
  } else if (textContent.includes('리뷰') || textContent.includes('장점') || textContent.includes('단점')) {
    return `${keyword} 심층 분석 및 리뷰`;
  }

  // Default: Use the first template
  return templates[0];
}

function getPrompt(keyword: string, dateRangePrompt: string, template: string): string {
  const commonInstructions = `
      작업 지시사항 (아래 순서를 반드시 지켜주세요):
      1.  **뉴스 검색**: Google 검색 도구를 사용하여 위 키워드에 대한 ${dateRangePrompt} 뉴스 기사 5개를 찾으세요.
      2.  **내용 분석 및 본문 초안 작성**: 찾은 5개의 뉴스 기사 내용을 종합하고 분석하여, 하나의 완성된 블로그 글 본문 초안을 작성하세요.
      3.  **태그 생성**: 작성한 본문 초안의 내용과 가장 관련성이 높은 키워드 태그 10개를 쉼표(,)로 구분하여 생성해주세요. 예시: AI,반도체,기술,시장동향,NVIDIA,삼성전자,TSMC,미래기술,투자,혁신
      4.  **이미지 검색 키워드 생성**: 블로그 글의 내용과 어울리는 이미지를 찾기 위한 **영어 검색 키워드** 3개를 생성해주세요. 이 키워드는 Pexels 이미지 검색에 사용됩니다. 글의 주제, 분위기, 핵심 개념을 잘 나타내는 구체적인 영어 단어나 구문을 사용하세요. 예시: government support,financial aid,Korean economy 또는 AI chip,semiconductor factory,technology innovation
      5.  **(이미지 관련 지시사항 없음)**: **이미지는 절대 직접 생성하거나 삽입하지 마세요.** 오로지 텍스트와 태그만 생성하면 됩니다.
      6.  **제목 생성**: 완성된 글의 내용을 바탕으로, 사용자의 클릭을 유도할 수 있는 매력적이고(후킹), 검색 엔진 최적화(SEO)에 유리한 제목을 생성해주세요. 제목에는 반드시 핵심 키워드가 포함되어야 합니다.
      7.  **참고 자료 제목 제공**: 본문([POST])에는 참고 자료 섹션을 포함하지 마세요. 대신 [SOURCES] 섹션에 검색한 뉴스 기사들의 제목을 **검색한 순서 그대로** 한 줄에 하나씩 작성해주세요. 각 제목 끝에 반드시 " - 언론사명" 형식으로 언론사를 포함해주세요. 예시: "삼성전자 신고가 경신 - 연합뉴스"
      8.  **공통 규칙**:
          -   **언어**: 글은 반드시 한국어로 작성해야 합니다.
          -   **분량**: 글의 본문 길이는 3,000자에서 4,000자 사이여야 합니다.
          -   **본문 형식**: 글의 본문은 HTML 형식이어야 합니다. <html>, <head>, <body> 태그는 제외하고, 글의 본문에 해당하는 HTML 태그(예: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote> 등)만 사용해주세요. 인라인 CSS는 꼭 필요한 경우(예: 이미지 스타일링)에만 최소한으로 사용하세요.
      9.  **최종 결과물 형식**: 작업 완료 후, 글 제목, 본문, 태그, 이미지 키워드, 참고 뉴스 제목을 각각 [TITLE], [POST], [TAGS], [IMAGE_KEYWORDS], [SOURCES] 섹션으로 구분하여 아래 형식에 맞춰 정확하게 반환해주세요. 다른 설명이나 추가 텍스트 없이 이 형식만 반환해야 합니다.
[TITLE]
여기에 제목을 넣어주세요.
[/TITLE]
[POST]
여기에 HTML 본문을 넣어주세요. (참고 자료 섹션은 제외)
[/POST]
[TAGS]
태그1,태그2,태그3,...
[/TAGS]
[IMAGE_KEYWORDS]
영어키워드1,영어키워드2,영어키워드3
[/IMAGE_KEYWORDS]
[SOURCES]
뉴스 기사 제목 - 언론사명
뉴스 기사 제목 - 언론사명
뉴스 기사 제목 - 언론사명
뉴스 기사 제목 - 언론사명
뉴스 기사 제목 - 언론사명
[/SOURCES]
    `;




  switch (template) {
    case 'review':
      return `
              당신은 전문 테크/제품 리뷰어입니다. 사용자가 제공한 키워드와 관련된 제품 또는 서비스에 대한 심층 리뷰 블로그 글을 작성해야 합니다.

              키워드: "${keyword}"

              리뷰 글의 구조는 다음을 따라주세요:
              -   <h2>[제품/서비스 이름] 소개</h2>: 뉴스를 기반으로 어떤 제품/서비스인지, 왜 주목받고 있는지 소개합니다.
              -   <h2>주요 특징 및 기능</h2>: 뉴스를 통해 파악한 핵심적인 특징과 기능들을 상세히 설명합니다.
              -   <h2>장점</h2>: 이 제품/서비스의 긍정적인 측면, 강점 등을 분석하여 목록으로 제시합니다.
              -   <h2>단점</h2>: 예상되는 문제점, 한계, 아쉬운 점 등을 분석하여 목록으로 제시합니다.
              -   <h2>추천 대상</h2>: 어떤 사용자들에게 이 제품/서비스가 유용할지 구체적으로 추천합니다.
              -   <h2>결론 및 총평</h2>: 전체 내용을 요약하며 최종적인 평가와 함께 글을 마무리합니다.

              ${commonInstructions}
            `;
    case 'interview':
      return `
              당신은 전문 IT 저널리스트입니다. 사용자가 제공한 키워드 분야의 가상 전문가와 진행하는 인터뷰 형식의 블로그 글을 작성해야 합니다.

              키워드: "${keyword}"

              인터뷰 글의 구조는 다음을 따라주세요:
              -   <h2>[키워드] 분야 전문가와의 대담</h2>: 인터뷰의 배경과 목적, 그리고 가상의 전문가(예: "AI 연구소의 김박사")를 간략히 소개하는 서론을 작성합니다.
              -   <h3>[첫 번째 질문]</h3>: <p>[전문가의 답변]</p>
              -   <h3>[두 번째 질문]</h3>: <p>[전문가의 답변]</p>
              -   ... (뉴스 내용을 바탕으로 5~7개 정도의 심도 있는 질문과 답변을 구성해주세요.)
              -   <h2>인터뷰를 마치며</h2>: 인터뷰 내용을 요약하고, 앞으로의 전망 등을 제시하며 마무리합니다.

              **중요**: 전문가의 답변은 반드시 찾은 5개의 뉴스 기사 내용을 근거로 하여, 깊이 있고 설득력 있게 작성해야 합니다.

              ${commonInstructions}
            `;
    case 'qa':
      return `
              당신은 특정 주제에 대해 독자의 궁금증을 풀어주는 전문 지식 블로거입니다. 사용자가 제공한 키워드에 대해 독자들이 가장 궁금해할 만한 질문과 답변(Q&A) 형식의 블로그 글을 작성해야 합니다.

              키워드: "${keyword}"

              Q&A 글의 구조는 다음을 따라주세요:
              -   <h2>[키워드]에 대해 무엇이든 물어보세요</h2>: Q&A 포스팅의 취지를 설명하는 서론을 작성합니다.
              -   <h3>Q. [예상 질문 1]</h3>: <p>[답변 1]</p>
              -   <h3>Q. [예상 질문 2]</h3>: <p>[답변 2]</p>
              -   ... (뉴스 내용을 바탕으로 독자들이 궁금해할 만한 핵심적인 질문과 답변 5~7개를 구성해주세요.)
              -   <h2>마무리하며</h2>: 전체 Q&A 내용을 간략히 요약하고 추가 정보나 조언으로 글을 마무리합니다.

              **중요**: 답변 내용은 반드시 찾은 5개의 뉴스 기사 내용을 근거로 하여, 명확하고 이해하기 쉽게 작성해야 합니다.

              ${commonInstructions}
            `;
    case 'investment':
      return `
              당신은 전문 금융 애널리스트입니다. 사용자가 제공한 키워드와 관련된 최신 뉴스들을 분석하여, 전문적인 투자 전략 보고서를 작성해야 합니다.

              키워드: "${keyword}"

              투자 보고서의 구조는 다음을 따라주세요:
              -   <h2>시장 개요 및 최신 동향</h2>: 뉴스를 기반으로 해당 시장의 현재 상황, 주요 플레이어, 그리고 최신 기술/정책 동향을 요약합니다.
              -   <h2>핵심 투자 포인트</h2>: 분석한 내용을 바탕으로 왜 지금 이 분야에 주목해야 하는지에 대한 핵심적인 투자 논리를 2~3가지 제시합니다.
              -   <h2>기회 요인</h2>: 향후 시장 성장을 견인할 수 있는 긍정적인 요소나 기회들을 구체적으로 설명합니다.
              -   <h2>리스크 요인</h2>: 투자 시 고려해야 할 잠재적인 위험, 시장의 불확실성, 경쟁 심화 등의 리스크를 분석합니다.
              -   <h2>투자 전략 및 결론</h2>: 종합적인 분석을 바탕으로 단기/중장기적 관점의 투자 전략을 제시하고, 전체 보고서 내용을 요약하며 결론을 내립니다.

              **중요**: 모든 분석과 주장은 반드시 찾은 5개의 뉴스 기사를 근거로 하여, 객관적이고 데이터 기반으로 작성해야 합니다. 감정적이거나 추측성 발언은 피해주세요.

              ${commonInstructions}
            `;
    case 'default':
    default:
      return `
              당신은 전문 블로그 작가입니다. 사용자가 제공한 키워드와 관련된 블로그 글을 작성해야 합니다.

              키워드: "${keyword}"

              ${commonInstructions}
            `;
  }
}


export async function generateBlogPost(keyword: string, dateRange: string, template: string): Promise<BlogPostResult> {
  let dateRangePrompt = '';
  switch (dateRange) {
    case 'day':
      dateRangePrompt = '지난 24시간 이내에 발행된';
      break;
    case 'week':
      dateRangePrompt = '지난 1주일 이내에 발행된';
      break;
    case 'month':
      dateRangePrompt = '지난 1개월 이내에 발행된';
      break;
    case 'year':
      dateRangePrompt = '지난 1년 이내에 발행된';
      break;
    default: // 'all'
      dateRangePrompt = '최신';
      break;
  }

  const prompt = getPrompt(keyword, dateRangePrompt, template);

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });

    const rawText = response.text;

    const titleMatch = rawText.match(/\[TITLE\]([\s\S]*?)\[\/TITLE\]/);
    const postMatch = rawText.match(/\[POST\]([\s\S]*?)\[\/POST\]/);
    const tagsMatch = rawText.match(/\[TAGS\]([\s\S]*?)\[\/TAGS\]/);
    const imageKeywordsMatch = rawText.match(/\[IMAGE_KEYWORDS\]([\s\S]*?)\[\/IMAGE_KEYWORDS\]/);
    const sourcesMatch = rawText.match(/\[SOURCES\]([\s\S]*?)\[\/SOURCES\]/);

    let title = titleMatch ? titleMatch[1].trim() : '';
    let post = postMatch ? postMatch[1].trim() : '';
    const tagsString = tagsMatch ? tagsMatch[1].trim() : '';
    const tags = tagsString.split(',').map(tag => tag.trim()).filter(Boolean);
    const imageKeywordsString = imageKeywordsMatch ? imageKeywordsMatch[1].trim() : '';
    const imageKeywords = imageKeywordsString.split(',').map(kw => kw.trim()).filter(Boolean);

    // Extract source titles from [SOURCES] section
    const sourcesString = sourcesMatch ? sourcesMatch[1].trim() : '';
    const sourceTitles = sourcesString.split('\n').map(s => s.trim().replace(/^[-•*\d.]+\s*/, '')).filter(Boolean);

    // Extract grounding metadata from API response
    const groundingMetadata = (response.candidates?.[0] as any)?.groundingMetadata;
    const groundingChunks = groundingMetadata?.groundingChunks || [];

    // Build URL list with domain info
    const groundingUrls: { url: string; domain: string }[] = groundingChunks.map((chunk: any) => ({
      url: chunk?.web?.uri || '',
      domain: chunk?.web?.title || '' // Domain like "chosun.com"
    })).filter((item: any) => item.url);

    // If the response doesn't follow the expected format, handle it gracefully.
    if (!titleMatch && !postMatch && !tagsMatch) {
      // Assume the entire response is the post content if no tags are found.
      post = rawText;
      title = keyword; // Use the keyword as a fallback title.
    } else {
      // If post is missing, try to extract it by removing other known tags.
      if (!post) {
        post = rawText
          .replace(/\[TITLE\][\s\S]*?\[\/TITLE\]/, '')
          .replace(/\[TAGS\][\s\S]*?\[\/TAGS\]/, '')
          .replace(/\[SOURCES\][\s\S]*?\[\/SOURCES\]/, '')
          .trim();

        // If it's still empty, show an error message.
        if (!post) {
          post = '<p>블로그 본문을 생성하는 데 실패했습니다. AI가 예상치 못한 형식으로 응답했을 수 있습니다. 다른 키워드나 옵션으로 다시 시도해 보세요.</p>';
        }
      }

      // Enhanced title extraction with multi-stage fallback
      if (!title) {
        // Stage 2: Try to extract title from the generated content
        title = extractTitleFromContent(rawText, post);

        // Stage 3: Generate meaningful fallback title if extraction failed
        if (!title) {
          title = generateFallbackTitle(keyword, post);
        }
      }
    }

    // Korean media outlet name-to-domain mapping for accurate URL matching
    const mediaNameToDomain: Record<string, string[]> = {
      '연합뉴스': ['yna.co.kr', 'yonhapnews.co.kr'],
      '연합': ['yna.co.kr', 'yonhapnews.co.kr'],
      '머니투데이': ['mt.co.kr'],
      '매일경제': ['mk.co.kr'],
      '매경': ['mk.co.kr'],
      '조선일보': ['chosun.com'],
      '조선': ['chosun.com'],
      '조선비즈': ['biz.chosun.com'],
      '동아일보': ['donga.com'],
      '동아': ['donga.com'],
      '한국경제': ['hankyung.com'],
      '한경': ['hankyung.com'],
      '한겨레': ['hani.co.kr'],
      'SBS': ['sbs.co.kr'],
      'KBS': ['kbs.co.kr'],
      'MBC': ['mbc.co.kr'],
      'YTN': ['ytn.co.kr'],
      '뉴시스': ['newsis.com'],
      '뉴스1': ['news1.kr'],
      '전자신문': ['etnews.com'],
      'ZDNet': ['zdnet.co.kr'],
      '서울경제': ['sedaily.com'],
      '이데일리': ['edaily.co.kr'],
      '뉴데일리': ['newdaily.co.kr'],
      '파이낸셜뉴스': ['fnnews.com'],
      '파이낸셜': ['fnnews.com'],
      '한국경제TV': ['wowtv.co.kr'],
      '다음': ['daum.net', 'v.daum.net'],
      'Daum': ['daum.net', 'v.daum.net'],
      '네이버': ['naver.com', 'news.naver.com'],
      'Naver': ['naver.com', 'news.naver.com'],
      '비즈니스포스트': ['businesspost.co.kr'],
      '연합인포맥스': ['infomax.co.kr', 'einfomax.co.kr'],
      '아시아경제': ['asiae.co.kr'],
      '노컷뉴스': ['nocutnews.co.kr'],
      'CBS': ['nocutnews.co.kr'],
      'JTBC': ['jtbc.co.kr'],
      'TV조선': ['tvchosun.com'],
      '문화일보': ['munhwa.com'],
      '뉴스탑코리아': ['newstopkorea.com'],
      '지디넷코리아': ['g-enews.com'],
      '티스토리': ['tistory.com'],
    };

    // Function to extract media name from title (usually at the end after " - ")
    const extractMediaName = (titleStr: string): string => {
      const match = titleStr.match(/[-–—]\s*([^-–—]+)$/);
      return match ? match[1].trim() : '';
    };

    // Function to find matching URL for a given source title
    const findMatchingUrl = (sourceTitle: string, urlList: { url: string; domain: string }[], usedIndices: Set<number>): { url: string; index: number } | null => {
      const mediaName = extractMediaName(sourceTitle);
      if (!mediaName) return null;

      // Get expected domains for this media name
      const expectedDomains = mediaNameToDomain[mediaName] || [];

      // Try to find a matching URL by domain
      for (let i = 0; i < urlList.length; i++) {
        if (usedIndices.has(i)) continue;

        const { domain } = urlList[i];
        // Check if the domain matches any expected domain for this media
        const isMatch = expectedDomains.some(expected =>
          domain.includes(expected) || expected.includes(domain)
        );

        if (isMatch) {
          return { url: urlList[i].url, index: i };
        }
      }

      return null;
    };

    // Generate references section using AI-provided titles with domain-based URL matching
    if (sourceTitles.length > 0 && groundingUrls.length > 0) {
      let referencesHtml = '<div class="references-section" style="margin-top: 3em; padding-top: 2em; border-top: 1px solid #e5e7eb;">';
      referencesHtml += '<h2 style="font-size: 1.25em; font-weight: bold; color: #374151; margin-bottom: 1em;">📚 참고 자료</h2>';
      referencesHtml += '<ul style="list-style: none; padding: 0; margin: 0;">';

      const usedUrlIndices = new Set<number>();

      for (let i = 0; i < Math.min(sourceTitles.length, 5); i++) {
        const sourceTitle = sourceTitles[i];

        // Try domain-based matching first
        const matchResult = findMatchingUrl(sourceTitle, groundingUrls, usedUrlIndices);

        let finalUrl = '';
        if (matchResult) {
          finalUrl = matchResult.url;
          usedUrlIndices.add(matchResult.index);
        } else if (groundingUrls[i] && !usedUrlIndices.has(i)) {
          // Fallback: use URL at same index
          finalUrl = groundingUrls[i].url;
          usedUrlIndices.add(i);
        }

        if (finalUrl) {
          referencesHtml += `<li style="margin-bottom: 0.8em;"><a href="${finalUrl}" target="_blank" rel="noopener noreferrer" style="color: #2563eb; text-decoration: none;">${sourceTitle}</a></li>`;
        } else {
          referencesHtml += `<li style="margin-bottom: 0.8em; color: #6b7280;">${sourceTitle}</li>`;
        }
      }

      referencesHtml += '</ul></div>';
      post += referencesHtml;
    }


    // Return blog post without images - images will be added separately via fetchAndInjectImages
    return { title, post, tags: tags.slice(0, 10), imageKeywords };

  } catch (error) {
    console.error("Error generating blog post with Gemini:", error);
    if (error instanceof Error) {
      throw new Error(`블로그 글 생성 중 오류 발생: ${error.message}`);
    }
    throw new Error("알 수 없는 오류가 발생했습니다.");
  }
}


/**
 * Fetches images from Pexels using the provided keywords and injects them into the post
 * @param post - The HTML blog post content
 * @param imageKeywords - Array of English keywords to search for images
 * @param fallbackKeyword - Fallback keyword (original Korean keyword) if no images found
 * @returns The post with images injected
 */
export async function fetchAndInjectImages(
  post: string,
  imageKeywords: string[],
  fallbackKeyword: string
): Promise<{ post: string; imagesFound: boolean }> {
  if (!isPexelsConfigured()) {
    console.warn("PEXELS_API_KEY is not set. Skipping image fetch.");
    return { post, imagesFound: false };
  }

  let images: PexelsPhoto[] = [];

  // Priority 1: Use provided image keywords
  if (imageKeywords.length > 0) {
    for (const imgKeyword of imageKeywords) {
      images = await fetchImagesFromPexels(imgKeyword);
      if (images.length > 0) {
        console.log(`Found images using keyword: ${imgKeyword}`);
        break;
      }
    }
  }

  // Priority 2: Final fallback to original keyword
  if (images.length === 0) {
    images = await fetchImagesFromPexels(fallbackKeyword);
  }

  if (images.length === 0) {
    return { post, imagesFound: false };
  }

  // Insert images into the post
  const paragraphs = post.split('</p>');
  const totalParagraphs = paragraphs.length;

  if (totalParagraphs > 3) {
    let injectedPost = '';
    let imageIndex = 0;

    const points = [
      Math.floor(totalParagraphs * 0.2),
      Math.floor(totalParagraphs * 0.5),
      Math.floor(totalParagraphs * 0.8)
    ];

    for (let i = 0; i < paragraphs.length; i++) {
      injectedPost += paragraphs[i] + '</p>';

      if (images[imageIndex] && points.includes(i + 1)) {
        const img = images[imageIndex];
        const imgHtml = `
          <figure style="margin: 2.5em 0; text-align: center; clear: both; page-break-inside: avoid;">
            <img src="${img.src.large}" alt="${img.alt || fallbackKeyword}" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" />
            <figcaption style="font-size: 0.85em; color: #888; margin-top: 0.7em;">
              Photo by <a href="${img.photographer_url}" target="_blank" rel="noopener noreferrer">${img.photographer}</a> on <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>
            </figcaption>
          </figure>
        `;
        injectedPost += imgHtml;
        imageIndex++;
      }
    }
    return { post: injectedPost, imagesFound: true };
  } else {
    // Content is too short, just append one image after the first paragraph
    if (paragraphs.length >= 1) {
      const img = images[0];
      const imgHtml = `
          <figure style="margin: 2.5em 0; text-align: center; clear: both; page-break-inside: avoid;">
            <img src="${img.src.large}" alt="${img.alt || fallbackKeyword}" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" />
            <figcaption style="font-size: 0.85em; color: #888; margin-top: 0.7em;">
              Photo by <a href="${img.photographer_url}" target="_blank" rel="noopener noreferrer">${img.photographer}</a> on <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>
            </figcaption>
          </figure>
        `;
      return { post: paragraphs[0] + '</p>' + imgHtml + paragraphs.slice(1).join('</p>'), imagesFound: true };
    }
  }

  return { post, imagesFound: false };
}
