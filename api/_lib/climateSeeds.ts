// 2026-09 Google 트렌드 비교(한국, 최근 12개월)로 고른 생활형 씨앗과, 운영자 전문 분야인 실무형 씨앗을 약 2:1로 섞는다.
// 생활형은 검색 수요가 크고, 실무형은 수요는 작지만 기업 독자 문의로 이어진다.
// 구글 검색이 거의 없던 표현(전기세 절약, 보일러 지원금, 태양광 지원금, 수소차 보조금)은 넣지 않았다.
export const CLIMATE_INSIGHT_LIFESTYLE_SEEDS = [
  '난방비 절약',
  '에너지바우처 신청',
  '분리배출 방법',
  '폐가전 무료수거',
  '전기차 보조금',
  '기후동행카드',
  '음식물처리기 전기요금',
  '에어컨 전기세',
  '전기차 충전요금',
  '탄소중립포인트',
  '에너지캐시백',
  '그린카드 에코머니',
  '탄소발자국 계산',
];

export const CLIMATE_INSIGHT_PRACTITIONER_SEEDS = [
  'CBAM 내재배출량 계산',
  '제품 탄소발자국 산정',
  'Scope 3 배출량 산정',
  'ESG 공시 대상 기업',
  'RE100 재생에너지 조달',
];

export const CLIMATE_INSIGHT_DEFAULT_SEEDS = [
  ...CLIMATE_INSIGHT_LIFESTYLE_SEEDS,
  ...CLIMATE_INSIGHT_PRACTITIONER_SEEDS,
];

export const DEFAULT_DAILY_TOPIC = CLIMATE_INSIGHT_DEFAULT_SEEDS.join(', ');

export function parseSeedList(seedText: string | undefined | null): string[] {
  return (seedText || '')
    .split(',')
    .map(seed => seed.trim())
    .filter(Boolean);
}

export function selectSeedsForRun(
  configuredSeeds: string[] = [],
  count: number,
  recentTopics: string[] = [],
  now: Date = new Date(),
): string[] {
  const pool = configuredSeeds.length > 0 ? configuredSeeds : CLIMATE_INSIGHT_DEFAULT_SEEDS;
  const normalizedRecent = recentTopics.map(topic => topic.replace(/\s+/g, '').toLowerCase());
  const filteredPool = pool.filter(seed => {
    const normalizedSeed = seed.replace(/\s+/g, '').toLowerCase();
    return !normalizedRecent.some(topic => topic.includes(normalizedSeed));
  });

  const source = filteredPool.length > 0 ? filteredPool : pool;
  if (source.length === 0 || count <= 0) return [];

  const dayIndex = Math.floor(now.getTime() / 86_400_000);
  const selected: string[] = [];

  for (let i = 0; i < source.length && selected.length < count; i++) {
    const idx = (dayIndex + i * 5) % source.length;
    const seed = source[idx];
    if (!selected.includes(seed)) selected.push(seed);
  }

  return selected;
}
