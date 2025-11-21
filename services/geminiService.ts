import { GoogleGenAI } from "@google/genai";

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

export interface BlogPostResult {
    title: string;
    post: string;
    tags: string[];
}

function getPrompt(keyword: string, dateRangePrompt: string, template: string): string {
    const commonInstructions = `
      작업 지시사항 (아래 순서를 반드시 지켜주세요):
      1.  **뉴스 검색**: Google 검색 도구를 사용하여 위 키워드에 대한 ${dateRangePrompt} 뉴스 기사 5개를 찾으세요.
      2.  **내용 분석 및 본문 초안 작성**: 찾은 5개의 뉴스 기사 내용을 종합하고 분석하여, 하나의 완성된 블로그 글 본문 초안을 작성하세요. **이 단계에서는 아직 이미지를 삽입하지 마세요.**
      3.  **태그 생성**: 작성한 본문 초안의 내용과 가장 관련성이 높은 키워드 태그 10개를 쉼표(,)로 구분하여 생성해주세요. 예시: AI,반도체,기술,시장동향,NVIDIA,삼성전자,TSMC,미래기술,투자,혁신
      4.  **이미지 검색 및 삽입**: **방금 생성한 태그 10개 중에서 가장 핵심적이고 대표적인 태그 3개를 선정하세요.** 그 3개의 태그를 검색어로 사용하여 글의 내용과 흐름에 어울리는 고품질의 이미지를 **오직 Pexels (www.pexels.com) 에서만** 2~3개 찾으세요. 찾은 이미지를 2번 단계에서 작성한 본문 초안의 중간중간에 자연스럽게 삽입하여 본문을 완성하세요. **Pexels 이외의 다른 이미지 소스(Unsplash, Wikimedia Commons 등)는 절대 사용하지 마세요.** 이미지는 반드시 HTML \`<figure>\` 태그를 사용하여 아래와 같은 Pexels 출처 표기 형식으로 삽입하고, **Pexels의 사진 작가 이름과 URL을 정확하게 표기**해야 합니다.
          \`\`\`html
          <figure style="margin: 2.5em 0; text-align: center; clear: both; page-break-inside: avoid;">
              <img src="VALID_PEXELS_IMAGE_URL" alt="이미지에 대한 상세하고 구체적인 설명" style="max-width: 100%; height: auto; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);" />
              <figcaption style="font-size: 0.85em; color: #888; margin-top: 0.7em;">
                  Photo by <a href="PEXELS_PHOTOGRAPHER_URL" target="_blank" rel="noopener noreferrer">PHOTOGRAPHER_NAME</a> on <a href="https://www.pexels.com" target="_blank" rel="noopener noreferrer">Pexels</a>
              </figcaption>
          </figure>
          \`\`\`
      5.  **제목 생성**: 완성된 글의 내용을 바탕으로, 사용자의 클릭을 유도할 수 있는 매력적이고(후킹), 검색 엔진 최적화(SEO)에 유리한 제목을 생성해주세요. 제목에는 반드시 핵심 키워드가 포함되어야 합니다.
      6.  **참고 자료 추가**: 글의 마지막에 '참고 자료'라는 <h2> 제목을 포함하고, 그 아래에 당신이 참고한 뉴스 기사 5개의 제목과 링크를 <ul> 목록으로 반드시 포함해주세요. 각 목록 항목은 <li><a href="뉴스기사_URL" target="_blank" rel="noopener noreferrer">뉴스기사_제목</a></li> 형식이어야 합니다. 예를 들어, 다음과 같은 형식입니다: <li><a href="https://example.com/news-article-1" target="_blank" rel="noopener noreferrer">AI 반도체 시장의 최신 동향</a></li>
      7.  **공통 규칙**:
          -   **언어**: 글은 반드시 한국어로 작성해야 합니다.
          -   **분량**: 글의 본문 길이는 3,000자에서 4,000자 사이여야 합니다.
          -   **본문 형식**: 글의 본문은 HTML 형식이어야 합니다. <html>, <head>, <body> 태그는 제외하고, 글의 본문에 해당하는 HTML 태그(예: <h2>, <h3>, <p>, <ul>, <ol>, <li>, <strong>, <blockquote> 등)만 사용해주세요. 인라인 CSS는 꼭 필요한 경우(예: 이미지 스타일링)에만 최소한으로 사용하세요.
      8.  **최종 결과물 형식**: 작업 완료 후, 글 제목, 본문, 태그를 각각 [TITLE], [POST], [TAGS] 섹션으로 구분하여 아래 형식에 맞춰 정확하게 반환해주세요. 다른 설명이나 추가 텍스트 없이 이 형식만 반환해야 합니다.
[TITLE]
여기에 5번 단계에서 생성한 제목을 넣어주세요.
[/TITLE]
[POST]
여기에 4번 단계에서 완성한 HTML 본문을 넣어주세요.
[/POST]
[TAGS]
여기에 3번 단계에서 생성한 태그 목록을 넣어주세요.
[/TAGS]
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
        tools: [{googleSearch: {}}],
      },
    });
    
    const rawText = response.text;
    
    const titleMatch = rawText.match(/\[TITLE\]([\s\S]*?)\[\/TITLE\]/);
    const postMatch = rawText.match(/\[POST\]([\s\S]*?)\[\/POST\]/);
    const tagsMatch = rawText.match(/\[TAGS\]([\s\S]*?)\[\/TAGS\]/);

    let title = titleMatch ? titleMatch[1].trim() : '';
    let post = postMatch ? postMatch[1].trim() : '';
    const tagsString = tagsMatch ? tagsMatch[1].trim() : '';

    // If the response doesn't follow the expected format, handle it gracefully.
    if (!titleMatch && !postMatch && !tagsMatch) {
      // Assume the entire response is the post content if no tags are found.
      post = rawText;
      title = keyword; // Use the keyword as a fallback title.
    } else {
      // If some tags are missing, try to construct a reasonable result.
      if (!title) {
        title = '제목을 생성하지 못했습니다.';
      }
      if (!post) {
        // If post is missing, it's the most critical part.
        // Let's try to extract it by removing other known tags.
        post = rawText
          .replace(/\[TITLE\][\s\S]*?\[\/TITLE\]/, '')
          .replace(/\[TAGS\][\s\S]*?\[\/TAGS\]/, '')
          .trim();
        
        // If it's still empty, it's better to show an error message.
        if (!post) {
            post = '<p>블로그 본문을 생성하는 데 실패했습니다. AI가 예상치 못한 형식으로 응답했을 수 있습니다. 다른 키워드나 옵션으로 다시 시도해 보세요.</p>';
        }
      }
    }
    
    const tags = tagsString.split(',').map(tag => tag.trim()).filter(Boolean);

    return { title, post, tags: tags.slice(0, 10) };

  } catch (error) {
    console.error("Error generating blog post with Gemini:", error);
    if (error instanceof Error) {
        throw new Error(`블로그 글 생성 중 오류 발생: ${error.message}`);
    }
    throw new Error("알 수 없는 오류가 발생했습니다.");
  }
}