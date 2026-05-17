# 자동 발행 파이프라인 (greenthumb-kr.tistory.com)

## 아키텍처

```
📧 Daily Digest Email
  │
  ├─ 👁️ 미리보기 → Web App (plantguide-admin.vercel.app/admin)
  │
  └─ ▶ 자동 발행 → Vercel API (/api/trigger-publish)
                       │
                       ▼
                GitHub Actions (plantguide_publish_post)
                       │
                       ├─ 1️⃣ Gemini: 블로그 생성 (PlantGuide/scripts/generate-content.ts)
                       │
                       ├─ 2️⃣ Python: 티스토리 발행 (PlantGuide/scripts/publish-to-tistory.py)
                       │
                       └─ 3️⃣ Node.js: 결과 메일 (PlantGuide/scripts/send-result-email.ts)
```

## 핵심 설정
- **GitHub Event**: `plantguide_publish_post`
- **Redis Prefix**: `plantguide:`
- **Vercel Project**: `plantguide-admin`
- **Blog URL**: `https://greenthumb-kr.tistory.com`

## 쿠키 갱신
동일한 카카오 계정을 사용하므로, 한 곳에서 쿠키를 갱신하면 양쪽 모두 공유 가능합니다. (Secret: `TISTORY_COOKIES_B64`)
