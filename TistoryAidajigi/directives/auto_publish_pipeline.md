# 자동 발행 파이프라인 (aidajigi.tistory.com)

## 아키텍처

```
📧 Daily Digest Email
  │
  ├─ 👁️ 미리보기 → Web App (aidajigi-blog-admin.vercel.app/admin)
  │
  └─ ▶ 자동 발행 → Vercel API (/api/trigger-publish)
                       │
                       ▼
                GitHub Actions (aidajigi_publish_post)
                       │
                       ├─ 1️⃣ Gemini: 블로그 생성 (TistoryAidajigi/scripts/generate-content.ts)
                       │
                       ├─ 2️⃣ Python: 티스토리 발행 (TistoryAidajigi/scripts/publish-to-tistory.py)
                       │
                       └─ 3️⃣ Node.js: 결과 메일 (TistoryAidajigi/scripts/send-result-email.ts)
```

## 핵심 설정
- **GitHub Event**: `aidajigi_publish_post`
- **Redis Prefix**: `aidajigi:`
- **Vercel Project**: `aidajigi-blog-admin`
- **Blog URL**: `https://aidajigi.tistory.com`

## SEO 시드 자동 갱신
- `daily-digest`는 키워드 발굴 전에 `SEO 시드 키워드`를 기본 7일마다 자동 갱신한다.
- 갱신 결과는 `aidajigi:admin:settings`의 `dailyTopic`에 저장된다.
- 마지막 갱신 시각은 `aidajigi:admin:last_seed_refresh_at`에 저장된다.
- `KEYWORD_AUTO_REFRESH_SEEDS=false`로 비활성화할 수 있다.
- `KEYWORD_SEED_REFRESH_INTERVAL_DAYS`, `KEYWORD_AUTO_REFRESH_SEED_COUNT`로 주기와 개수를 조절한다.
- 시드 갱신일에는 Gemini 1회가 추가 호출된다.

## 쿠키 갱신
동일한 카카오 계정을 사용하므로, 한 곳에서 쿠키를 갱신하면 양쪽 모두 공유 가능합니다. (Secret: `TISTORY_COOKIES_B64`)
