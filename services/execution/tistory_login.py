#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
티스토리 자동 로그인 모듈 (Reusable)
=====================================

카카오 OAuth + 2FA 지원 Selenium 기반 티스토리 자동 로그인.
다른 프로젝트에서 이 파일을 복사하여 바로 사용할 수 있습니다.

사용법:
    from tistory_login import TistoryAutoLogin
    
    login = TistoryAutoLogin(kakao_id="...", kakao_pw="...")
    if login.login():
        driver = login.get_driver()
        # driver로 작업 수행
    login.close()
"""

import os
import time
import pickle
from pathlib import Path
from typing import Optional, Callable
from datetime import datetime


class TistoryAutoLogin:
    """
    티스토리 자동 로그인 클래스
    
    지원 모드:
        - 자동 로그인: 카카오 ID/PW 자동 입력 + 2FA 대기
        - 수동 로그인: 브라우저 띄우고 사용자가 직접 로그인
        - 쿠키 로그인: 저장된 쿠키로 빠른 로그인
    """
    
    # =========================================================================
    # 초기화
    # =========================================================================
    
    def __init__(
        self,
        kakao_id: str = "",
        kakao_pw: str = "",
        headless: bool = False,
        cookies_dir: Optional[str] = None,
        log_callback: Optional[Callable[[str], None]] = None,
    ):
        """
        Args:
            kakao_id: 카카오 계정 이메일
            kakao_pw: 카카오 계정 비밀번호
            headless: True면 브라우저 안 보임 (수동 로그인에서는 무시됨)
            cookies_dir: 쿠키 저장 디렉토리 (기본: ~/.tistory_login/cookies)
            log_callback: 로그 메시지를 받을 콜백 함수 (GUI 연동 등)
        """
        self.kakao_id = kakao_id
        self.kakao_pw = kakao_pw
        self.headless = headless
        self.driver = None
        self._log_callback = log_callback
        
        # 쿠키 저장 경로
        if cookies_dir:
            self.cookies_dir = Path(cookies_dir)
        else:
            self.cookies_dir = Path.home() / ".tistory_login" / "cookies"
        self.cookies_dir.mkdir(parents=True, exist_ok=True)
    
    @classmethod
    def from_env(cls, **kwargs):
        """
        환경변수에서 자격증명을 로드하여 인스턴스 생성.
        
        환경변수:
            TISTORY_KAKAO_ID: 카카오 이메일
            TISTORY_KAKAO_PW: 카카오 비밀번호
        
        .env 파일 자동 로드도 시도합니다 (python-dotenv 선택 설치).
        """
        try:
            from dotenv import load_dotenv
            load_dotenv()
        except ImportError:
            pass
        
        kakao_id = os.getenv("TISTORY_KAKAO_ID", os.getenv("TISTORY_USERNAME", ""))
        kakao_pw = os.getenv("TISTORY_KAKAO_PW", os.getenv("TISTORY_PASSWORD", ""))
        
        return cls(kakao_id=kakao_id, kakao_pw=kakao_pw, **kwargs)
    
    # =========================================================================
    # 로깅
    # =========================================================================
    
    def _log(self, message: str):
        """로그 출력"""
        timestamp = datetime.now().strftime("%H:%M:%S")
        log_msg = f"[{timestamp}] {message}"
        print(log_msg)
        if self._log_callback:
            self._log_callback(log_msg)
    
    # =========================================================================
    # 드라이버 관리
    # =========================================================================
    
    def _init_driver(self, force_visible: bool = False) -> bool:
        """Chrome 드라이버 초기화 (자동화 감지 우회 포함)"""
        try:
            from selenium import webdriver
            from selenium.webdriver.chrome.service import Service
            from selenium.webdriver.chrome.options import Options
            
            options = Options()
            
            # headless 모드 (수동 로그인 시에는 force_visible=True)
            if self.headless and not force_visible:
                options.add_argument("--headless=new")  # 새 headless 모드 (더 안정적)
            
            options.add_argument("--no-sandbox")
            options.add_argument("--disable-dev-shm-usage")
            options.add_argument("--disable-gpu")
            options.add_argument("--window-size=1920,1080")
            options.add_argument("--remote-debugging-port=9222")
            
            # ★ 자동화 감지 우회 (3가지 핵심)
            options.add_argument("--disable-blink-features=AutomationControlled")
            options.add_experimental_option("excludeSwitches", ["enable-automation"])
            options.add_experimental_option("useAutomationExtension", False)
            
            # 커스텀 User-Agent
            options.add_argument(
                "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/131.0.0.0 Safari/537.36"
            )
            
            # Selenium 4.6+ 내장 드라이버 관리 우선 시도
            try:
                self.driver = webdriver.Chrome(options=options)
                self._log("✅ Chrome 드라이버 초기화 완료 (내장)")
            except Exception:
                # Fallback: webdriver-manager 사용
                from webdriver_manager.chrome import ChromeDriverManager
                service = Service(ChromeDriverManager().install())
                self.driver = webdriver.Chrome(service=service, options=options)
                self._log("✅ Chrome 드라이버 초기화 완료 (webdriver-manager)")
            
            self.driver.implicitly_wait(10)
            return True
            
        except Exception as e:
            self._log(f"❌ 드라이버 초기화 실패: {e}")
            return False
    
    def get_driver(self):
        """로그인된 Selenium WebDriver 인스턴스 반환"""
        return self.driver
    
    def close(self):
        """브라우저 종료"""
        if self.driver:
            try:
                self.driver.quit()
            except Exception:
                pass
            self.driver = None
            self._log("🔒 브라우저 종료")
    
    # =========================================================================
    # 쿠키 관리
    # =========================================================================
    
    def _get_cookies_file(self) -> Path:
        """쿠키 파일 경로"""
        safe_id = self.kakao_id.replace("@", "_at_").replace(".", "_") if self.kakao_id else "default"
        return self.cookies_dir / f"{safe_id}_cookies.pkl"
    
    def _save_cookies(self):
        """현재 세션 쿠키 저장"""
        try:
            cookies = self.driver.get_cookies()
            relevant = [
                c for c in cookies
                if any(domain in c.get("domain", "") for domain in ["tistory.com", "kakao.com"])
            ]
            
            cookies_file = self._get_cookies_file()
            with open(cookies_file, "wb") as f:
                pickle.dump(relevant if relevant else cookies, f)
            
            self._log(f"🍪 쿠키 저장 완료 ({len(relevant or cookies)}개) → {cookies_file.name}")
        except Exception as e:
            self._log(f"⚠️ 쿠키 저장 실패: {e}")
    
    def _load_cookies(self) -> bool:
        """저장된 쿠키 로드 및 주입"""
        cookies_file = self._get_cookies_file()
        if not cookies_file.exists():
            return False
        
        try:
            self.driver.get("https://www.tistory.com/")
            time.sleep(1)
            
            with open(cookies_file, "rb") as f:
                cookies = pickle.load(f)
            
            for cookie in cookies:
                try:
                    self.driver.add_cookie(cookie)
                except Exception:
                    pass
            
            return True
        except Exception as e:
            self._log(f"⚠️ 쿠키 로드 실패: {e}")
            return False
    
    # =========================================================================
    # 로그인 상태 확인
    # =========================================================================
    
    def _check_login_status(self) -> bool:
        """현재 로그인 상태 확인"""
        try:
            current_url = self.driver.current_url
            
            # 카카오 인증 중이면 아직 미완료
            if "kauth.kakao.com" in current_url or "accounts.kakao.com" in current_url:
                return False
            
            # 티스토리에 있고 로그인 페이지가 아니면 성공
            if "tistory.com" in current_url and "auth/login" not in current_url:
                return True
            
            # DOM 기반 추가 확인
            from selenium.webdriver.common.by import By
            try:
                result = self.driver.execute_script("""
                    if (document.querySelector('a[href*="logout"]') || 
                        document.querySelector('.logout') ||
                        document.querySelector('.btn_mark') ||
                        (document.title.includes('TISTORY') && !document.title.includes('로그인'))) {
                        return true;
                    }
                    return false;
                """)
                return bool(result)
            except Exception:
                pass
            
            return False
        except Exception:
            return False
    
    # =========================================================================
    # 로그인 메서드들
    # =========================================================================
    
    def login(self, max_2fa_wait_minutes: int = 5) -> bool:
        """
        자동 로그인 (메인 메서드)
        
        흐름: 쿠키 시도 → 카카오 OAuth → 2FA 대기 → 쿠키 저장
        
        Args:
            max_2fa_wait_minutes: 2FA 승인 최대 대기 시간 (분)
        
        Returns:
            True: 로그인 성공, False: 실패
        """
        if not self.kakao_id or not self.kakao_pw:
            self._log("❌ 카카오 ID/PW가 설정되지 않았습니다")
            return False
        
        # 드라이버 초기화
        if not self.driver and not self._init_driver():
            return False
        
        # 1단계: 쿠키 로그인 시도
        if self._load_cookies():
            self._log("🍪 저장된 쿠키로 로그인 시도...")
            self.driver.get("https://www.tistory.com/")
            time.sleep(2)
            
            if self._check_login_status():
                self._log("✅ 쿠키 로그인 성공!")
                return True
            else:
                self._log("⚠️ 쿠키 만료, 재로그인 진행")
        
        # 2단계: 카카오 OAuth 로그인
        return self._kakao_oauth_login(max_2fa_wait_minutes)
    
    def login_manual(self) -> bool:
        """
        수동 로그인 모드
        
        브라우저를 띄우고 사용자가 직접 로그인하도록 대기합니다.
        로그인 완료 후 Enter 키를 누르면 쿠키를 저장하고 계속 진행합니다.
        
        Returns:
            True: 로그인 성공, False: 실패
        """
        # 드라이버 초기화 (항상 보이게)
        if not self.driver and not self._init_driver(force_visible=True):
            return False
        
        self._log("🔐 티스토리 로그인 페이지를 엽니다...")
        self.driver.get("https://www.tistory.com/auth/login")
        
        from selenium.webdriver.support.ui import WebDriverWait
        WebDriverWait(self.driver, 15).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )
        
        self._log("=" * 50)
        self._log("📱 브라우저에서 직접 로그인해 주세요.")
        self._log("   로그인 완료 후 이 터미널에서 Enter 키를 눌러주세요.")
        self._log("=" * 50)
        
        input("로그인 후 Enter 키를 누르세요...")
        
        time.sleep(2)
        
        if self._check_login_status():
            self._log("✅ 수동 로그인 성공!")
            self._save_cookies()
            return True
        
        # 티스토리 메인으로 이동해서 한번 더 확인
        self.driver.get("https://www.tistory.com/")
        time.sleep(2)
        
        if self._check_login_status():
            self._log("✅ 수동 로그인 성공!")
            self._save_cookies()
            return True
        
        self._log("❌ 로그인 상태를 확인할 수 없습니다")
        return False
    
    def login_with_cookies_only(self) -> bool:
        """
        쿠키만으로 로그인 시도 (ID/PW 불필요)
        
        Returns:
            True: 쿠키 로그인 성공, False: 쿠키 없거나 만료
        """
        if not self.driver and not self._init_driver():
            return False
        
        if not self._load_cookies():
            self._log("ℹ️ 저장된 쿠키가 없습니다")
            return False
        
        self.driver.get("https://www.tistory.com/")
        time.sleep(2)
        
        if self._check_login_status():
            self._log("✅ 쿠키 로그인 성공!")
            return True
        
        self._log("⚠️ 쿠키가 만료되었습니다")
        return False
    
    # =========================================================================
    # 카카오 OAuth 로그인 (내부)
    # =========================================================================
    
    def _kakao_oauth_login(self, max_2fa_wait_minutes: int = 5) -> bool:
        """카카오 OAuth 전체 플로우"""
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC
            
            wait = WebDriverWait(self.driver, 20)
            
            # ① 티스토리 로그인 페이지 접속
            self._log("🔐 카카오 로그인 시작...")
            self.driver.get("https://www.tistory.com/auth/login")
            wait.until(lambda d: d.execute_script("return document.readyState") == "complete")
            time.sleep(2)
            
            # ② 카카오 로그인 버튼 클릭 (3단 fallback)
            if not self._click_kakao_button(wait):
                return False
            
            time.sleep(3)
            
            # ③ 카카오 버튼 클릭 후 바로 로그인된 경우 (세션 유지)
            if self._check_login_status():
                self._log("✅ 카카오 세션 유지 - 바로 로그인 성공!")
                self._save_cookies()
                return True
            
            # ④ 카카오 로그인 페이지 대기
            try:
                WebDriverWait(self.driver, 10).until(
                    lambda d: "accounts.kakao.com" in d.current_url or "kauth.kakao.com" in d.current_url
                )
                self._log("   카카오 로그인 페이지 로딩 완료")
            except Exception:
                if self._check_login_status():
                    self._log("✅ 이미 로그인된 상태!")
                    self._save_cookies()
                    return True
                self._log("   카카오 페이지 대기 타임아웃, 계속 진행...")
            
            time.sleep(2)
            
            # ⑤ ID 입력
            if not self._input_credentials(wait):
                return False
            
            # ⑥ 2FA 대기
            self._log(f"⏳ 2단계 인증 대기 중... (카카오톡에서 승인해주세요, 최대 {max_2fa_wait_minutes}분)")
            
            max_wait = max_2fa_wait_minutes * 60
            for i in range(max_wait):
                time.sleep(1)
                
                if i > 0 and i % 30 == 0:
                    self._log(f"   대기 중... ({i}초 경과)")
                
                if self._check_login_status():
                    self._log("✅ 로그인 성공!")
                    self._save_cookies()
                    return True
            
            # ⑦ OAuth 동의 화면 처리
            self._handle_oauth_consent()
            time.sleep(3)
            
            # ⑧ 최종 확인
            if self._check_login_status():
                self._log("✅ 로그인 성공!")
                self._save_cookies()
                return True
            
            self._log("❌ 로그인 시간 초과")
            return False
            
        except Exception as e:
            self._log(f"❌ 로그인 오류: {e}")
            return False
    
    def _click_kakao_button(self, wait) -> bool:
        """카카오 로그인 버튼 클릭 (3단 fallback)"""
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        
        # 방법 1: CLASS_NAME
        try:
            kakao_btn = wait.until(EC.element_to_be_clickable((By.CLASS_NAME, "link_kakao_id")))
            kakao_btn.click()
            self._log("   카카오 버튼 클릭 (CLASS)")
            return True
        except Exception:
            pass
        
        # 방법 2: CSS_SELECTOR
        try:
            kakao_btn = self.driver.find_element(By.CSS_SELECTOR, ".btn_login.link_kakao_id")
            kakao_btn.click()
            self._log("   카카오 버튼 클릭 (CSS)")
            return True
        except Exception:
            pass
        
        # 방법 3: JavaScript
        try:
            js_result = self.driver.execute_script("""
                var links = document.querySelectorAll('a');
                for (var i = 0; i < links.length; i++) {
                    if (links[i].className.includes('kakao') || 
                        links[i].textContent.includes('카카오') ||
                        links[i].href.includes('kakao')) {
                        links[i].click();
                        return true;
                    }
                }
                return false;
            """)
            if js_result:
                self._log("   카카오 버튼 클릭 (JavaScript)")
                return True
        except Exception:
            pass
        
        self._log("❌ 카카오 로그인 버튼을 찾을 수 없습니다")
        self._log(f"   현재 URL: {self.driver.current_url}")
        return False
    
    def _input_credentials(self, wait) -> bool:
        """카카오 ID/PW 입력 및 로그인 버튼 클릭"""
        from selenium.webdriver.common.by import By
        from selenium.webdriver.support import expected_conditions as EC
        
        self._log("📝 카카오 계정 입력...")
        
        # ID 입력
        try:
            id_input = wait.until(
                EC.presence_of_element_located(
                    (By.CSS_SELECTOR, "input[name='loginId'], input[type='text'], input[type='email']")
                )
            )
            id_input.clear()
            id_input.send_keys(self.kakao_id)
            self._log("   ✅ ID 입력 완료")
        except Exception:
            self._log("   ❌ ID 입력란을 찾을 수 없습니다")
            return False
        
        time.sleep(1)
        
        # PW 입력
        try:
            pw_input = wait.until(
                EC.presence_of_element_located((By.CSS_SELECTOR, "input[type='password']"))
            )
            pw_input.clear()
            pw_input.send_keys(self.kakao_pw)
            self._log("   ✅ PW 입력 완료")
        except Exception:
            self._log("   ❌ PW 입력란을 찾을 수 없습니다")
            return False
        
        time.sleep(1)
        
        # 로그인 버튼 클릭
        try:
            login_btn = wait.until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, "button[type='submit']"))
            )
            login_btn.click()
            self._log("   ✅ 로그인 버튼 클릭")
        except Exception:
            self._log("   ❌ 로그인 버튼을 찾을 수 없습니다")
            return False
        
        return True
    
    def _handle_oauth_consent(self):
        """OAuth 동의 화면의 '계속하기' 버튼 처리"""
        try:
            from selenium.webdriver.common.by import By
            
            # 정확한 셀렉터
            try:
                btn = self.driver.find_element(
                    By.CSS_SELECTOR,
                    "button.btn_agree[name='user_oauth_approval'][value='true']"
                )
                if btn.is_displayed() and btn.is_enabled():
                    btn.click()
                    self._log("   ✅ OAuth '계속하기' 버튼 클릭")
                    return
            except Exception:
                pass
            
            # JavaScript fallback
            self.driver.execute_script("""
                var buttons = document.querySelectorAll('button');
                for (var i = 0; i < buttons.length; i++) {
                    if (buttons[i].textContent.includes('계속하기') || 
                        buttons[i].textContent.includes('계속')) {
                        buttons[i].click();
                        return;
                    }
                }
            """)
        except Exception:
            pass  # OAuth 동의 화면이 없으면 무시


# =============================================================================
# CLI 실행 (직접 테스트용)
# =============================================================================

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="티스토리 자동 로그인")
    parser.add_argument("--mode", choices=["auto", "manual", "cookie"], default="auto",
                        help="로그인 모드 (auto: 자동, manual: 수동, cookie: 쿠키만)")
    parser.add_argument("--id", help="카카오 ID (auto 모드)")
    parser.add_argument("--pw", help="카카오 PW (auto 모드)")
    parser.add_argument("--headless", action="store_true", help="헤드리스 모드")
    
    args = parser.parse_args()
    
    print("🎯 티스토리 자동 로그인")
    print("=" * 50)
    
    if args.mode == "auto":
        if args.id and args.pw:
            login = TistoryAutoLogin(kakao_id=args.id, kakao_pw=args.pw, headless=args.headless)
        else:
            login = TistoryAutoLogin.from_env(headless=args.headless)
        success = login.login()
    elif args.mode == "manual":
        login = TistoryAutoLogin()
        success = login.login_manual()
    else:  # cookie
        if args.id:
            login = TistoryAutoLogin(kakao_id=args.id, headless=args.headless)
        else:
            login = TistoryAutoLogin.from_env(headless=args.headless)
        success = login.login_with_cookies_only()
    
    print("\n" + "=" * 50)
    if success:
        print("🎉 로그인 성공!")
        print(f"🌐 현재 URL: {login.get_driver().current_url}")
        input("Enter 키를 누르면 브라우저를 종료합니다...")
    else:
        print("❌ 로그인 실패")
    
    login.close()
