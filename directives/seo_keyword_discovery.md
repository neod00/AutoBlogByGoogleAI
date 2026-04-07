# SEO 키워드 발굴 파이프라인

## 개요
매일 크론(23:00 UTC)이 실행되면 Gemini + Google Search Grounding을 사용하여 `admin:settings`의 `dailyTopic` 시드 키워드로부터 SEO 최적화된 롱테일 키워드를 자동 발굴합니다.

## 파이프라인 흐름

```
시드 키워드 (설정) → Gemini SEO 분석 → 발굴 키워드 Redis 저장 → 이메일 리포트 발송
                                         ↓
                              어드민 대시보드 인박스
                                         ↓
                              사람이 검토 → 승인 → 발행 큐 추가 → 발행
```

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `api/admin/discover-keywords.ts` | 온디맨드 키워드 발굴 API (GET/POST/PUT/DELETE) |
| `api/cron/daily-digest.ts` | 매일 자동 실행 크론 (SEO 키워드 발굴 + 이메일) |
| `components/admin/KeywordDiscovery.tsx` | 어드민 키워드 인박스 UI |
| `components/admin/AdminDashboard.tsx` | 탭 기반 어드민 대시보드 (키워드/큐/설정) |

## Redis 키

- `admin:discovered_keywords` — 발굴된 키워드 배열 (최대 30개 보관)
- `admin:topics_queue` — 발행 대기열 (기존)
- `admin:settings` — 전역 설정 (dailyTopic, recipientEmail 등)

## Gemini 프롬프트 전략

1. **30년차 SEO 전문가 페르소나** 부여
2. **롱테일 정보탐색형 키워드**만 추출 (가십/날씨 제외)
3. **구조화된 JSON 출력**: mainKeyword, subKeywords, suggestedTitle, hookSummary, searchIntent, difficulty, template, reasoning
4. **Google Search Grounding** 활성화로 실시간 트렌드 반영

## 주의사항

- Gemini API 호출 비용이 발생하므로 "지금 발굴하기" 버튼 남용 주의
- 경쟁도(difficulty)는 AI의 추정치이며 절대적 수치가 아님
- Thin Content 방지를 위해 승인 프로세스(Human-in-the-loop) 반드시 유지
