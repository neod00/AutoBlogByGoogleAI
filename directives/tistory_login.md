---
name: tistory-login
description: 티스토리 자동 로그인 SOP (카카오 OAuth + 2FA)
---

# Tistory Login Directive

## 목적
티스토리 블로그에 Selenium으로 자동 로그인하여, 이후 글 작성/관리 등의 작업을 수행할 수 있도록 한다.

## 실행 스크립트
`services/execution/tistory_login.py`

## 환경변수 (.env)
`
TISTORY_KAKAO_ID=카카오_이메일
TISTORY_KAKAO_PW=카카오_비밀번호
`

## 사용 방법

### 자동 로그인 (ID/PW 자동 입력 + 2FA 대기)
`python
from services.execution.tistory_login import TistoryAutoLogin

login = TistoryAutoLogin.from_env()
if login.login():
    driver = login.get_driver()
    # driver로 작업 수행
login.close()
`

### 수동 로그인 (브라우저에서 직접 로그인)
`python
login = TistoryAutoLogin()
if login.login_manual():
    driver = login.get_driver()
login.close()
`

### CLI 직접 실행
`ash
python services/execution/tistory_login.py --mode manual
python services/execution/tistory_login.py --mode auto
python services/execution/tistory_login.py --mode cookie
`

## 의존성
- selenium>=4.10.0
- webdriver-manager>=4.0.0
- python-dotenv>=1.0.0 (선택)

## 주의사항
- 2FA 활성화 계정은 카카오톡 앱 승인이 필요 (완전 무인 불가)
- 쿠키 유효 시에만 무인 실행 가능
- 쿠키 저장 위치: ~/.tistory_login/cookies/
