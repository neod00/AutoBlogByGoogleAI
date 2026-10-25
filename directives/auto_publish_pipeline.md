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
- 분량 관리 (2026-10 도입): 필수 블록이 많아 글이 4,000~5,000자까지 늘어 모바일 독자가 읽기 불편하다는 지적이 있었다.
  - 목표: 생활 정보형 1,800~2,500자, 그 외 2,500~3,200자 (본문 기준, 참고자료·관련글 제외). H2는 4~5개, 최대 6개.
  - 가치 요소는 5개 중 2개만 고르게 한다 (게이트 최소 2개). 생활 정보형은 신청 절차 `<ol>`이 체크리스트를 대신한다.
  - `generate-content.ts`: 본문이 3,300자를 넘으면 `compressLongPost`가 설명 문장만 줄이는 압축 호출을 한 번 한다. 표·`<ol>`·기준일·고유 수치가 사라지거나 절반 미만으로 잘리면 압축본을 버리고 원본을 쓴다. `COMPRESS_TRIGGER_CHARS`, `COMPRESS_TARGET_CHARS` 환경변수로 조정한다.
  - `quality_gate.py`: 본문 분량을 참고자료·관련글을 뺀 본문 기준으로 잰다. 3,200자 초과 주의, 3,800자 초과 실패, H2 7개 이상 주의. 결과 JSON에 `body_chars`가 기록된다.
  - 이전에는 상한이 7,500자(참고자료·관련글 포함)라 사실상 길이를 막지 못했다.
  - 3,800자 상한 때문에 실패가 늘면 먼저 지시문의 필수 블록을 더 줄이고, 상한 완화는 마지막 수단으로 한다.
- 분량 2차 축소 (2026-10): 새 규칙으로 발행한 에너지바우처 시험 글(본문 3,258자)도 길다는 피드백을 받았다.
  - 목표를 생활 정보형 1,200~1,800자, 그 외 1,600~2,200자로 낮췄다. H2 3~4개(최대 5개), 섹션당 250자, 도입부 1문단, FAQ 2~3개, 체크리스트 3개, 참고자료 3개, 관련 글 2개.
  - 지시문에 "핵심 전달 원칙"을 추가했다. 독자가 가져갈 답 3개를 먼저 정하고, 거기에 답하지 않는 문장과 조언형 꼬리 문장("~하는 것이 중요합니다")을 뺀다.
  - 접수기간 게이트 실패(전기차 보조금 시험 글, 2회 연속): 이 검사는 "3월 4일" 같은 완전한 날짜 2개를 요구했다. 그런데 지시문은 확인되지 않은 날짜를 쓰지 말라고 하고, 전기차 보조금은 지자체별 접수 시기가 다르고 선착순으로 닫힌다. 지시문만 보강한 첫 시도(접수기간·신청 기관을 반드시 남기라는 규칙)는 효과가 없었다. 두 기준이 서로 충돌하는 것이 원인이라 검사를 고쳤다.
  - 이제 시점 표기로 완전한 날짜 외에 월 단위("2월 초", "3월부터", "12월 마감")도 인정한다. 시점 표기 2개 이상이면 통과, 1개여도 "선착순·예산 소진" 같은 마감 방식이 함께 있으면 통과, 상시 신청이면 통과다. 접수 시점 정보가 아예 없는 글은 계속 막는다.
  - 실패하면 로그에 시점 표기 개수와 접수·마감 관련 문장이 나온다. 시험 글 본문을 내려받지 못해도 원인을 볼 수 있다.
  - 가치 요소 판정: 헤더 단어와 무관하게 헤더 + 데이터 행 2개 이상인 표는 '실무 표'로 인정한다. 글이 짧아지며 FAQ·일정이 빠진 전기차 보조금 시험 글이 가치 요소 0개로 막혔기 때문이다.
  - 게이트: 2,200자 초과 주의, 2,800자 초과 실패, H2 6개 이상 주의, 가치 요소 최소 1개, 조언형 문장 3개 이상 주의.
  - 압축: 2,000자를 넘으면 1,600자 목표로 압축한다. 원본의 40% 미만으로 잘리면 압축본을 버린다.
  - 위 수치가 이전 문단(1차 축소)의 수치를 대체한다.
  - 첫 시험 모드 결과: 모델이 목표를 무시하고 2,846자를 썼고, "1,600자로 줄이라"는 압축은 2,708자(5%)에 그쳤다. 기준일 문장도 빠져 게이트에 걸렸다.
  - 대응: 압축 지시에 줄일 비율("약 44% 삭제")과 남길 구조(섹션 3~4개, 섹션당 2문장, FAQ 2개)를 직접 쓰고, 길면 2회까지 압축한다. 본문 생성 프롬프트 상단 규칙에도 분량을 넣었다. 기준일 문장이 없으면 코드가 붙인다. 압축 안전 검사의 고유 수치 유지율은 85%에서 60%로 낮췄다(중복 섹션 삭제 시 수치도 빠지므로).
- 시험 실행: `auto-publish.yml`을 Actions 화면에서 수동 실행할 수 있다(topic, template, dry_run 입력). `dry_run`을 true로 두면 티스토리 발행·쿠키 보고·메일을 건너뛰고 생성 글과 게이트 결과를 `dry-run-output` 아티팩트로 남긴다. 생성 비용(글 1편 약 $0.03)은 든다.
- 발행 글 점검 (2026-10, "2026년 탄소중립포인트" 글): 길이 외에 아래 문제가 확인되어 규칙을 추가했다.
  - 분야별 최대 금액 묶음이 도입부, 표, Q3, 가상 사례에 네 번 반복됐다. 게이트가 같은 수치가 4개 섹션 이상(표·목록 포함)에 나오면 실패시킨다(`check_figure_spread`).
  - "건당 100원 (10원으로 조정되었을 가능성 있음, 최신 정보 확인 필요)"처럼 모델의 불확실성이 본문에 남았고, 가상 사례는 10원으로 계산해 값이 충돌했다. "가능성 있음", "확인 필요" 등은 실패 처리한다(`check_unverified_hedges`).
  - 본문 첫 줄에 글 제목과 다른 소제목이 한 번 더 붙었다. 생성 단계에서 바로 뒤에 문단이 오는 첫 소제목을 지운다.
  - 본문 마지막 문단에서 링크한 글이 "함께 읽으면 좋은 글" 상자에 또 나왔다. 본문에 이미 링크된 글은 관련 글에서 뺀다.
  - 참고자료 5개가 모두 링크 없이 표시됐다. Gemini 검색 연동의 출처 주소는 `vertexaisearch.cloud.google.com/grounding-api-redirect/...`인데, 예전에는 버리기만 했다. 지금은 리다이렉트의 Location 헤더로 실제 주소를 얻고, SNS·블로그·영상 출처는 빼고, 공식 자료를 앞에 둔다.
  - 제목 "2026년 탄소중립포인트: ~ 더 현명하게!"가 통과했다. 연도 바로 뒤가 아니라 단어를 사이에 둔 콜론도 잡도록 고쳤고, "현명하게!" 같은 끝맺음도 막는다.
  - 대표 이미지로 공장 굴뚝 사진이 들어갔다. 이미지 지시문의 예시 키워드 "탄소중립"이 Pexels에서 굴뚝 사진을 주로 돌려준다. 예시를 사물 위주로 바꾸고 추상어 사용을 금지했다.
  - 티스토리 모바일 화면에서 제목 아래 큰 광고 두 개가 본문을 두 번째 화면으로 밀어낸다. 코드 밖 설정(스킨/애드센스 자동 광고)이라 운영자가 직접 조정해야 한다.
- 새 지침 도입 직후에는 모델이 새 구조를 따르지 못해 게이트 실패가 늘 수 있다. 실패 이메일의 게이트 상세를 보고 지침을 보완한다.
- 카테고리 분류(`classifyCategory`):
  - 예전에는 번호로 답하게 하고 `parseInt`로 읽었다. 모델이 이름이나 `**4**`처럼 답하면 "기타"로 떨어졌고, 오류도 로그 없이 "기타"가 됐다. 2026-09 기준 136편 중 61편이 "기타"였고, 기후 글인 K-택소노미·PPA 글도 포함됐다.
  - 지금은 선택지에서 "카테고리 없음", "기타", "ai 신기술 및 이슈"를 뺐다. 카테고리 이름과 설명을 주고 이름으로 받는다. 못 읽거나 실패하면 제목·태그 키워드 규칙으로 정하고, 기본값은 "탄소중립"이다.
  - 카테고리 이름은 `auto-publish.yml`의 `--categories`와 정확히 같아야 한다. 티스토리에 카테고리를 새로 만들면 `CATEGORY_GUIDE`와 `--categories`를 함께 고친다.
  - 기존 "기타" 글 55편 중 33편은 기후와 무관한 글(주식, 로또, 선물 추천 등)이었다. 카테고리를 옮기지 말고 비공개로 돌린다.

## AI 모델과 비용

- 본문 작성은 `gemini-2.5-flash`와 Google 검색 연동을 쓴다. 검색 연동은 하루 1,500건까지 무료다. 2026-09 기준 글 1편에 약 $0.03이 든다(입력 약 1.5만, 출력 약 1만 토큰).
- 이미지 위치 분석과 카테고리 분류는 `gemini-3.5-flash-lite`로 추론 없이 처리한다(`GEMINI_LIGHT_MODEL`로 변경 가능). 호출이 거부되면 그 실행의 나머지 호출은 `gemini-2.5-flash`로 처리한다. 2.5 계열은 과거 사용 이력이 있는 계정에만 열려 있기 때문이다.
  - 2026-10: `gemini-2.5-flash-lite`가 "신규 사용자에게 더 이상 제공되지 않음"(404)으로 바뀌어, 호출마다 실패를 한 번씩 거치고 기본 모델로 재시도했다. API 오류 메시지가 안내한 `gemini-3.5-flash-lite`로 교체했고, 한 번 거부된 보조 모델은 같은 실행 안에서 다시 시도하지 않는다.
  - 첫 시험(2026-10)에서 `gemini-3.5-flash-lite`가 `thinkingBudget: 0`에 400(INVALID_ARGUMENT)을 냈다. 3.x 계열은 추론 설정 방식이 달라서로 보인다. 그래서 보조 모델 호출은 추론 설정을 준 호출, 설정 없는 호출 순서로 시도하고, 둘 다 거부되면 기본 모델을 쓴다. 로그에 `retrying without thinking config`가 보이면 첫 번째가 거부된 것이다. `using gemini-2.5-flash for the rest of this run`이 보이면 보조 모델 전체가 거부된 것이다.
  - 본문 작성 등 나머지 호출은 `gemini-2.5-flash`다. 같은 종료 안내가 이 모델에도 오면 `scripts/generate-content.ts`의 `MAIN_MODEL`과 `api/` 아래 키워드 발굴·다이제스트의 모델명을 함께 바꿔야 한다. 다른 하위 프로젝트(TistoryAidajigi, PlantGuide, DailyEnglishTips)도 같은 모델명을 쓴다.
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
