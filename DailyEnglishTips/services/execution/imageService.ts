import { GoogleGenAI } from "@google/genai";

const PEXELS_API_KEY = process.env.PEXELS_API_KEY;

export interface AIGeneratedImage {
    url: string;
}

interface PexelsPhoto {
    id: number;
    src: {
        large: string;
    };
}

interface PexelsResponse {
    photos: PexelsPhoto[];
}

function isPexelsConfigured(): boolean {
    return !!PEXELS_API_KEY;
}

export async function translateKeywordsToEnglish(keywords: string[], aiModel: GoogleGenAI): Promise<string[]> {
    try {
        const prompt = `You are helping to find stock photos on Pexels. Convert the following keywords into SPECIFIC English search terms that will find relevant professional photos.
Return ONLY the optimized English search phrases, one per line, no numbering:
${keywords.join('\n')}`;

        const response = await aiModel.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: "user", parts: [{ text: prompt }] }],
        });

        const translatedText = response.text || '';
        return translatedText.split('\n').filter((k: string) => k.trim()).map((k: string) => k.trim());
    } catch (error) {
        console.error('Error translating keywords:', error);
        return keywords;
    }
}

async function fetchImagesFromPexels(query: string, count: number = 3): Promise<PexelsPhoto[]> {
    if (!isPexelsConfigured()) return [];

    try {
        const response = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${count}&locale=ko-KR`, {
            headers: { Authorization: PEXELS_API_KEY! },
        });
        const data: PexelsResponse = await response.json();
        return data.photos || [];
    } catch (error) {
        console.error("Failed to fetch images from Pexels:", error);
        return [];
    }
}

export async function generateAIImages(keywords: string[]): Promise<AIGeneratedImage[]> {
    if (!isPexelsConfigured()) return [];

    const images: AIGeneratedImage[] = [];
    const usedPhotoIds = new Set<number>();

    for (const keyword of keywords.slice(0, 3)) {
        try {
            const photos = await fetchImagesFromPexels(keyword, 5);
            const uniquePhoto = photos.find(photo => !usedPhotoIds.has(photo.id));
            if (uniquePhoto) {
                usedPhotoIds.add(uniquePhoto.id);
                images.push({ url: uniquePhoto.src.large });
            } else if (photos.length > 0) {
                images.push({ url: photos[0].src.large });
            }
        } catch (error) {
            console.error(`Error fetching image for keyword "${keyword}":`, error);
        }
    }
    return images;
}

/**
 * Generate an image using Google Nano Banana (Gemini 2.5 Flash Image)
 * @param prompt - Detailed English prompt for image generation
 * @param aiModel - GoogleGenAI instance
 * @returns base64 data URL of the generated image, or null on failure
 */
export async function generateImageWithNanoBanana(prompt: string, aiModel: GoogleGenAI): Promise<string | null> {
    try {
        const response = await (aiModel as any).models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            config: {
                responseModalities: ['IMAGE'],
            },
        });

        // Extract base64 image data from response
        const parts = response.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
            if (part.inlineData?.data) {
                const mimeType = part.inlineData.mimeType || 'image/png';
                return `data:${mimeType};base64,${part.inlineData.data}`;
            }
        }

        console.warn('Nano Banana response did not contain image data');
        return null;
    } catch (error) {
        console.error('Error generating image with Nano Banana:', error);
        return null;
    }
}
