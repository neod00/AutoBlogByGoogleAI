#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
quality_gate.py
===============
생성된 블로그 콘텐츠의 품질을 자동 검증하는 게이트.
auto-publish.yml에서 글 생성 직후, 발행 직전에 실행됩니다.

Usage:
    python scripts/quality_gate.py --content-file /tmp/blog_output.json --topic "원래 주제"

Exit codes:
    0 = PASS  (발행 가능)
    1 = FAIL  (발행 불가, 스킵)
"""

import argparse
import html as html_lib
import json
import os
import re
import sys
from collections import Counter

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")

# ═══════════════════════════════════════════════════════════════
# 검증 기준 설정 (필요 시 조정 가능)
# ═══════════════════════════════════════════════════════════════

MIN_CONTENT_LENGTH = 800        # 최소 글자 수 (HTML 태그 제외 순수 텍스트)
TARGET_MAX_CONTENT_LENGTH = 7500  # 자동 발행용 목표 상한 (레퍼런스/CTA 포함 순수 텍스트)
MAX_CONTENT_LENGTH = 50000      # 비정상적으로 긴 글 (AI 무한 반복 의심)
MIN_HEADINGS = 2                # 최소 H2/H3 소제목 수
MIN_TITLE_LENGTH = 5            # 제목 최소 글자 수
MAX_TITLE_LENGTH = 80           # 제목 최대 글자 수 (검색 결과 노출 고려)
MIN_TAGS = 5                    # 최소 태그 수
MIN_IMAGES = 2                  # 자동 발행 최소 이미지 수
MAX_LONG_PARAGRAPH_CHARS = 220  # 모바일 가독성 기준
MAX_LONG_PARAGRAPHS = 1         # 긴 문단 허용 개수
MAX_PARAGRAPH_REPEAT_RATIO = 0.4  # 문단 중복 비율 한계 (40% 이상이면 반복 의심)
MIN_KEYWORD_APPEARANCES = 1     # 주제 키워드 최소 등장 횟수
MAX_KEYWORD_DENSITY = 0.05      # 키워드 밀도 상한 (5% 이상이면 스팸)

# AI가 자주 내뿜는 기계적 문구 (한국어 + 영어)
AI_SPEAK_PATTERNS = [
    r"AI\s*(언어\s*)?모델로서",
    r"저는\s*AI",
    r"인공지능으로서",
    r"도움이\s*되셨기를\s*바랍니다",
    r"궁금한\s*점이\s*있으시면",
    r"추가\s*질문이\s*있으시면",
    r"As an AI",
    r"I('m| am) an AI",
    r"language model",
    r"I don't have personal",
    r"I cannot browse",
]

# 티스토리/애드센스 정책 위반 가능성 높은 금칙어
POLICY_BANNED_WORDS = [
    "도박", "카지노", "성인용", "불법 다운로드", "토렌트",
    "마약", "대출 사기", "몰카", "딥페이크",
]

# 블로그 지침에서 금지한 상투어. 부분 일치도 차단한다.
BANNED_EXPRESSIONS = [
    "자리매김", "자리 잡", "원년", "서막", "이정표", "쓰나미", "파도",
    "본격화", "주역", "진화", "선제적", "변곡점", "잠재력",
    "패러다임", "지평", "주목할 만", "장악", "혁신을 가져올",
    "열쇠입니다", "달려 있습니다", "성공의 비결", "체계적으로",
    "지 않을 수 없습니다", "할 때입니다",
    "지속 가능한 미래", "친환경 패러다임", "녹색 혁명", "탄소중립의 원년",
    "기후위기 쓰나미", "지구의 미래를 위해", "더 나은 내일",
]

TITLE_BANNED_PATTERNS = [
    (r"20\d{2}년\s*[,:\-—]", "연도 뒤 쉼표/콜론/대시 패턴"),
    (r"(완벽\s*가이드|모든\s*것)\s*$", "상투적 제목 끝맺음"),
    (r"(서막|원년|진화)", "상투적 제목 표현"),
    (r"!{2,}", "느낌표 과다 사용"),
    (r"(지금\s*당장|놀라운|충격적인)", "클릭베이트 표현"),
]

COMPARISON_HINTS = [
    " vs ", " VS ", "비교", "차이", "장단점", "정책", "규제", "지원금",
    "인증", "공시", "로드맵", "CBAM", "RE100", "배출권",
    "EU", "미국", "중국", "한국", "일본",
]

OFFICIAL_SOURCE_HINTS = [
    "환경부", "국토교통부", "산업통상자원부", "기획재정부", "금융위원회",
    "공정거래위원회", "한국에너지공단", "한국환경공단", "온실가스종합정보센터",
    "European Commission", "EU", "IATA", "ICAO", "IEA", "IPCC", "UNFCCC", "OECD",
    "SEC", "EPA", "보도자료", "공시", "annual report", "sustainability report",
]

AWKWARD_REPLACEMENT_PHRASES = [
    "미리 준비한으로", "미리 준비한인", "사전으로", "사전인",
    "사전 대응적", "사전 준비적", "기계적으로 치환",
]

LOW_QUALITY_SOURCE_HOST_HINTS = [
    "google.", "vertexaisearch.", "googleusercontent.", "search.app",
]

# 독자에게 정보를 주지 않는 옛 템플릿 문구
TEMPLATE_LEFTOVER_PATTERNS = [
    (r"이\s*글을\s*(다|끝까지)\s*읽으", "'이 글을 다 읽으면' 도입 문구"),
    (r"예상\s*읽기\s*시간|읽는\s*데는?\s*약\s*\d+\s*분", "예상 읽기 시간"),
    (r"다음에\s*검색해\s*볼\s*키워드", "'다음에 검색해볼 키워드'"),
]

# 키워드가 없는 범용 소제목
GENERIC_HEADINGS = ["정리하면", "그래서 누가 무엇을 해야 하나", "결론", "마치며", "맺음말"]

# 지어낸 1인칭 경험 (운영자 현장 메모 field_notes가 없을 때 차단)
FABRICATED_EXPERIENCE_PATTERNS = [
    r"저희\s*회사",
    r"제가\s*(최근|직접|여러|만나|이야기|컨설팅|현장|담당)",
    r"제\s*경험(상|으로|에)",
    r"(만나|이야기해|얘기해)\s*보(면|니)",
    r"주변\s*(기업|실무자|담당자|사례)",
    r"실무자들과\s*이야기",
]

# 가치 요소: 근거가 있을 때 넣는 모듈. 최소 개수 미달이면 실패.
VALUE_MODULE_MIN = 3
VALUE_MODULE_WARN = 2

# 지원사업·공고형 글 판별과 접수기간 표기 확인
PROGRAM_TITLE_PATTERN = r"지원사업|지원금|모집|공고"
PROGRAM_BODY_KEYWORD = "지원사업"
PROGRAM_BODY_MIN_MENTIONS = 3
DATE_PATTERN = r"\d{1,2}월\s*\d{1,2}일|\d{4}\.\s?\d{1,2}\.\s?\d{1,2}"

# 제목의 제재 표현과 본문의 면책·유예가 충돌하는지
TITLE_SANCTION_PATTERN = r"과징금|벌금|처벌|과태료"
BODY_RELIEF_PATTERN = r"면제|면책|유예|적용\s*제외"

# 같은 수치 반복 (연도 제외)
REPEATED_FIGURE_PATTERN = r"\d[\d,.]*\s*(?:조|억|만)?\s*(?:원|유로|달러|톤|개사|%)"
MAX_FIGURE_REPEAT = 3

# 기존 글 제목과의 유사도 (문자 bigram Jaccard)
TITLE_SIMILARITY_WARN = 0.45


def strip_html(html: str) -> str:
    """HTML 태그를 모두 제거하고 순수 텍스트만 반환"""
    text = re.sub(r'<[^>]+>', ' ', html)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def extract_headings(html: str) -> list:
    """H2, H3 태그를 추출"""
    return re.findall(r'<h[23][^>]*>(.*?)</h[23]>', html, re.IGNORECASE)


def extract_paragraphs(html: str) -> list:
    """문단 단위로 분리 (p 태그 기준 또는 줄바꿈)"""
    paragraphs = re.findall(r'<p[^>]*>(.*?)</p>', html, re.IGNORECASE | re.DOTALL)
    if not paragraphs:
        paragraphs = [p.strip() for p in strip_html(html).split('\n') if len(p.strip()) > 30]
    return [strip_html(p) for p in paragraphs if len(strip_html(p)) > 20]


def count_images(html: str) -> int:
    """이미지 태그 수 카운트"""
    return len(re.findall(r'<img\s', html, re.IGNORECASE))


def count_tables(html: str) -> int:
    """표 태그 수 카운트"""
    return len(re.findall(r'<table\b', html, re.IGNORECASE))


def extract_links(html: str) -> list:
    """본문 링크 URL 목록 추출"""
    return re.findall(r'<a\s+[^>]*href=["\']([^"\']+)["\']', html, re.IGNORECASE)


def count_links(html: str) -> int:
    """본문 링크 수 카운트"""
    return len(extract_links(html))


def is_external_source_link(url: str) -> bool:
    lower = url.lower()
    return lower.startswith("http") and "climate-insight.tistory.com" not in lower


def is_low_quality_source_url(url: str) -> bool:
    lower = url.lower()
    return any(host in lower for host in LOW_QUALITY_SOURCE_HOST_HINTS)


# ═══════════════════════════════════════════════════════════════
# 개별 검증 함수들
# ═══════════════════════════════════════════════════════════════

class QualityReport:
    def __init__(self):
        self.checks = []
        self.passed = 0
        self.failed = 0
        self.warnings = 0

    def pass_check(self, name: str, detail: str = ""):
        self.checks.append(("✅", name, detail))
        self.passed += 1

    def fail_check(self, name: str, detail: str = ""):
        self.checks.append(("❌", name, detail))
        self.failed += 1

    def warn_check(self, name: str, detail: str = ""):
        self.checks.append(("⚠️", name, detail))
        self.warnings += 1

    def print_report(self):
        print("\n" + "=" * 60)
        print("🛡️  Quality Gate Report")
        print("=" * 60)
        for icon, name, detail in self.checks:
            line = f"  {icon} {name}"
            if detail:
                line += f" — {detail}"
            print(line)
        print("-" * 60)
        print(f"  결과: ✅ {self.passed}개 통과 | ❌ {self.failed}개 실패 | ⚠️ {self.warnings}개 주의")
        
        if self.failed > 0:
            print("\n  🚫 판정: FAIL — 발행을 보류합니다.")
        elif self.warnings > 2:
            print("\n  ⚠️ 판정: PASS (주의) — 발행하되, 품질 개선이 필요합니다.")
        else:
            print("\n  🎉 판정: PASS — 발행 적합!")
        print("=" * 60 + "\n")

    @property
    def is_passed(self) -> bool:
        return self.failed == 0


def check_title(report: QualityReport, title: str):
    """제목 검증"""
    if not title or len(title.strip()) < MIN_TITLE_LENGTH:
        report.fail_check("제목 길이", f"'{title}' ({len(title)}자) — 최소 {MIN_TITLE_LENGTH}자 필요")
    elif len(title) > MAX_TITLE_LENGTH:
        report.warn_check("제목 길이", f"({len(title)}자) — {MAX_TITLE_LENGTH}자 초과, 검색엔진에서 잘릴 수 있음")
    else:
        report.pass_check("제목 길이", f"({len(title)}자)")

    violations = []
    for pattern, label in TITLE_BANNED_PATTERNS:
        if re.search(pattern, title, re.IGNORECASE):
            violations.append(label)

    if violations:
        report.fail_check("제목 금지 패턴", ", ".join(violations))
    else:
        report.pass_check("제목 금지 패턴", "위반 없음")


def check_content_length(report: QualityReport, plain_text: str):
    """본문 글자 수 검증"""
    length = len(plain_text)
    if length < MIN_CONTENT_LENGTH:
        report.fail_check("본문 분량", f"{length}자 — 최소 {MIN_CONTENT_LENGTH}자 필요")
    elif length > TARGET_MAX_CONTENT_LENGTH:
        report.fail_check("본문 분량", f"{length}자 — 자동 발행 목표 상한 {TARGET_MAX_CONTENT_LENGTH}자 초과")
    elif length > MAX_CONTENT_LENGTH:
        report.fail_check("본문 분량", f"{length}자 — 비정상적으로 길음 (AI 반복 출력 의심)")
    else:
        report.pass_check("본문 분량", f"{length}자")


def check_headings(report: QualityReport, headings: list):
    """소제목 구조 검증"""
    if len(headings) < MIN_HEADINGS:
        report.warn_check("소제목 구조", f"H2/H3 {len(headings)}개 — 최소 {MIN_HEADINGS}개 권장")
    else:
        report.pass_check("소제목 구조", f"H2/H3 {len(headings)}개")


def check_tags(report: QualityReport, tags: list):
    """태그 존재 여부"""
    if len(tags) < MIN_TAGS:
        report.fail_check("태그", f"{len(tags)}개 — 최소 {MIN_TAGS}개 필요")
    else:
        report.pass_check("태그", f"{len(tags)}개")


def check_images(report: QualityReport, image_count: int):
    """이미지 삽입 여부"""
    if image_count < MIN_IMAGES:
        report.fail_check("이미지", f"{image_count}장 — 자동 발행 최소 {MIN_IMAGES}장 필요")
    else:
        report.pass_check("이미지", f"{image_count}장 발견")


def check_banned_expressions(report: QualityReport, title: str, plain_text: str):
    """상투적 금지 표현 감지"""
    combined = f"{title} {plain_text}"
    found = [word for word in BANNED_EXPRESSIONS if word in combined]

    if found:
        report.fail_check("금지 표현", ", ".join(found[:8]))
    else:
        report.pass_check("금지 표현", "위반 없음")


def check_awkward_replacement_phrases(report: QualityReport, title: str, plain_text: str):
    """자동 치환으로 생긴 어색한 조사/문장 흔적 감지"""
    combined = f"{title} {plain_text}"
    found = [phrase for phrase in AWKWARD_REPLACEMENT_PHRASES if phrase in combined]

    if found:
        report.fail_check("문장 자연스러움", ", ".join(found))
    else:
        report.pass_check("문장 자연스러움", "어색한 치환 흔적 없음")

def check_paragraph_lengths(report: QualityReport, paragraphs: list):
    """모바일 가독성을 해치는 긴 문단 감지"""
    long_lengths = [len(p) for p in paragraphs if len(p) > MAX_LONG_PARAGRAPH_CHARS]

    if len(long_lengths) > MAX_LONG_PARAGRAPHS:
        sample = ", ".join(str(n) for n in long_lengths[:5])
        report.fail_check("문단 길이", f"{len(long_lengths)}개 문단이 {MAX_LONG_PARAGRAPH_CHARS}자 초과 ({sample}자)")
    elif long_lengths:
        report.warn_check("문단 길이", f"긴 문단 1개 발견 ({long_lengths[0]}자)")
    else:
        report.pass_check("문단 길이", "모바일 기준 통과")


def check_answer_first(report: QualityReport, paragraphs: list):
    """도입부가 결론(숫자·날짜)부터 말하는지"""
    lead = " ".join(paragraphs[:2])
    if re.search(r"\d", lead):
        report.pass_check("결론 먼저", "도입부에 숫자/날짜 포함")
    else:
        report.warn_check("결론 먼저", "첫 두 문단에 숫자나 날짜가 없음 — 누가/언제/얼마를 먼저 답해야 함")


def check_as_of_date(report: QualityReport, plain_text: str):
    """기준일 표기 (규제·일정 정보의 유효 시점)"""
    if re.search(r"20\d{2}년\s*\d{1,2}월\s*기준", plain_text):
        report.pass_check("기준일", "'YYYY년 M월 기준' 표기 있음")
    else:
        report.fail_check("기준일", "'YYYY년 M월 기준' 표기가 없음")


def check_checklist(report: QualityReport, html: str):
    """결론 체크리스트 (<ol> 3~5개 항목)"""
    lists = re.findall(r"<ol\b[^>]*>(.*?)</ol>", html, re.IGNORECASE | re.DOTALL)
    counts = [len(re.findall(r"<li\b", ol, re.IGNORECASE)) for ol in lists]
    if any(3 <= c <= 6 for c in counts):
        report.pass_check("체크리스트", f"<ol> 항목 {max(counts)}개")
    else:
        report.fail_check("체크리스트", "3~5개 항목의 <ol> 체크리스트가 없음")


def detect_value_modules(html: str, plain_text: str) -> list:
    """근거 기반 가치 요소 5종 중 포함된 것"""
    found = []
    if re.search(r"가상\s*사례", plain_text):
        found.append("가상 사례")
    faq_h2 = re.search(r"<h2[^>]*>[^<]*자주\s*묻는", html, re.IGNORECASE)
    faq_questions = re.findall(r"<h3[^>]*>[^<]*\?\s*</h3>", html, re.IGNORECASE)
    if faq_h2 and len(faq_questions) >= 2:
        found.append("자주 묻는 질문")
    if re.search(r"달라진\s*점|바뀐\s*점|바뀌었는지|바뀐\s*내용|초안.{0,15}최종", plain_text):
        found.append("달라진 점")
    for thead in re.findall(r"<table\b.*?</tr>", html, re.IGNORECASE | re.DOTALL):
        if re.search(r"자료|항목|체크|담당|준비|제출", strip_html(thead)):
            found.append("실무 표")
            break
    if re.search(r"<h2[^>]*>[^<]*(일정|앞으로)", html, re.IGNORECASE):
        found.append("앞으로의 일정")
    return found


def check_value_modules(report: QualityReport, html: str, plain_text: str):
    """가치 요소 개수"""
    found = detect_value_modules(html, plain_text)
    detail = f"{len(found)}개 ({', '.join(found) or '없음'})"
    if len(found) >= VALUE_MODULE_MIN:
        report.pass_check("가치 요소", detail)
    elif len(found) >= VALUE_MODULE_WARN:
        report.warn_check("가치 요소", f"{detail} — {VALUE_MODULE_MIN}개 이상 권장")
    else:
        report.fail_check("가치 요소", f"{detail} — 최소 {VALUE_MODULE_MIN}개 필요")


def check_template_leftovers(report: QualityReport, plain_text: str, headings: list):
    """옛 템플릿 문구와 범용 소제목"""
    leftovers = [label for pattern, label in TEMPLATE_LEFTOVER_PATTERNS if re.search(pattern, plain_text)]
    if leftovers:
        report.fail_check("템플릿 잔재", ", ".join(leftovers))
    else:
        report.pass_check("템플릿 잔재", "없음")

    generic = [strip_html(h) for h in headings if strip_html(h).strip() in GENERIC_HEADINGS]
    if generic:
        report.warn_check("소제목 키워드", f"범용 소제목: {', '.join(generic)}")
    else:
        report.pass_check("소제목 키워드", "범용 소제목 없음")


def check_fabricated_experience(report: QualityReport, plain_text: str, has_field_notes: bool):
    """근거 없는 1인칭 경험 서술"""
    hits = []
    for pattern in FABRICATED_EXPERIENCE_PATTERNS:
        m = re.search(pattern, plain_text)
        if m:
            start = max(0, m.start() - 10)
            hits.append(plain_text[start:m.end() + 15].strip())
    if not hits:
        report.pass_check("지어낸 경험", "1인칭 경험 서술 없음")
    elif has_field_notes:
        report.warn_check("지어낸 경험", f"운영자 메모와 일치하는지 확인: {' / '.join(hits[:2])}")
    else:
        report.fail_check("지어낸 경험", f"운영자 메모 없이 1인칭 경험 서술: {' / '.join(hits[:2])}")


def check_title_body_consistency(report: QualityReport, title: str, plain_text: str):
    """제목의 제재 표현이 본문의 면책·유예와 충돌하는지"""
    if re.search(TITLE_SANCTION_PATTERN, title) and re.search(BODY_RELIEF_PATTERN, plain_text):
        report.warn_check("제목-본문 일치", "제목은 제재를 강조하지만 본문에 면책·유예 조건이 있음")
    else:
        report.pass_check("제목-본문 일치", "충돌 없음")


def check_program_deadlines(report: QualityReport, title: str, plain_text: str):
    """지원사업·공고형 글에 접수기간이 있는지"""
    is_program = re.search(PROGRAM_TITLE_PATTERN, title) or plain_text.count(PROGRAM_BODY_KEYWORD) >= PROGRAM_BODY_MIN_MENTIONS
    if not is_program:
        report.pass_check("접수기간", "지원사업형 글 아님 (스킵)")
        return
    dates = re.findall(DATE_PATTERN, plain_text)
    if len(dates) >= 2 and re.search(r"마감|접수", plain_text):
        report.pass_check("접수기간", f"날짜 {len(dates)}개와 접수/마감 표기 확인")
    else:
        report.fail_check("접수기간", "지원사업형 글인데 접수 시작일·마감일이 없음")


def check_figure_repetition(report: QualityReport, html: str):
    """문장 속 같은 수치의 과도한 반복 (연도·표 제외 — 표는 행마다 값이 반복될 수 있음)"""
    prose = strip_html(re.sub(r"<table\b.*?</table>", " ", html, flags=re.IGNORECASE | re.DOTALL))
    figures = [re.sub(r"\s+", "", f) for f in re.findall(REPEATED_FIGURE_PATTERN, prose)]
    over = [(f, c) for f, c in Counter(figures).most_common() if c > MAX_FIGURE_REPEAT]
    if over:
        report.warn_check("수치 반복", ", ".join(f"'{f}' {c}회" for f, c in over[:3]))
    else:
        report.pass_check("수치 반복", f"같은 수치 {MAX_FIGURE_REPEAT}회 이하")


def _title_bigrams(title: str) -> set:
    normalized = re.sub(r"[\s\W_]+", "", html_lib.unescape(html_lib.unescape(title)).lower())
    return {normalized[i:i + 2] for i in range(len(normalized) - 1)}


def check_cannibalization(report: QualityReport, title: str, existing_titles: list):
    """기존 글 제목과의 유사도"""
    if not existing_titles:
        report.pass_check("주제 중복", "기존 글 목록 없음 (스킵)")
        return
    current = _title_bigrams(title)
    best_score, best_title = 0.0, ""
    for existing in existing_titles:
        other = _title_bigrams(existing)
        if not current or not other or existing.strip() == title.strip():
            continue
        score = len(current & other) / len(current | other)
        if score > best_score:
            best_score, best_title = score, existing
    if best_score >= TITLE_SIMILARITY_WARN:
        report.warn_check("주제 중복", f"유사도 {best_score:.2f}: '{html_lib.unescape(html_lib.unescape(best_title))}'")
    else:
        report.pass_check("주제 중복", f"최대 유사도 {best_score:.2f}")


def check_table_requirement(report: QualityReport, title: str, plain_text: str, table_count: int):
    """비교/정책/규제형 글의 표 포함 여부"""
    combined = f"{title} {plain_text}"
    needs_table = any(hint in combined for hint in COMPARISON_HINTS)

    if needs_table and table_count == 0:
        report.fail_check("비교표", "비교/정책/규제형 주제인데 <table>이 없음")
    elif table_count > 0:
        report.pass_check("비교표", f"{table_count}개 발견")
    else:
        report.pass_check("비교표", "단일 사건형 주제로 판단")


def check_source_quality(report: QualityReport, html: str, plain_text: str):
    """출처 링크와 1차 출처 힌트 검사"""
    links = extract_links(html)
    link_count = len(links)
    if link_count == 0:
        report.fail_check("출처 링크", "본문에 링크가 없음")
        return

    has_reference_section = 'class="references"' in html and "근거와 참고자료" in plain_text
    source_links = [url for url in links if is_external_source_link(url)]
    low_quality_links = [url for url in source_links if is_low_quality_source_url(url)]
    direct_source_links = [url for url in source_links if not is_low_quality_source_url(url)]
    has_official_hint = any(hint.lower() in plain_text.lower() for hint in OFFICIAL_SOURCE_HINTS)

    if not has_reference_section:
        report.warn_check("출처 표시", "하단 근거와 참고자료 섹션 없음")
    elif low_quality_links and not direct_source_links:
        report.warn_check("출처 링크", "Google/검색 리다이렉트 링크만 감지됨")
    elif not direct_source_links:
        report.warn_check("출처 링크", "직접 외부 출처 URL 부족")
    else:
        report.pass_check("출처 링크", f"직접 외부 출처 {len(direct_source_links)}개")

    if not has_official_hint:
        report.warn_check("출처 품질", f"링크 {link_count}개, 공식/1차 출처 힌트 부족")
    else:
        report.pass_check("출처 품질", f"링크 {link_count}개 및 공식/1차 출처 힌트 확인")


def check_ai_speak(report: QualityReport, plain_text: str):
    """AI 기계적 문구 감지"""
    found = []
    for pattern in AI_SPEAK_PATTERNS:
        matches = re.findall(pattern, plain_text, re.IGNORECASE)
        if matches:
            found.append(pattern)
    
    if found:
        report.fail_check("AI 문구 감지", f"{len(found)}개 패턴 발견 — 자연스러운 글이 아닐 수 있음")
    else:
        report.pass_check("AI 문구 감지", "기계적 문구 없음")


def check_repetition(report: QualityReport, paragraphs: list):
    """문단 반복 감지"""
    if len(paragraphs) < 3:
        report.pass_check("문단 반복", "검사 대상 부족 (스킵)")
        return
    
    # 문단의 첫 30자를 비교해서 동일 문단 반복 감지
    fingerprints = [p[:30] for p in paragraphs]
    counter = Counter(fingerprints)
    repeated = sum(1 for count in counter.values() if count > 1)
    ratio = repeated / len(paragraphs) if paragraphs else 0
    
    if ratio > MAX_PARAGRAPH_REPEAT_RATIO:
        report.fail_check("문단 반복", f"반복 비율 {ratio:.0%} — {MAX_PARAGRAPH_REPEAT_RATIO:.0%} 초과")
    else:
        report.pass_check("문단 반복", f"반복 비율 {ratio:.0%}")


def check_keyword_density(report: QualityReport, plain_text: str, topic: str):
    """SEO 키워드 밀도 검증"""
    if not topic:
        report.pass_check("키워드 밀도", "주제 미제공 (스킵)")
        return
    
    # 주제에서 핵심 키워드 추출 (2글자 이상 단어)
    keywords = [w for w in re.split(r'[\s,·:]+', topic) if len(w) >= 2]
    if not keywords:
        report.pass_check("키워드 밀도", "키워드 추출 불가 (스킵)")
        return
    
    total_words = len(plain_text)
    found_any = False
    
    for kw in keywords:
        count = plain_text.lower().count(kw.lower())
        if count > 0:
            found_any = True
            density = (count * len(kw)) / total_words if total_words > 0 else 0
            if density > MAX_KEYWORD_DENSITY:
                report.warn_check("키워드 밀도", f"'{kw}' {count}회 (밀도 {density:.1%}) — 키워드 스터핑 주의")
                return
    
    if not found_any:
        report.warn_check("키워드 밀도", f"주제 키워드가 본문에 거의 없음 — SEO 불리")
    else:
        report.pass_check("키워드 밀도", "적절한 범위")


def check_policy(report: QualityReport, plain_text: str):
    """정책 위반 금칙어 검사"""
    found = [word for word in POLICY_BANNED_WORDS if word in plain_text]
    
    if found:
        report.fail_check("정책 금칙어", f"발견: {', '.join(found)} — 애드센스/티스토리 정책 위반 가능")
    else:
        report.pass_check("정책 금칙어", "위반 사항 없음")


def check_completeness(report: QualityReport, html: str):
    """글 완전성 검증 (갑자기 끊기지 않았는지)"""
    # 열린 태그와 닫힌 태그 수 비교 (심각한 불일치만 체크)
    open_tags = len(re.findall(r'<(h[23]|p|div|ul|ol|table)\b', html, re.IGNORECASE))
    close_tags = len(re.findall(r'</(h[23]|p|div|ul|ol|table)>', html, re.IGNORECASE))
    
    # 마지막 문장은 자동으로 붙는 출처/관련글 영역을 제외한 본문 기준으로 본다.
    body_html = re.split(
        r'<div[^>]*class=["\']references["\'][^>]*>|<div\s+style=["\'][^"\']*margin:\s*3rem',
        html,
        maxsplit=1,
        flags=re.IGNORECASE,
    )[0]
    plain = strip_html(body_html).strip() or strip_html(html).strip()
    ends_properly = plain and plain[-1] in '.!?。\”’'
    
    if abs(open_tags - close_tags) > 3:
        report.warn_check("글 완전성", f"HTML 태그 불일치 (열림 {open_tags} vs 닫힘 {close_tags})")
    elif not ends_properly:
        report.warn_check("글 완전성", "마지막 문장이 완결되지 않았을 수 있음")
    else:
        report.pass_check("글 완전성", "정상")


# ═══════════════════════════════════════════════════════════════
# 메인
# ═══════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Blog Quality Gate")
    parser.add_argument("--content-file", required=True, help="Path to generated JSON content")
    parser.add_argument("--topic", default="", help="Original topic for keyword check")
    parser.add_argument(
        "--result-file",
        default=os.environ.get("QUALITY_GATE_RESULT_PATH", "/tmp/quality_gate_result.json"),
        help="Path to write the quality gate JSON result",
    )
    args = parser.parse_args()

    # 콘텐츠 로드
    try:
        with open(args.content_file, "r", encoding="utf-8-sig") as f:
            content = json.load(f)
    except Exception as e:
        print(f"❌ 콘텐츠 파일 로드 실패: {e}")
        sys.exit(1)

    title = content.get("title", "")
    html = content.get("html", "")
    tags = content.get("tags", [])
    existing_titles = content.get("existing_titles", [])
    has_field_notes = bool(content.get("field_notes"))

    # 데이터 추출
    plain_text = strip_html(html)
    headings = extract_headings(html)
    paragraphs = extract_paragraphs(html)
    image_count = count_images(html)
    table_count = count_tables(html)

    # 검증 실행
    report = QualityReport()

    check_title(report, title)
    check_content_length(report, plain_text)
    check_headings(report, headings)
    check_tags(report, tags)
    check_images(report, image_count)
    check_banned_expressions(report, title, plain_text)
    check_awkward_replacement_phrases(report, title, plain_text)
    check_paragraph_lengths(report, paragraphs)
    check_answer_first(report, paragraphs)
    check_as_of_date(report, plain_text)
    check_checklist(report, html)
    check_value_modules(report, html, plain_text)
    check_template_leftovers(report, plain_text, headings)
    check_fabricated_experience(report, plain_text, has_field_notes)
    check_title_body_consistency(report, title, plain_text)
    check_program_deadlines(report, title, plain_text)
    check_figure_repetition(report, html)
    check_cannibalization(report, title, existing_titles)
    check_table_requirement(report, title, plain_text, table_count)
    check_source_quality(report, html, plain_text)
    check_ai_speak(report, plain_text)
    check_repetition(report, paragraphs)
    check_keyword_density(report, plain_text, args.topic)
    check_policy(report, plain_text)
    check_completeness(report, html)

    # 리포트 출력
    report.print_report()

    # 결과를 JSON으로도 저장 (다음 step에서 활용 가능)
    gate_result = {
        "passed": report.is_passed,
        "total_checks": report.passed + report.failed + report.warnings,
        "passed_count": report.passed,
        "failed_count": report.failed,
        "warning_count": report.warnings,
        "details": [
            {"icon": icon, "name": name, "detail": detail}
            for icon, name, detail in report.checks
        ]
    }

    try:
        with open(args.result_file, "w", encoding="utf-8") as f:
            json.dump(gate_result, f, ensure_ascii=False, indent=2)
    except OSError as e:
        fallback_path = os.path.join(
            os.path.dirname(os.path.abspath(args.content_file)),
            "quality_gate_result.json",
        )
        print(f"⚠️ 결과 파일 저장 경로를 fallback으로 변경: {fallback_path} ({e})")
        with open(fallback_path, "w", encoding="utf-8") as f:
            json.dump(gate_result, f, ensure_ascii=False, indent=2)

    # exit code로 pass/fail 전달
    if not report.is_passed:
        sys.exit(1)


if __name__ == "__main__":
    main()
