export function getGeminiErrorText(error: any): string {
  const parts = [
    error?.message,
    error?.status,
    error?.code,
    error?.error?.message,
    error?.error?.status,
    error?.error?.code,
  ]
    .filter(Boolean)
    .map((part) => String(part));

  return parts.join('\n');
}

export function isGeminiUsageLimitError(error: any): boolean {
  const text = getGeminiErrorText(error).toLowerCase();
  return (
    text.includes('resource_exhausted') ||
    text.includes('monthly spending cap') ||
    text.includes('spend cap') ||
    text.includes('quota') ||
    (text.includes('429') && text.includes('exceeded'))
  );
}

function isOpenAIError(error: any): boolean {
  const text = getGeminiErrorText(error).toLowerCase();
  return text.includes('openai') || text.includes('[openai');
}

export function isRetryableGeminiError(error: any): boolean {
  if (isGeminiUsageLimitError(error)) return false;

  const text = getGeminiErrorText(error).toLowerCase();
  return (
    text.includes('503') ||
    text.includes('unavailable') ||
    text.includes('timeout') ||
    text.includes('timed out') ||
    text.includes('econnreset') ||
    text.includes('etimedout')
  );
}

export function getGeminiErrorStatusCode(error: any): number {
  if (isGeminiUsageLimitError(error)) return 429;
  if (isRetryableGeminiError(error)) return 503;
  return 500;
}

export function getPublicGeminiErrorMessage(error: any): string {
  if (isGeminiUsageLimitError(error)) {
    if (isOpenAIError(error)) {
      return 'OpenAI API 지출 한도 또는 사용량 한도에 도달했습니다. OpenAI Platform의 Billing/Usage limit 설정을 확인하거나 다음 사용 기간에 다시 시도해야 합니다.';
    }

    return 'Gemini API 월간 지출 한도 또는 사용량 한도에 도달했습니다. Google AI Studio의 Billing/Spend cap 설정을 올리거나 다음 사용 기간에 다시 시도해야 합니다.';
  }

  if (isRetryableGeminiError(error)) {
    return isOpenAIError(error)
      ? 'OpenAI API가 일시적으로 응답하지 않았습니다. 잠시 후 다시 시도해주세요.'
      : 'Gemini API가 일시적으로 응답하지 않았습니다. 잠시 후 다시 시도해주세요.';
  }

  return error?.message || 'AI API 호출 중 알 수 없는 오류가 발생했습니다.';
}
