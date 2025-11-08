import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export interface BlogPostResult {
    post: string;
}

function getPrompt(keyword: string, dateRangePrompt: string, template: string): string {
    const commonInstructions = `
      작업 지시사항:
      1.  Google 검색 도구를 사용하여 위 키워드에 대한 ${dateRangePrompt} 뉴스 기사 5개를 찾으세요.
      2.  찾은 5개의 뉴스 기사 내용을 종합하고 분석하여, 하나의 완성된 블로그 글을 작성하세요.
      3.  글은 반드시 한국어로 작성해야 합니다.
      4.  글의 길이는 3,000자에서 4,000자 사이여야 합니다.
      5.  독자의 흥미를 끌 수 있도록 논리적인 구조를 갖춰야 합니다.
      6.  단순한 뉴스 요약이 아닌, 여러 정보를 엮어 새로운 관점이나 깊이 있는 분석을 제공하는 것처럼 작성해주세요.
      7.  글의 최종 결과물은 HTML 형식이어야 합니다. <html>, <head>, <body> 태그는 제외하고, 글의 본문에 해당하는 HTML 태그(예: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote> 등)만 사용하여 작성해주세요. CSS 스타일은 포함하지 마세요.
      8.  글의 마지막에 '참고 자료'라는 <h2> 제목을 포함하고, 그 아래에 당신이 참고한 뉴스 기사 5개의 제목과 링크를 <ul> 목록으로 반드시 포함해주세요. 각 목록 항목은 <li><a href="뉴스기사_URL" target="_blank" rel="noopener noreferrer">뉴스기사_제목</a></li> 형식이어야 합니다. 예를 들어, 다음과 같은 형식입니다: <li><a href="https://example.com/news-article-1" target="_blank" rel="noopener noreferrer">AI 반도체 시장의 최신 동향</a></li>
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
        case 'default':
        default:
            return `
              당신은 전문 블로그 작가입니다. 사용자가 제공한 키워드와 관련된 블로그 글을 작성해야 합니다.

              키워드: "${keyword}"

              ${commonInstructions.replace('논리적인 구조를 갖춰야 합니다.', '서론, 여러 개의 본론 문단, 그리고 결론으로 구성된 논리적인 구조를 갖춰야 합니다.')}
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
