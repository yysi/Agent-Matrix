#!/usr/bin/env python3
"""Hacker News Daily — 每日热门文章 Markdown 报告生成器"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import requests

# ── 配置 ──────────────────────────────────────────────────────────────
ALGOLIA_URL = "https://hn.algolia.com/api/v1/search"
CACHE_DIR = Path.home() / ".cache" / "hn_daily"
CACHE_FILE = CACHE_DIR / "topstories_cache.json"
DEFAULT_CACHE_TTL = 3600  # 1 hour
DEFAULT_LIMIT = 30
REQUEST_TIMEOUT = 15
MAX_RETRIES = 3
BACKOFF_BASE = 1.5  # exponential backoff multiplier

logger = logging.getLogger("hn_daily")


# ── 工具函数 ──────────────────────────────────────────────────────────

def _setup_logging(verbose: bool) -> None:
    """配置日志输出到 stderr"""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )


def _fetch_with_retry(url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """带指数退避重试的 HTTP GET 请求"""
    last_exc: Exception | None = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            logger.debug("GET %s  params=%s  (attempt %d/%d)", url, params, attempt, MAX_RETRIES)
            resp = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
            resp.raise_for_status()
            body: dict[str, Any] = resp.json()
            if not isinstance(body, dict):
                raise ValueError(f"Expected JSON object, got {type(body).__name__}")
            return body
        except requests.Timeout as exc:
            last_exc = exc
            logger.warning("Timeout (attempt %d/%d): %s", attempt, MAX_RETRIES, url)
        except requests.ConnectionError as exc:
            last_exc = exc
            logger.warning("ConnectionError (attempt %d/%d): %s", attempt, MAX_RETRIES, url)
        except requests.HTTPError as exc:
            status = exc.response.status_code if exc.response is not None else "?"
            if 500 <= status:  # type: ignore[operator]
                logger.warning("HTTP %s (attempt %d/%d) — retryable", status, attempt, MAX_RETRIES)
                last_exc = exc
            else:
                raise  # 4xx — 不可重试
        except (json.JSONDecodeError, ValueError) as exc:
            # 不可重试 — 响应格式错误
            logger.error("Invalid API response (not retryable): %s", exc)
            raise

        if attempt < MAX_RETRIES:
            delay = BACKOFF_BASE ** attempt
            logger.info("Retrying in %.1fs …", delay)
            time.sleep(delay)

    # 所有重试均耗尽
    raise RuntimeError(f"All {MAX_RETRIES} retries exhausted") from last_exc


def _load_cache(ttl: int) -> list[dict[str, Any]] | None:
    """读取缓存（未过期则返回数据，否则 None）"""
    if not CACHE_FILE.exists():
        return None
    try:
        blob = json.loads(CACHE_FILE.read_text())
        cached_at = blob.get("cached_at", 0)
        if time.time() - cached_at > ttl:
            logger.info("Cache expired")
            return None
        logger.info("Using cached data (age %.0fs)", time.time() - cached_at)
        return blob.get("articles")
    except (json.JSONDecodeError, KeyError, OSError) as exc:
        logger.warning("Cache read error: %s", exc)
        return None


def _save_cache(articles: list[dict[str, Any]]) -> None:
    """写入缓存（静默失败）"""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(
            json.dumps({"cached_at": time.time(), "articles": articles}, ensure_ascii=False)
        )
        logger.debug("Cache written to %s", CACHE_FILE)
    except OSError as exc:
        logger.warning("Failed to write cache: %s", exc)


def _atomic_write(path: Path, content: str) -> None:
    """原子写入：先写临时文件再 rename，防止中断导致空文件"""
    tmp = path.with_name(f".{path.name}.tmp.{os.getpid()}")
    try:
        tmp.write_text(content, encoding="utf-8")
        tmp.rename(path)
        logger.info("Report written to %s", path)
    finally:
        # 清理残留的临时文件
        if tmp.exists():
            tmp.unlink(missing_ok=True)


# ── 核心抓取逻辑 ──────────────────────────────────────────────────────

def fetch_articles(limit: int, no_cache: bool) -> list[dict[str, Any]]:
    """获取 Hacker News 热门文章列表"""
    if not no_cache:
        cached = _load_cache(DEFAULT_CACHE_TTL)
        if cached is not None:
            return cached[:limit]

    logger.info("Fetching top %d articles from Algolia …", limit)
    params: dict[str, Any] = {
        "tags": "front_page",
        "hitsPerPage": min(limit, 1000),  # Algolia 限制 max 1000
        "attributesToHighlight": "none",
    }
    data = _fetch_with_retry(ALGOLIA_URL, params)
    hits: list[dict[str, Any]] = data.get("hits", [])

    if not hits:
        logger.warning("API returned empty hits array — HN front page may be empty")

    # 归一化字段名
    articles: list[dict[str, Any]] = []
    errors = 0
    for hit in hits:
        try:
            articles.append({
                "title": hit.get("title") or "(no title)",
                "url": hit.get("url") or "",
                "score": int(hit.get("points") or 0),
                "comments": int(hit.get("num_comments") or 0),
                "created_at": hit.get("created_at") or "",
                "object_id": hit.get("objectID") or "",
            })
        except (ValueError, TypeError) as exc:
            logger.warning("Skipping malformed item: %s", exc)
            errors += 1

    if errors and not articles:
        logger.error("All %d items failed to parse — aborting", errors)
        sys.exit(2)

    if errors:
        logger.warning("%d item(s) skipped due to parse errors", errors)

    _save_cache(articles)
    return articles


def sort_and_truncate(articles: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """按分数降序排列并截断"""
    articles.sort(key=lambda a: a["score"], reverse=True)
    return articles[:limit]


# ── Markdown 报告生成 ────────────────────────────────────────────────

def generate_report(articles: list[dict[str, Any]]) -> str:
    """生成 Markdown 格式的报告"""
    if not articles:
        return _empty_report()

    total = len(articles)
    max_score = articles[0]["score"]
    avg_score = round(sum(a["score"] for a in articles) / total)

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    lines: list[str] = []
    lines.append(f"# Hacker News 每日热门 — {today}")
    lines.append("")
    lines.append(f"**统计摘要** | 共 {total} 篇文章 | 最高分 {max_score} | 平均分 {avg_score}")
    lines.append("")
    lines.append("| # | 标题 | 分数 | 评论 | 链接 |")
    lines.append("|---|------|------|------|------|")

    for i, a in enumerate(articles, 1):
        title = a["title"].replace("|", "\\|")
        score = a["score"]
        comments = a["comments"]
        url = a["url"].strip()
        if url:
            link = f"[link]({url})"
        else:
            link = "(HN discussion)"

        lines.append(f"| {i} | {title} | {score} | {comments} | {link} |")

    lines.append("")
    lines.append("---")
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines.append(f"*报告生成时间: {generated_at}*")

    return "\n".join(lines) + "\n"


def _empty_report() -> str:
    """生成空报告（无数据时的降级输出）"""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return (
        f"# Hacker News 每日热门 — {today}\n\n"
        f"⚠️ **未能获取到数据** — API 返回为空或完全失败\n\n"
        f"---\n*报告生成时间: {generated_at}*\n"
    )


# ── CLI 入口 ──────────────────────────────────────────────────────────

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="生成 Hacker News 每日热门文章 Markdown 报告",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "示例:\n"
            "  python hn_daily.py                              # 默认 Top 30\n"
            "  python hn_daily.py --limit 10                   # 只看 Top 10\n"
            "  python hn_daily.py --output ~/Desktop/hn.md     # 指定输出路径\n"
            "  python hn_daily.py --no-cache                   # 强制从 API 拉取\n"
            "  python hn_daily.py --verbose                     # 调试日志\n"
        ),
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        default="hn_daily_report.md",
        help="输出 Markdown 文件路径 (default: hn_daily_report.md)",
    )
    parser.add_argument(
        "--limit", "-l",
        type=int,
        default=DEFAULT_LIMIT,
        help=f"文章数量 (default: {DEFAULT_LIMIT})",
    )
    parser.add_argument(
        "--no-cache",
        action="store_true",
        help="忽略缓存，强制从 API 拉取",
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="输出调试日志",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    _setup_logging(args.verbose)

    limit = max(1, min(args.limit, 1000))

    try:
        articles = fetch_articles(limit, args.no_cache)
    except RuntimeError as exc:
        logger.error("Fetch failed after retries: %s", exc)
        # 优雅降级: 输出空报告, exit code 1
        report = _empty_report()
        _atomic_write(Path(args.output), report)
        return 1
    except Exception as exc:
        logger.critical("Unexpected error: %s", exc, exc_info=True)
        report = _empty_report()
        _atomic_write(Path(args.output), report)
        return 2

    sorted_articles = sort_and_truncate(articles, limit)
    report = generate_report(sorted_articles)
    _atomic_write(Path(args.output), report)

    total = len(sorted_articles)
    max_score = sorted_articles[0]["score"] if sorted_articles else 0
    logger.info("Done — %d articles, highest score %d → %s", total, max_score, args.output)
    return 0


if __name__ == "__main__":
    sys.exit(main())
