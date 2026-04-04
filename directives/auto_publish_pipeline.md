# 자동 발행 파이프라인 (Auto Publish Pipeline)

## 아키텍처

```
📧 Daily Digest Email
  │
  ├─ 👁️ 미리보기 → Web App (기존 방식)
  │
  └─ ▶ 자동 발행 → Vercel API (/api/trigger-publish)
                      │
                      ▼
               GitHub Actions (repository_dispatch)
                      │
                      ├─ 1️⃣ Node.js: Gemini API로 블로그 생성
                      │     └─ scripts/generate-content.ts
                      │
                      ├─ 2️⃣ Python: 티스토리 자동 발행
                      │     └─ scripts/publish-to-tistory.py
                      │       └─ services/execution/tistory_publisher.py
                      │
                      └─ 3️⃣ Node.js: 결과 이메일 전송
                            └─ scripts/send-result-email.ts
```

## GitHub Secrets 설정 (필수)

| Secret Name | 설명 | 비고 |
|---|---|---|
| `GEMINI_API_KEY` | Gemini API 키 | 기존 .env 값 |
| `TISTORY_COOKIES_B64` | 티스토리 쿠키 (Base64) | 아래 참조 |
| `GMAIL_USER` | 이메일 주소 | 기존 값 |
| `GMAIL_APP_PASSWORD` | Gmail 앱 비밀번호 | 기존 값 |
| `GITHUB_TOKEN` | GitHub PAT (repo scope) | Vercel에 설정 |
| `PEXELS_API_KEY` | Pexels API 키 | 이미지 검색용 |

## Vercel 환경변수 추가

| 변수 | 설명 |
|---|---|
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `GITHUB_REPO` | `owner/AutoBlogByGoogleAI` |
| `CRON_SECRET` | 기존 시크릿 (인증용) |

## 쿠키 Base64 인코딩 방법

```powershell
# Windows PowerShell
$bytes = [System.IO.File]::ReadAllBytes("$env:USERPROFILE\.tistory_login\cookies\default_cookies.pkl")
$b64 = [Convert]::ToBase64String($bytes)
$b64 | Set-Clipboard
Write-Host "Copied to clipboard! Paste into GitHub Secrets as TISTORY_COOKIES_B64"
```

## 파일 구조

```
scripts/
  generate-content.ts    # 블로그 생성 (Gemini API)
  publish-to-tistory.py  # 티스토리 발행 (Selenium)
  send-result-email.ts   # 결과 이메일

api/
  trigger-publish.ts     # Vercel → GitHub Actions 트리거
  cron/
    daily-digest.ts      # 일일 다이제스트 이메일 (업데이트됨)

services/execution/
  tistory_login.py       # 로그인 모듈
  tistory_publisher.py   # 발행 모듈

.github/workflows/
  auto-publish.yml       # GitHub Actions 워크플로우
```

## 쿠키 갱신 주기

- 쿠키 유효기간: 약 2~4주
- 만료 시: 로컬에서 `python services/execution/tistory_login.py --manual` 실행
- 새 쿠키를 Base64로 인코딩하여 GitHub Secret 업데이트
