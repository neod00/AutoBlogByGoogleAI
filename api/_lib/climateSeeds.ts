export const CLIMATE_INSIGHT_DEFAULT_SEEDS = [
  'CBAM 전환기간',
  'ESG 공시 대상 기업',
  'Scope 3 배출량 산정',
  'RE100 재생에너지 조달',
  '배출권거래제 할당',
  '전기요금 산업용 인상',
  '에너지 효율 지원사업',
  '공급망 실사 탄소배출',
  '기후금융 녹색채권',
  'K-택소노미 기준',
  '탄소중립 설비 투자',
  '폐배터리 재활용 규제',
  '전기차 배터리 정보 공개',
  '재생에너지 PPA',
  '중소기업 탄소중립 지원금',
  'ISSB 지속가능성 공시',
  'EU 탄소규제 수출기업',
  '온실가스 인벤토리 구축',
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
