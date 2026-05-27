#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_tistory_cookie.py
===========================
로컬 환경(PC)에서 안전하게 티스토리 로그인 쿠키를 생성하고,
GitHub Secrets에 등록할 수 있는 Base64 인코딩 스트링을 추출하는 스크립트입니다.

이 스크립트를 사용하면:
1. 창이 있는 일반 Chrome 브라우저가 열려 2FA 번호 입력 등을 눈으로 보고 승인할 수 있습니다.
2. 한국 로컬 IP를 사용하므로 카카오의 해외 IP 로그인 차단 정책에 걸리지 않습니다.
3. 추출된 Base64 값을 GitHub Secrets의 TISTORY_COOKIES_B64로 등록하면, 자동 배포가 100% 성공합니다.

사용법:
    1. 로컬 의존성 설치:
       pip install selenium webdriver-manager python-dotenv
       
    2. 스크립트 실행:
       python TistoryAidajigi/scripts/generate_tistory_cookie.py
"""

import os
import sys
import base64
import time
from pathlib import Path

# 프로젝트 루트 및 서비스 폴더 경로 설정
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
try:
    from services.execution.tistory_login import TistoryAutoLogin
except ImportError:
    # 경로가 다를 경우를 대비한 fallback
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from services.execution.tistory_login import TistoryAutoLogin


def main():
    print("=" * 60)
    print("🔑 로컬 티스토리 세션 쿠키 생성 및 Base64 추출기")
    print("=" * 60)
    print("이 스크립트는 로컬 PC 브라우저를 띄워 로그인을 수동으로 처리한 후,")
    print("GitHub Secrets에 등록할 'TISTORY_COOKIES_B64' 값을 발급합니다.")
    print("-" * 60)

    # 1. Tistory 로그인 세션 초기화 (로컬 PC이므로 headless=False로 강제)
    # .env 파일에서 카카오 ID/PW가 있다면 로드, 없으면 수동 입력 유도
    login = TistoryAutoLogin.from_env(headless=False)
    
    # 2. 브라우저 띄우기 및 수동 로그인 실행
    print("🚀 Chrome 브라우저를 실행합니다. 수동으로 로그인을 진행해 주세요.")
    success = login.login_manual()
    
    if not success:
        print("\n❌ 로그인에 실패했거나 상태 확인이 되지 않았습니다. 스크립트를 다시 실행해 주세요.")
        login.close()
        sys.exit(1)

    # 3. 생성된 쿠키 파일 찾기 및 Base64 변환
    cookie_file = login._get_cookies_file()
    login.close()

    if not cookie_file.exists():
        print(f"\n❌ 쿠키 파일이 물리적으로 생성되지 않았습니다: {cookie_file}")
        sys.exit(1)

    print("\n" + "🎉 " * 10)
    print("✅ 로그인 성공 및 쿠키 파일 저장 완료!")
    print(f"📍 쿠키 파일 경로: {cookie_file}")
    
    # Base64 변환
    try:
        with open(cookie_file, "rb") as f:
            cookie_bytes = f.read()
        b64_cookie = base64.b64encode(cookie_bytes).decode("utf-8")
        
        print("\n" + "=" * 60)
        print("📋 아래의 [Base64 인코딩 값]을 복사하여 GitHub Secrets에 등록하세요:")
        print("=" * 60)
        print(f"\n{b64_cookie}\n")
        print("=" * 60)
        print("💡 [등록 방법] :")
        print("  1. GitHub 리포지토리 ➡️ Settings ➡️ Secrets and variables ➡️ Actions로 이동")
        print("  2. 'TISTORY_COOKIES_B64' 이름으로 New repository secret 생성")
        print("  3. 위에서 복사한 길고 복잡한 Base64 값을 Value에 그대로 붙여넣고 저장!")
        print("=" * 60)
        
    except Exception as e:
        print(f"❌ Base64 변환 중 오류 발생: {e}")


if __name__ == "__main__":
    main()
