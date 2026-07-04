import { isGeminiUsageLimitError, isRetryableGeminiError } from './geminiErrors.js';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || process.env.KEYWORD_OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_RESPONSES_URL = process.env.OPENAI_RESPONSES_URL || 'https://api.openai.com/v1/responses';
const OPENAI_WEB_SEARCH_TOOL = process.env.OPENAI_WEB_SEARCH_TOOL || 'web_search';
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 45_000);
const OPENAI_MAX_OUTPUT_TOKENS = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || 3_000);

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function hasOpenAIKey(): boolean {
  return Boolean(OPENAI_API_KEY);
}

export function shouldUseOpenAIFirst(): boolean {
  const provider = (process.env.KEYWORD_AI_PROVIDER || process.env.AI_PROVIDER || '').toLowerCase();
  return provider === 'openai' || provider === 'openai_first';
}

function getPromptText(contents: any): string {
  if (typeof contents === 'string') return contents;
  return JSON.stringify(contents);
}

function shouldUseWebSearch(params: any): boolean {
  return Boolean(
    params?.config?.tools?.some((tool: any) => tool?.googleSearch || tool?.type === 'web_search')
  );
}

function extractOpenAIText(data: any): string {
  if (typeof data?.output_text === 'string') return data.output_text;

  const chunks: string[] = [];
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }

  return chunks.join('\n').trim();
}

function getOpenAIErrorMessage(status: number, data: any): string {
  const message = data?.error?.message || data?.message || 'OpenAI API request failed';
  return `[OpenAI ${status}] ${message}`;
}

export async function generateOpenAIContent(params: any): Promise<{ text: string }> {
  if (!OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY not set');
  }

  const body: any = {
    model: OPENAI_MODEL,
    input: getPromptText(params.contents),
    max_output_tokens: OPENAI_MAX_OUTPUT_TOKENS,
  };

  if (shouldUseWebSearch(params)) {
    body.tools = [{ type: OPENAI_WEB_SEARCH_TOOL }];
    body.tool_choice = 'required';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(getOpenAIErrorMessage(response.status, data));
    }

    const text = extractOpenAIText(data);
    if (!text) {
      throw new Error('OpenAI response did not include output_text');
    }

    return { text };
  } finally {
    clearTimeout(timer);
  }
}

export async function generateContentWithAiFallback(
  geminiClient: any,
  params: any,
  maxGeminiRetries = 1,
  logPrefix = '[AI]'
): Promise<{ text: string }> {
  if (!geminiClient || shouldUseOpenAIFirst()) {
    console.log(`${logPrefix} Using OpenAI provider.`);
    return generateOpenAIContent(params);
  }

  let attempt = 0;
  while (attempt <= maxGeminiRetries) {
    try {
      return await geminiClient.models.generateContent(params);
    } catch (error: any) {
      if (isGeminiUsageLimitError(error) && hasOpenAIKey()) {
        console.warn(`${logPrefix} Gemini usage limit reached. Falling back to OpenAI.`);
        return generateOpenAIContent(params);
      }

      attempt++;
      const isRetryable = isRetryableGeminiError(error);
      if (attempt > maxGeminiRetries || !isRetryable) {
        throw error;
      }

      const waitTime = Math.pow(2, attempt) * 2000;
      console.warn(`${logPrefix} Temporary Gemini issue. Retrying in ${waitTime}ms... (Attempt ${attempt}/${maxGeminiRetries})`);
      await delay(waitTime);
    }
  }

  throw new Error('AI provider did not return a response');
}
