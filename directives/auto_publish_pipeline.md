# 자동 발행 파이프라인

## 목적

기후인사이트 글감을 자동으로 보충하고, 발행 대기열의 `pending` 주제를 이틀에 1개 꼴로 티스토리에 발행한다. Vercel Cron은 하루 1회 글감을 보충하고, GitHub Actions가 2시간마다 오토파일럿 API를 호출한다. 실제 발행은 GitHub Actions repository dispatch로 실행한다.

## 전체 구조

```text
daily-digest cron
  -> 키워드 자동 발굴
  -> admin:topics_queue 보충
  -> SEO 키워드 리포트 이메일 발송

vercel.json
  -> 하루 1회 /api/cron/daily-digest 호출

climateinsight-autopilot-trigger.yml
  -> 2시간마다 /api/cron/auto-pilot 호출
  -> KST 09:00~23:59 안에서만 발행 시도
  -> 마지막 발행 후 48시간 초과 시 강제 시도
  -> pending 주제를 publishing으로 변경
  -> GitHub repository_dispatch(publish_post)

auto-publish.yml
  -> scripts/generate-content.ts
  -> scripts/quality_gate.py
  -> scripts/publish-to-tistory.py
  -> scripts/send-result-email.ts
  -> /api/admin/topics 상태 업데이트
  -> /api/admin/cookie-status 쿠키 상태 업데이트
```

## 핵심 파일

| 파일 | 역할 |
| --- | --- |
| `vercel.json` | Vercel Hobby 제한에 맞춘 하루 1회 `daily-digest` Cron 스케줄 |
| `.github/workflows/climateinsight-autopilot-trigger.yml` | 2시간 주기 오토파일럿 API 호출 및 수동 진단 |
| `.github/workflows/auto-publish.yml` | 글 생성, 품질 검사, 티스토리 발행, 결과 알림 |
| `api/cron/auto-pilot.ts` | 발행 확률, 활동 시간, 큐 선택, GitHub dispatch |
| `api/cron/daily-digest.ts` | 키워드 발굴, 대기열 보충, 키워드 리포트 |
| `api/trigger-publish.ts` | 이메일 링크에서 수동 발행 시작 |
| `api/admin/cookie-status.ts` | 쿠키/로그인 상태 기록 |
| `scripts/generate-content.ts` | Gemini 기반 글 생성 |
| `scripts/quality_gate.py` | 자동 발행 전 품질 차단 |
| `scripts/publish-to-tistory.py` | Selenium 기반 티스토리 발행 |
| `scripts/send-result-email.ts` | 성공/실패 이메일 발송 |
| `services/execution/tistory_login.py` | 쿠키 로그인, 카카오 OAuth, 2FA 대기 |
| `services/execution/tistory_publisher.py` | 티스토리 에디터 입력/카테고리/태그/발행 |

## GitHub Secrets

| Secret | 설명 |
| --- | --- |
| `GEMINI_API_KEY` | 글 생성과 키워드 발굴용 Gemini API 키 |
| `OPENAI_API_KEY` | Gemini 한도 초과 시 글 생성/키워드 발굴 fallback용 OpenAI API 키 |
| `OPENAI_MODEL` | 선택 사항. OpenAI fallback 모델 |
| `PEXELS_API_KEY` | 이미지 검색용 API 키 |
| `TISTORY_COOKIES_B64` | 티스토리 로그인 쿠키를 Base64로 인코딩한 값 |
| `TISTORY_KAKAO_ID` | 쿠키 만료 시 카카오 재로그인에 사용할 ID |
| `TISTORY_KAKAO_PW` | 쿠키 만료 시 카카오 재로그인에 사용할 비밀번호 |
| `GMAIL_USER` | 결과 알림 발신 계정 |
| `GMAIL_APP_PASSWORD` | Gmail 앱 비밀번호 |
| `ADMIN_PASSWORD` | Vercel 관리자 API 인증용 |
| `CRON_SECRET` | 오토파일럿 API 인증용 |

## Vercel 환경변수

| 변수 | 설명 |
| --- | --- |
| `GITHUB_TOKEN` | repository dispatch 호출용 GitHub PAT |
| `GITHUB_REPO` | `owner/repo` 형식의 저장소 |
| `CRON_SECRET` | GitHub Actions 트리거와 동일한 시크릿 |
| `ADMIN_PASSWORD` | 관리자 API 인증 |
| `APP_URL` | 배포 URL. 기본값은 `https://auto-blog-by-google-ai.vercel.app` |
| `GMAIL_USER` | 리포트 수신 기본값 |
| `GMAIL_APP_PASSWORD` | daily-digest 이메일 발송용 |
| `KEYWORD_AUTO_REFRESH_SEEDS` | SEO 시드 키워드 자동 갱신 여부. 기본 활성화, `false`면 비활성화 |
| `KEYWORD_SEED_REFRESH_INTERVAL_DAYS` | SEO 시드 키워드 자동 갱신 주기. 기본 `7` |
| `KEYWORD_AUTO_REFRESH_SEED_COUNT` | 자동 갱신 때 저장할 시드 키워드 수. 기본 `8` |
| `KEYWORD_MAX_SEEDS_PER_RUN` | 키워드 발굴 1회 최대 시드 수. 기본 `2` |
| `KEYWORD_MAX_QUEUE_ADD` | 키워드 발굴 1회 큐 추가 최대 개수. 기본 `3` |
| `KEYWORD_MIN_PENDING_TOPICS` | pending 큐가 이 개수 이상이면 발굴 생략. 기본 `4` |
| `OPENAI_API_KEY` | Gemini 한도 초과 시 관리자 키워드 발굴 fallback용 OpenAI API 키 |
| `OPENAI_MODEL` 또는 `KEYWORD_OPENAI_MODEL` | OpenAI fallback 모델. 기본 `gpt-4.1-mini` |

## 운영 규칙

- 오토파일럿은 2시간마다 호출되지만 KST 09:00~23:59에만 발행을 시도한다.
- Vercel Hobby는 하루 1회 초과 Cron 배포가 실패하므로, 2시간 오토파일럿 호출은 Vercel Cron이 아니라 GitHub Actions schedule로 실행한다.
- 오토파일럿 API는 `CRON_SECRET` 또는 `ADMIN_PASSWORD` 중 하나가 맞으면 인증된다. GitHub Actions는 `CRON_SECRET`을 query key로, `ADMIN_PASSWORD`를 Authorization header로 함께 보내 Vercel/GitHub secret 불일치에 대비한다.
- 마지막 발행 후 48시간이 지나면 발행 확률은 100%가 된다.
- 12시간 이내에는 1%, 12~24시간은 5%, 24~36시간은 10%, 36~48시간은 25% 확률로 시도한다.
- 오토파일럿은 Gemini를 호출하지 않는다. 키워드 보충과 SEO 시드 키워드 주간 갱신은 `daily-digest`가 담당한다.
- 발행 시작 시 주제 상태는 `publishing`이 되고, GitHub Actions 결과에 따라 `published` 또는 `failed`로 변경된다.
- 쿠키가 만료되면 발행 스크립트가 카카오 로그인을 시도하고, 계정에 2FA가 켜져 있으면 카카오톡 승인이 필요하다.
- GitHub 수동 진단 워크플로우에서 401이 나면 GitHub `ADMIN_PASSWORD`와 Vercel `ADMIN_PASSWORD`를 먼저 맞추고, 필요하면 `CRON_SECRET`도 동일하게 맞춘다.

## 글 품질 규칙

- `generate-content.ts`는 프롬프트에 오늘 날짜(KST), RSS에서 가져온 기존 글 제목·링크(`[EXISTING_POSTS]`), 운영자 현장 메모(`[FIELD_NOTES]`, 세 번째 인자 또는 `PUBLISH_FIELD_NOTES`)를 넣는다.
  - 날짜가 없으면 모델이 마감된 지원사업을 권하거나 확정된 기준을 "진행 중"으로 쓴다. (2026-09 점검에서 확인)
  - 기존 글 목록이 없으면 같은 키워드의 개요 글을 반복 생성한다. (한 달에 한국 ESG 공시 2028 글 3편)
- 출력 JSON의 `existing_titles`, `field_notes`는 품질 게이트가 주제 중복·지어낸 경험 검사에 쓴다.
- 품질 게이트는 고정 틀("정리하면", "이번 주에 할 일" 등)을 요구하지 않는다. 대신 다음을 검사한다.
  - 실패: 기준일("YYYY년 M월 기준") 누락, `<ol>` 체크리스트 누락, 가치 요소 2개 미만, 템플릿 문구("이 글을 다 읽으면", 예상 읽기 시간, "다음에 검색해볼 키워드"), 운영자 메모 없는 1인칭 경험 서술, 지원사업형 글의 접수기간 누락
  - 주의: 가치 요소 2개, 범용 소제목, 제목의 제재 표현과 본문 면책·유예 충돌, 문장 속 같은 수치 4회 이상, 기존 글 제목 유사도 0.45 이상
- 새 지침 도입 직후에는 모델이 새 구조를 따르지 못해 게이트 실패가 늘 수 있다. 실패 이메일의 게이트 상세를 보고 지침을 보완한다.

## AI 모델과 비용

- 본문 작성은 `gemini-2.5-flash`와 Google 검색 연동을 쓴다. 검색 연동은 하루 1,500건까지 무료다. 2026-09 기준 글 1편에 약 $0.03이 든다(입력 약 1.5만, 출력 약 1만 토큰).
- 이미지 위치 분석과 카테고리 분류는 `gemini-2.5-flash-lite`로 추론 없이 처리한다(`GEMINI_LIGHT_MODEL`로 변경 가능). 호출이 거부되면 `gemini-2.5-flash`로 자동 재시도한다. 2.5 계열은 과거 사용 이력이 있는 계정에만 열려 있기 때문이다.
- 프롬프트의 기존 글 주소는 한글로 풀어서 넣는다. 퍼센트 인코딩 그대로면 50개에 약 11,500토큰, 풀면 약 4,300토큰이다. 본문의 블로그 내부 링크는 RSS의 실제 주소로 되돌리고, 목록에 없는 주소는 링크를 풀어 텍스트만 남긴다.
- Gemini 한도에 걸려 OpenAI로 대체될 때, 본문 생성은 출력 16,000토큰과 180초까지 허용한다(기본값 3,000토큰, 45초로는 글이 잘린다). 응답이 출력 한도에서 끊기면(`status: incomplete`) 실패로 처리해 잘린 글이 발행되지 않게 한다.

### Gemini 지출 구조 (2026-09 점검)

- 네 블로그가 같은 Gemini 프로젝트(AI-Blog)와 키를 쓴다. AI Studio 지출은 네 블로그 합계다.
- 이 저장소에 연결된 Vercel 프로젝트와 매일 23:00 UTC 키워드 발굴(`daily-digest`) Cron:

| Vercel 프로젝트 | 블로그 |
| --- | --- |
| `auto-blog-by-google-ai` | Climate Insight |
| `auto-blog-by-google-ai-2` | Aidajigi (오토파일럿이 호출하는 주소) |
| `auto-blog-by-google-ai-1ajd` | Aidajigi 중복 배포 (키워드 발굴도 중복 실행) |
| `auto-blog-by-google-ai-3` | DailyEnglishTips |
| `auto-blog-by-google-ai-4` | PlantGuide |

- 2026-09 점검 때 28일 지출은 약 12,000원이었다. 발행은 약 20%였고, 나머지는 매일 도는 키워드 발굴(5곳, 하루 Gemini 약 40회)이었다. DailyEnglishTips·PlantGuide는 오토파일럿이 없어진 옛 주소(`dailyengtips-admin`, `plantguide-admin`)를 불러 발행이 0건이었는데도 키워드 발굴은 매일 돌았다.
- 모든 키워드 발굴에는 비용 방어를 둔다: 시드 최대 2개(`KEYWORD_MAX_SEEDS_PER_RUN`), 대기 글감 4개 이상이면 건너뛰기(`KEYWORD_MIN_PENDING_TOPICS`), 추론 끄기(`thinkingBudget: 0`).
- 발행 1회 비용은 약 60~75원이다. 지출 그래프에서 하루 발행이 많았던 날의 증가분으로 확인했다.

## 주제 전략 (2026-09)

- 2026-09 점검 때 3개월 구글 클릭은 63회였다. 평균 순위 14위, 애드센스 28일 수익은 $0.03이었다. 원인은 광고 설정이 아니라 방문자 수였다.
- 그래서 생활형과 실무형 주제를 약 2:1로 섞는다. 씨앗 풀은 `api/_lib/climateSeeds.ts`에 있다.
  - 생활형: 요금, 보조금, 바우처, 포인트, 분리배출, 전기차. 글 유형은 `blog_instructions.md`의 "생활 정보형"이고, 템플릿은 `qa`다.
  - 실무형: CBAM, 제품 탄소발자국, Scope 3, ESG 공시. 운영자 전문 분야로, 기업 문의로 이어진다.
- Google 트렌드(한국, 2025-09~2026-09, 전기차 보조금 = 100) 비교 결과:

| 구분 | 키워드 (지수) |
| --- | --- |
| 큰 주제 | 기후동행카드 160, 전기차 보조금 100, 음식물처리기 81 |
| 중간 주제 | 난방비 27, 분리배출 27, CBAM 26, 에너지바우처 26 |
| 작은 주제 | 에어컨 전기세 18, 폐가전 수거 17, 그린카드 16, 전기차 충전요금 14, 으뜸효율 환급 14, 탄소중립포인트 10, 탄소발자국 6, ESG 공시 5, 에너지캐시백 5 |
| 구글 검색 거의 없음 | 전기세 절약, 보일러 지원금, 태양광 지원금, 수소차 보조금, 탄소국경세, 스코프3 |

- 계절성: 난방비는 11~1월, 에어컨 전기세와 누진제는 6~8월, 전기차 보조금은 1~2월, 탄소중립포인트는 2~3월, 으뜸효율 환급은 10~12월에 몰린다. 성수기 한 달 전에 발행한다.
- 씨앗 설정은 관리 화면 설정(`admin:settings.dailyTopic`)이 우선이다. 다만 `daily-digest`가 7일마다 Gemini로 씨앗을 새로 고치고, 그때 위 2:1 비율과 계절성 규칙을 따른다.
- 대기 글감이 4개 이상이면 키워드 발굴을 건너뛰므로, 새 씨앗은 대기열이 줄어든 뒤부터 반영된다.

## 쿠키 Base64 인코딩

```powershell
$bytes = [System.IO.File]::ReadAllBytes("$env:USERPROFILE\.tistory_login\cookies\default_cookies.pkl")
$b64 = [Convert]::ToBase64String($bytes)
$b64 | Set-Clipboard
Write-Host "Copied to clipboard. Paste into GitHub Secrets as TISTORY_COOKIES_B64"
```

## 실패 처리

- 품질 게이트 실패: 티스토리 발행을 중단하고 실패 이메일을 발송한다.
- 로그인/쿠키 실패: `/api/admin/cookie-status`에 `expired`를 기록하고 실패 이메일을 발송한다.
- GitHub Actions 실패: 대기열 주제를 `failed`로 변경한다.
- 수동 재시도: 관리자 대시보드에서 주제 상태를 `pending`으로 되돌리거나 새 주제를 추가한다.
