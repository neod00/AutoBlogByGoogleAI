export interface MediaMatch {
    url: string;
    domain: string;
}

const mediaNameToDomain: Record<string, string[]> = {
    '연합뉴스': ['yna.co.kr', 'yonhapnews.co.kr'],
    '머니투데이': ['mt.co.kr'],
    '매일경제': ['mk.co.kr'],
    '조선일보': ['chosun.com'],
    '동아일보': ['donga.com'],
    '한국경제': ['hankyung.com'],
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
    '파이낸셜뉴스': ['fnnews.com'],
    '한국경제TV': ['wowtv.co.kr'],
    '다음': ['daum.net', 'v.daum.net'],
    '네이버': ['naver.com', 'news.naver.com'],
};

export function extractMediaName(titleStr: string): string {
    const match = titleStr.match(/[-–—]\s*([^-–—]+)$/);
    return match ? match[1].trim() : '';
}

export function findMatchingUrl(sourceTitle: string, urlList: MediaMatch[], usedIndices: Set<number>): { url: string; index: number } | null {
    const mediaName = extractMediaName(sourceTitle);
    if (!mediaName) return null;

    const expectedDomains = mediaNameToDomain[mediaName] || [];
    for (let i = 0; i < urlList.length; i++) {
        if (usedIndices.has(i)) continue;
        const { domain } = urlList[i];
        if (expectedDomains.some(expected => domain.includes(expected) || expected.includes(domain))) {
            return { url: urlList[i].url, index: i };
        }
    }
    return null;
}

export function injectImagesIntoHtml(post: string, images: { url: string }[], altText: string): string {
    if (images.length === 0) return post;

    const paragraphs = post.split('</p>');
    const points = [Math.floor(paragraphs.length * 0.2), Math.floor(paragraphs.length * 0.5), Math.floor(paragraphs.length * 0.8)];

    let injectedPost = '';
    let imageIndex = 0;

    for (let i = 0; i < paragraphs.length; i++) {
        injectedPost += paragraphs[i] + '</p>';
        if (images[imageIndex] && points.includes(i + 1)) {
            injectedPost += `
        <figure style="margin: 2.5em 0; text-align: center;">
          <img src="${images[imageIndex].url}" alt="${altText}" style="max-width: 100%; border-radius: 8px;" />
        </figure>
      `;
            imageIndex++;
        }
    }
    return injectedPost;
}

export function extractTitle(rawText: string, post: string): string {
    const h1Match = post.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match) return h1Match[1].replace(/<[^>]*>/g, '').trim();

    const lines = rawText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('[') && !l.startsWith('<'));
    return lines[0] || '제목 없음';
}

/**
 * Image placement specification from AI analysis
 */
export interface ImagePlacement {
    position: string;  // "after_h2:N" or "paragraph:N"
    imageUrl: string;  // base64 data URL or regular URL
    caption: string;   // Korean caption
}

/**
 * Inject images at specific positions determined by AI
 * @param post - HTML blog post content
 * @param placements - Array of image placements with position, URL, and caption
 * @returns Post with images injected at specified positions
 */
export function injectImagesAtPositions(post: string, placements: ImagePlacement[]): string {
    if (placements.length === 0) return post;

    let result = post;

    // Sort placements in reverse order to inject from bottom to top (preserve indices)
    const sortedPlacements = [...placements].sort((a, b) => {
        const getIndex = (pos: string) => {
            const match = pos.match(/:(\d+)/);
            return match ? parseInt(match[1], 10) : 0;
        };
        return getIndex(b.position) - getIndex(a.position);
    });

    for (const placement of sortedPlacements) {
        const { position, imageUrl, caption } = placement;

        const figureHtml = `
        <figure style="margin: 2.5em 0; text-align: center;">
          <img src="${imageUrl}" alt="${caption}" style="max-width: 100%; border-radius: 8px;" />
          <figcaption style="font-size: 0.9em; color: #666; margin-top: 0.5em;">${caption}</figcaption>
        </figure>
        `;

        if (position.startsWith('after_h2:')) {
            // Insert after the Nth <h2> tag
            const n = parseInt(position.split(':')[1], 10);
            const h2Regex = /<\/h2>/gi;
            let count = 0;
            result = result.replace(h2Regex, (match) => {
                count++;
                if (count === n) {
                    return match + figureHtml;
                }
                return match;
            });
        } else if (position.startsWith('paragraph:')) {
            // Insert after the Nth </p> tag
            const n = parseInt(position.split(':')[1], 10);
            const pRegex = /<\/p>/gi;
            let count = 0;
            result = result.replace(pRegex, (match) => {
                count++;
                if (count === n) {
                    return match + figureHtml;
                }
                return match;
            });
        }
    }

    return result;
}
