#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
티스토리 자동 발행 모듈
=======================

tistory_login.py를 활용하여 티스토리에 블로그 글을 자동 발행합니다.

사용법:
    from tistory_publisher import TistoryPublisher

    publisher = TistoryPublisher(blog_url="https://climate-insight.tistory.com")
    result = publisher.publish(
        title="테스트 제목",
        html_content="<p>테스트 본문입니다.</p>",
        tags=["태그1", "태그2"],
        category="기후금융",
        is_private=False
    )
    print(result)  # {"success": True, "url": "https://..."}
"""

import time
import json
from typing import Optional
from pathlib import Path

# 같은 디렉토리의 tistory_login 모듈 임포트
from services.execution.tistory_login import TistoryAutoLogin


class TistoryPublisher:
    """티스토리 자동 발행 클래스"""

    CATEGORIES = [
        "카테고리 없음",
        "ai 신기술 및 이슈",
        "기후변화 이슈",
        "정책과 제도",
        "기후금융",
        "국제협력",
        "과학과 기술",
        "탄소중립",
        "기타",
    ]

    def __init__(
        self,
        blog_url: str = "https://climate-insight.tistory.com",
        login: Optional[TistoryAutoLogin] = None,
    ):
        self.blog_url = blog_url.rstrip("/")
        self.login = login or TistoryAutoLogin()
        self.driver = None

    def _log(self, msg: str):
        self.login._log(msg)

    # ==================================================================
    # 로그인
    # ==================================================================

    def _ensure_login(self) -> bool:
        """로그인 상태 보장 (쿠키 → 자동 → 실패)"""
        if self.driver:
            return True

        # 쿠키 로그인 시도
        if self.login.login_with_cookies_only():
            self.driver = self.login.get_driver()
            return True

        # .env 기반 자동 로그인 시도
        auto_login = TistoryAutoLogin.from_env()
        if auto_login.login():
            self.login = auto_login
            self.driver = auto_login.get_driver()
            return True

        self._log("❌ 로그인 실패")
        return False

    # ==================================================================
    # 에디터 조작
    # ==================================================================

    def _handle_alert(self, accept: bool = False):
        """브라우저 alert 팝업 처리 (임시 저장 글 등)"""
        try:
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC

            alert = WebDriverWait(self.driver, 3).until(
                EC.alert_is_present()
            )
            alert_text = alert.text
            self._log(f"   ⚠️ Alert 감지: {alert_text[:60]}")
            if accept:
                alert.accept()
            else:
                alert.dismiss()
            time.sleep(1)
        except Exception:
            pass  # alert 없으면 무시

    def _navigate_to_editor(self) -> bool:
        """글쓰기 페이지로 이동"""
        editor_url = f"{self.blog_url}/manage/newpost"
        self.driver.get(editor_url)
        time.sleep(2)

        # 임시 저장 글 alert 처리 ("이어서 작성하시겠습니까?")
        self._handle_alert(accept=False)

        # 글쓰기 페이지 로딩 확인
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC

            WebDriverWait(self.driver, 10).until(
                EC.presence_of_element_located((By.ID, "post-title-inp"))
            )
            self._log("✅ 글쓰기 페이지 로딩 완료")
            return True
        except Exception as e:
            self._log(f"❌ 글쓰기 페이지 로딩 실패: {e}")
            return False

    def _input_title(self, title: str) -> bool:
        """제목 입력"""
        try:
            from selenium.webdriver.common.by import By

            title_el = self.driver.find_element(By.ID, "post-title-inp")
            title_el.clear()
            title_el.send_keys(title)
            self._log(f"✅ 제목 입력: {title[:30]}...")
            return True
        except Exception as e:
            self._log(f"❌ 제목 입력 실패: {e}")
            return False

    def _switch_to_html_mode(self) -> bool:
        """TinyMCE 에디터를 HTML 모드로 전환"""
        try:
            from selenium.webdriver.common.by import By

            # "기본모드" 버튼 찾기 → 클릭하면 드롭다운 메뉴 오픈
            mode_btn = self.driver.find_element(
                By.CSS_SELECTOR, ".mce-tistory-mode button"
            )
            mode_btn.click()
            time.sleep(1)

            # HTML 모드 메뉴 항목 클릭
            html_option = self.driver.execute_script("""
                var items = document.querySelectorAll('.mce-menu-item .mce-text');
                for (var i = 0; i < items.length; i++) {
                    if (items[i].textContent.trim() === 'HTML') {
                        items[i].click();
                        return true;
                    }
                }
                return false;
            """)

            if html_option:
                self._log("✅ HTML 모드로 전환")
                time.sleep(1)
                return True

            self._log("⚠️ HTML 메뉴를 찾지 못함, 직접 시도...")
            return self._try_html_mode_fallback()

        except Exception as e:
            self._log(f"⚠️ HTML 모드 전환 시도 중 오류: {e}")
            return self._try_html_mode_fallback()

    def _try_html_mode_fallback(self) -> bool:
        """HTML 모드 전환 fallback"""
        try:
            # TinyMCE의 mode 변경을 직접 시도
            result = self.driver.execute_script("""
                // 방법 1: mce-menubtn 드롭다운에서 HTML 찾기
                var menuBtns = document.querySelectorAll('.mce-menubtn');
                for (var i = 0; i < menuBtns.length; i++) {
                    var text = menuBtns[i].textContent.trim();
                    if (text.includes('기본모드') || text.includes('모드')) {
                        menuBtns[i].click();
                        return 'clicked_mode_btn';
                    }
                }
                return 'not_found';
            """)
            self._log(f"   Fallback result: {result}")

            if result == "clicked_mode_btn":
                time.sleep(1)
                # HTML 옵션 클릭
                self.driver.execute_script("""
                    var items = document.querySelectorAll('.mce-text');
                    for (var i = 0; i < items.length; i++) {
                        if (items[i].textContent.trim() === 'HTML') {
                            items[i].click();
                            return;
                        }
                    }
                """)
                time.sleep(1)
                self._log("✅ HTML 모드 전환 (fallback)")
                return True

            return False
        except Exception:
            return False

    def _input_html_content(self, html_content: str) -> bool:
        """HTML 본문 입력 (HTML 모드에서)"""
        try:
            from selenium.webdriver.common.by import By

            # HTML 모드에서는 textarea 또는 CodeMirror가 나타남
            # 방법 1: textarea 직접 찾기
            try:
                html_textarea = self.driver.find_element(
                    By.CSS_SELECTOR, ".mce-tinymce textarea, textarea.mce-textbox"
                )
                html_textarea.clear()
                # JavaScript로 값 설정 (긴 HTML에 더 안정적)
                self.driver.execute_script(
                    "arguments[0].value = arguments[1]; "
                    "arguments[0].dispatchEvent(new Event('input', {bubbles: true}));",
                    html_textarea,
                    html_content,
                )
                self._log("✅ HTML 본문 입력 (textarea)")
                return True
            except Exception:
                pass

            # 방법 2: CodeMirror 에디터
            try:
                result = self.driver.execute_script("""
                    var cm = document.querySelector('.CodeMirror');
                    if (cm && cm.CodeMirror) {
                        cm.CodeMirror.setValue(arguments[0]);
                        return true;
                    }
                    return false;
                """, html_content)
                if result:
                    self._log("✅ HTML 본문 입력 (CodeMirror)")
                    return True
            except Exception:
                pass

            # 방법 3: TinyMCE API를 통해 직접 입력 (기본모드로)
            result = self.driver.execute_script("""
                if (typeof tinymce !== 'undefined' && tinymce.activeEditor) {
                    tinymce.activeEditor.setContent(arguments[0]);
                    return true;
                }
                return false;
            """, html_content)
            if result:
                self._log("✅ HTML 본문 입력 (TinyMCE API)")
                return True

            self._log("❌ 본문 입력 방법을 찾지 못함")
            return False

        except Exception as e:
            self._log(f"❌ 본문 입력 실패: {e}")
            return False

    def _input_tags(self, tags: list[str]) -> bool:
        """태그 입력"""
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.common.keys import Keys

            tag_input = self.driver.find_element(By.ID, "tagText")

            for tag in tags:
                tag_input.clear()
                tag_input.send_keys(tag)
                tag_input.send_keys(Keys.RETURN)
                time.sleep(0.3)

            self._log(f"✅ 태그 입력: {', '.join(tags[:5])}...")
            return True
        except Exception as e:
            self._log(f"❌ 태그 입력 실패: {e}")
            return False

    def _select_category(self, category: str) -> bool:
        """카테고리 선택"""
        try:
            from selenium.webdriver.common.by import By

            # 카테고리 버튼 클릭 → 드롭다운 열기
            cat_btn = self.driver.find_element(By.ID, "category-btn")
            cat_btn.click()
            time.sleep(1)

            # 카테고리 목록에서 해당 카테고리 클릭
            result = self.driver.execute_script("""
                var items = document.querySelectorAll(
                    '#category-list li, .list_category li, .category_list li a'
                );
                for (var i = 0; i < items.length; i++) {
                    var text = items[i].textContent.trim();
                    if (text === arguments[0]) {
                        items[i].click();
                        return true;
                    }
                }
                // Fallback: 모든 클릭 가능 요소에서 찾기
                var allEls = document.querySelectorAll('a, li, span, div');
                for (var i = 0; i < allEls.length; i++) {
                    if (allEls[i].textContent.trim() === arguments[0] &&
                        allEls[i].closest('#category-list, .layer_category, .list_category')) {
                        allEls[i].click();
                        return true;
                    }
                }
                return false;
            """, category)

            if result:
                self._log(f"✅ 카테고리 선택: {category}")
                return True
            else:
                self._log(f"⚠️ 카테고리 '{category}'를 찾지 못함, 기본값 유지")
                # 드롭다운 닫기
                cat_btn.click()
                return False

        except Exception as e:
            self._log(f"⚠️ 카테고리 선택 실패: {e}")
            return False

    def _click_publish(self, is_private: bool = False) -> bool:
        """발행 버튼 클릭"""
        try:
            from selenium.webdriver.common.by import By
            from selenium.webdriver.support.ui import WebDriverWait
            from selenium.webdriver.support import expected_conditions as EC

            # 1단계: [완료] 버튼 클릭 → 발행 설정 레이어 열기
            pub_layer_btn = self.driver.find_element(By.ID, "publish-layer-btn")
            pub_layer_btn.click()
            self._log("   📋 발행 설정 레이어 열기")
            time.sleep(2)

            # 2단계: 공개/비공개 설정
            if is_private:
                # 비공개 라디오 버튼: #open0 (value=0)
                self.driver.execute_script("""
                    var radio = document.getElementById('open0');
                    if (radio) {
                        radio.click();
                    } else {
                        var label = document.querySelector('label[for="open0"]');
                        if (label) label.click();
                    }
                """)
                self._log("   🔒 비공개로 설정")
                time.sleep(1)
            else:
                # 공개 라디오 버튼: #open20 (value=20) — 기본값이지만 명시적 클릭
                self.driver.execute_script("""
                    var radio = document.getElementById('open20');
                    if (radio) radio.click();
                """)
                self._log("   🌐 공개로 설정")
                time.sleep(0.5)

            # 3단계: 최종 발행 버튼 클릭 (#publish-btn, 텍스트: "공개 발행" 또는 "비공개 발행")
            try:
                publish_btn = WebDriverWait(self.driver, 5).until(
                    EC.element_to_be_clickable((By.ID, "publish-btn"))
                )
                btn_text = publish_btn.text.strip()
                self._log(f"   🚀 [{btn_text}] 버튼 클릭")
                publish_btn.click()
            except Exception:
                # Fallback: JavaScript로 직접 클릭
                self.driver.execute_script("""
                    var btn = document.getElementById('publish-btn');
                    if (btn) { btn.click(); return; }
                """)
                self._log("   🚀 발행 버튼 클릭 (JS fallback)")

            time.sleep(3)
            self._log("✅ 발행 완료!")
            return True
        except Exception as e:
            self._log(f"❌ 발행 실패: {e}")
            return False

    def _get_published_url(self) -> str:
        """발행 후 URL 추출"""
        try:
            current_url = self.driver.current_url
            # 발행 후 보통 관리 페이지로 리다이렉트됨
            if "/manage" in current_url:
                # 최근 글 목록에서 첫 번째 글 URL 추출 시도
                url = self.driver.execute_script("""
                    var link = document.querySelector(
                        '.list_post a, .tbl_post a, table a[href*="tistory.com"]'
                    );
                    return link ? link.href : '';
                """)
                return url or current_url
            return current_url
        except Exception:
            return ""

    # ==================================================================
    # 메인 발행 메서드
    # ==================================================================

    def publish(
        self,
        title: str,
        html_content: str,
        tags: list[str] = None,
        category: str = "기타",
        is_private: bool = False,
    ) -> dict:
        """
        티스토리에 글 발행

        Args:
            title: 글 제목
            html_content: HTML 형식 본문
            tags: 태그 리스트
            category: 카테고리 이름
            is_private: True면 비공개 발행

        Returns:
            {"success": bool, "url": str, "error": str}
        """
        tags = tags or []
        self._log("=" * 50)
        self._log(f"📝 발행 시작: {title[:40]}...")
        self._log(f"   카테고리: {category} | 태그: {len(tags)}개 | 비공개: {is_private}")
        self._log("=" * 50)

        # 1. 로그인
        if not self._ensure_login():
            return {"success": False, "url": "", "error": "로그인 실패"}

        # 2. 글쓰기 페이지 이동
        if not self._navigate_to_editor():
            return {"success": False, "url": "", "error": "글쓰기 페이지 로딩 실패"}

        # 3. 제목 입력
        if not self._input_title(title):
            return {"success": False, "url": "", "error": "제목 입력 실패"}

        # 4. HTML 모드 전환 + 본문 입력
        # TinyMCE 에디터가 완전히 초기화될 때까지 대기
        self._log("⏳ TinyMCE 에디터 초기화 대기...")
        for attempt in range(15):  # 최대 15초 대기
            editor_ready = self.driver.execute_script("""
                if (typeof tinymce === 'undefined') return 'no_tinymce';
                if (!tinymce.activeEditor) return 'no_editor';
                if (!tinymce.activeEditor.getBody()) return 'no_body';
                if (!tinymce.activeEditor.initialized) return 'not_init';
                return 'ready';
            """)
            if editor_ready == 'ready':
                self._log(f"✅ TinyMCE 준비 완료 (attempt {attempt + 1})")
                break
            time.sleep(1)
        else:
            self._log(f"⚠️ TinyMCE 초기화 대기 타임아웃 (마지막 상태: {editor_ready})")

        # 방법 1: TinyMCE API로 직접 시도
        content_verified = False
        try:
            self.driver.execute_script("""
                tinymce.activeEditor.setContent(arguments[0]);
            """, html_content)
            time.sleep(2)  # setContent 반영 대기

            # 실제로 콘텐츠가 들어갔는지 검증
            actual_length = self.driver.execute_script("""
                var content = tinymce.activeEditor.getContent();
                return content ? content.length : 0;
            """)
            if actual_length and actual_length > 100:
                self._log(f"✅ HTML 본문 입력 확인 (TinyMCE API, {actual_length}자)")
                content_verified = True
            else:
                self._log(f"⚠️ TinyMCE setContent 후 검증 실패 (길이: {actual_length})")
        except Exception as e:
            self._log(f"⚠️ TinyMCE API 시도 실패: {e}")

        # 방법 2: 검증 실패 시 HTML 모드로 전환 후 직접 입력
        if not content_verified:
            self._log("🔄 HTML 모드로 전환하여 재시도...")
            self._switch_to_html_mode()
            time.sleep(2)
            if not self._input_html_content(html_content):
                # 방법 3: 최후의 수단 — iframe body에 직접 주입
                self._log("🔄 iframe body 직접 주입 시도...")
                try:
                    injected = self.driver.execute_script("""
                        // 기본모드로 되돌리기
                        if (typeof tinymce !== 'undefined' && tinymce.activeEditor) {
                            var body = tinymce.activeEditor.getBody();
                            if (body) {
                                body.innerHTML = arguments[0];
                                tinymce.activeEditor.fire('change');
                                return body.innerHTML.length;
                            }
                        }
                        // iframe 접근 시도
                        var iframes = document.querySelectorAll('iframe');
                        for (var i = 0; i < iframes.length; i++) {
                            try {
                                var doc = iframes[i].contentDocument || iframes[i].contentWindow.document;
                                var body = doc.querySelector('body');
                                if (body && body.isContentEditable) {
                                    body.innerHTML = arguments[0];
                                    return body.innerHTML.length;
                                }
                            } catch(e) {}
                        }
                        return 0;
                    """, html_content)
                    if injected and injected > 100:
                        self._log(f"✅ HTML 본문 입력 확인 (iframe 직접 주입, {injected}자)")
                        content_verified = True
                    else:
                        self._log(f"❌ iframe 주입도 실패 (길이: {injected})")
                except Exception as e:
                    self._log(f"❌ iframe 주입 실패: {e}")

            else:
                content_verified = True

        if not content_verified:
            return {"success": False, "url": "", "error": "본문 입력 실패 (모든 방법 실패)"}

        # 5. 태그 입력
        if tags:
            self._input_tags(tags)

        # 6. 카테고리 선택
        if category and category != "카테고리 없음":
            self._select_category(category)

        time.sleep(1)

        # 7. 발행
        if not self._click_publish(is_private=is_private):
            return {"success": False, "url": "", "error": "발행 버튼 클릭 실패"}

        # 8. 발행 URL 추출
        published_url = self._get_published_url()
        self._log(f"🎉 발행 완료! URL: {published_url}")

        return {"success": True, "url": published_url, "error": ""}

    def close(self):
        """브라우저 종료"""
        self.login.close()
        self.driver = None


# =============================================================================
# CLI 테스트
# =============================================================================
if __name__ == "__main__":
    publisher = TistoryPublisher()
    result = publisher.publish(
        title="[자동화 테스트] 이 글은 자동 발행 테스트입니다",
        html_content="""
        <h2>자동 발행 테스트</h2>
        <p>이 글은 <strong>AutoBlogByGoogleAI</strong> 자동화 시스템의 발행 기능을 테스트하기 위해 생성되었습니다.</p>
        <p>이 글이 보인다면 자동 발행이 성공적으로 작동하고 있다는 뜻입니다! 🎉</p>
        <h3>테스트 항목</h3>
        <ul>
            <li>✅ 제목 자동 입력</li>
            <li>✅ HTML 본문 자동 입력</li>
            <li>✅ 태그 자동 입력</li>
            <li>✅ 카테고리 자동 선택</li>
            <li>✅ 비공개 발행</li>
        </ul>
        """,
        tags=["자동화테스트", "AutoBlog"],
        category="기타",
        is_private=True,  # 비공개로 테스트
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    publisher.close()
