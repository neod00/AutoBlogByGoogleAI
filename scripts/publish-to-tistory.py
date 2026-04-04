#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
publish-to-tistory.py
=====================
GitHub Actions에서 실행용.
generate-content.ts의 출력(JSON)을 받아 티스토리에 발행합니다.

Usage:
    python scripts/publish-to-tistory.py \
        --content-file /tmp/blog_output.json \
        --blog-url https://climate-insight.tistory.com \
        --categories "카테고리 없음,ai 신기술 및 이슈,..."
"""

import argparse
import json
import os
import sys

# 프로젝트 루트를 path에 추가
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.execution.tistory_publisher import TistoryPublisher


def main():
    parser = argparse.ArgumentParser(description="Publish blog post to Tistory")
    parser.add_argument("--content-file", required=True, help="Path to JSON content file")
    parser.add_argument("--blog-url", default="https://climate-insight.tistory.com")
    parser.add_argument("--private", action="store_true", help="Publish as private post")
    parser.add_argument("--categories", default="", help="Comma-separated category list")
    args = parser.parse_args()

    # 콘텐츠 파일 읽기
    with open(args.content_file, "r", encoding="utf-8") as f:
        content = json.load(f)

    title = content.get("title", "")
    html = content.get("html", "")
    tags = content.get("tags", [])
    category = content.get("category", "기타")

    if not title or not html:
        print("ERROR: title or html is empty")
        sys.exit(1)

    print(f"Publishing: {title[:50]}...")
    print(f"Category: {category}")
    print(f"Tags: {', '.join(tags[:5])}")
    print(f"HTML length: {len(html)} chars")
    print(f"Private: {args.private}")

    # 카테고리 검증
    if args.categories:
        valid_cats = [c.strip() for c in args.categories.split(",")]
        if category not in valid_cats:
            print(f"WARNING: '{category}' not in valid categories, falling back to '기타'")
            category = "기타"

    # 발행
    publisher = TistoryPublisher(blog_url=args.blog_url)
    result = publisher.publish(
        title=title,
        html_content=html,
        tags=tags,
        category=category,
        is_private=args.private,
    )

    # 결과 저장 (다음 step에서 사용)
    result_file = os.environ.get("GITHUB_OUTPUT", "/tmp/publish_result.txt")
    if "GITHUB_OUTPUT" in os.environ:
        with open(result_file, "a") as f:
            f.write(f"publish_success={result['success']}\n")
            f.write(f"publish_url={result.get('url', '')}\n")
            f.write(f"publish_error={result.get('error', '')}\n")

    # JSON 결과도 저장
    result_json_path = "/tmp/publish_result.json"
    with open(result_json_path, "w", encoding="utf-8") as f:
        json.dump({**result, "title": title, "category": category}, f, ensure_ascii=False, indent=2)

    print(f"\nResult: {json.dumps(result, ensure_ascii=False)}")

    publisher.close()

    if not result["success"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
