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
    "European Commission", "EU", "IEA", "IPCC", "UNFCCC", "OECD",
    "SEC", "EPA", "보도자료", "공시", "annual report", "sustainability report",
]


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


def count_links(html: str) -> int:
    """본문 링크 수 카운트"""
    return len(re.findall(r'<a\s+[^>]*href=', html, re.IGNORECASE))


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


def check_required_structure(report: QualityReport, html: str):
    """기후인사이트 고정 구조 감지"""
    required = [
        "영향받는 대상",
        "중요 시점",
        "가장 먼저 확인할 것",
        "<h2>정리하면</h2>",
        "<h3>이번 주에 할 일</h3>",
        "<h3>이번 달에 할 일</h3>",
        "<h3>올해 안에 할 일</h3>",
        "다음에 검색해볼 키워드",
    ]
    missing = [item for item in required if item not in html]

    if missing:
        report.fail_check("필수 구조", "누락: " + ", ".join(missing[:6]))
    else:
        report.pass_check("필수 구조", "실무 요약/결론 구조 포함")


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
    link_count = count_links(html)
    if link_count == 0:
        report.fail_check("출처 링크", "본문에 링크가 없음")
        return

    has_official_hint = any(hint.lower() in plain_text.lower() for hint in OFFICIAL_SOURCE_HINTS)
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
    
    # 마지막 문장이 마침표/물음표/느낌표로 끝나는지
    plain = strip_html(html).strip()
    ends_properly = plain and plain[-1] in '.!?。'
    
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
    check_paragraph_lengths(report, paragraphs)
    check_required_structure(report, html)
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
