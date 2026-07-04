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
