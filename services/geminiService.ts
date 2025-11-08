import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export interface BlogPostResult {
    post: string;
}

export async function generateBlogPost(keyword: string, dateRange: string): Promise<BlogPostResult> {
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
  
  const prompt = `
    당신은 전문 블로그 작가입니다. 사용자가 제공한 키워드와 관련된 블로그 글을 작성해야 합니다.

    키워드: "${keyword}"

    작업 지시사항:
    1.  Google 검색 도구를 사용하여 위 키워드에 대한 ${dateRangePrompt} 뉴스 기사 5개를 찾으세요.
    2.  찾은 5개의 뉴스 기사 내용을 종합하고 분석하여, 하나의 완성된 블로그 글을 작성하세요.
    3.  글은 반드시 한국어로 작성해야 합니다.
    4.  글의 길이는 3,000자에서 4,000자 사이여야 합니다.
    5.  독자의 흥미를 끌 수 있도록 서론, 여러 개의 본론 문단, 그리고 결론으로 구성된 논리적인 구조를 갖춰야 합니다.
    6.  단순한 뉴스 요약이 아닌, 여러 정보를 엮어 새로운 관점이나 깊이 있는 분석을 제공하는 것처럼 작성해주세요.
    7.  글의 최종 결과물은 HTML 형식이어야 합니다. <html>, <head>, <body> 태그는 제외하고, 글의 본문에 해당하는 HTML 태그(예: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote> 등)만 사용하여 작성해주세요. CSS 스타일은 포함하지 마세요.
    8.  글의 마지막에 '참고 자료'라는 <h2> 제목을 포함하고, 그 아래에 당신이 참고한 뉴스 기사 5개의 제목과 링크를 <ul> 목록으로 반드시 포함해주세요. 각 목록 항목은 <li><a href="뉴스기사_URL" target="_blank" rel="noopener noreferrer">뉴스기사_제목</a></li> 형식이어야 합니다. 예를 들어, 다음과 같은 형식입니다: <li><a href="https://example.com/news-article-1" target="_blank" rel="noopener noreferrer">AI 반도체 시장의 최신 동향</a></li>
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        tools: [{googleSearch: {}}],
      },
    });
    
    const post = response.text;

    return { post };
  } catch (error) {
    console.error("Error generating blog post with Gemini:", error);
    if (error instanceof Error) {
        throw new Error(`블로그 글 생성 중 오류 발생: ${error.message}`);
    }
    throw new Error("알 수 없는 오류가 발생했습니다.");
  }
}