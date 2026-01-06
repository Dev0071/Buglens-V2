from __future__ import annotations

import json
import sys
import time
from typing import Any, Dict, List

from tree_sitter import Language, Parser
from tree_sitter_javascript import language as javascript_language
from tree_sitter_typescript import language_typescript, language_tsx

from .base import AnalysisContext, CodeSegment, RuleFunction
from .rules import RULE_FUNCTIONS

SUPPORTED_LANGUAGES = {"javascript", "typescript", "tsx", "jsx"}
ANALYZER_NAME = "js_analyzer"
ANALYZER_VERSION = "1.0.0"


# =============================================================================
# Pure Functions for Analysis (Functional Paradigm)
# =============================================================================


def create_parser(language: str) -> Parser:
    """
    Pure factory function to create appropriate parser for language.
    """
    lang_lower = language.lower()
    if lang_lower in ("tsx", "jsx"):
        return Parser(Language(language_tsx(), name="tsx"))
    elif lang_lower in ("typescript", "ts"):
        return Parser(Language(language_typescript(), name="typescript"))
    return Parser(Language(javascript_language(), name="javascript"))


def parse_code_segment(segment: CodeSegment) -> AnalysisContext:
    """
    Pure function to parse a code segment and create analysis context.
    """
    parser = create_parser(segment.language)
    tree = parser.parse(bytes(segment.content, "utf-8"))
    return AnalysisContext(segment, tree, {})


def extract_segments(payload: Dict[str, Any]) -> List[CodeSegment]:
    """
    Pure function to extract code segments from payload.
    """
    return [
        CodeSegment(
            file_path=segment.get("file_path", "unknown"),
            language=segment.get("language", "text"),
            content=segment.get("content", ""),
            error_line=int(segment.get("error_line", 1)),
            error_column=segment.get("error_column"),
        )
        for segment in payload.get("code_segments", [])
        if segment.get("language", "text").lower() in SUPPORTED_LANGUAGES
    ]


def apply_rules(context: AnalysisContext, rules: List[RuleFunction]) -> List[Dict[str, Any]]:
    """
    Pure function to apply all rules to a context and collect findings.
    """
    findings: List[Dict[str, Any]] = []
    for rule_fn in rules:
        findings.extend(rule_fn(context))
    return findings


def analyze_segment(segment: CodeSegment, rules: List[RuleFunction], metadata: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Pure function to analyze a single code segment.
    """
    parser = create_parser(segment.language)
    tree = parser.parse(bytes(segment.content, "utf-8"))
    context = AnalysisContext(segment, tree, metadata)
    return apply_rules(context, rules)


def analyze(payload: Dict[str, Any], rules: List[RuleFunction] = RULE_FUNCTIONS) -> Dict[str, Any]:
    """
    Pure function to analyze a payload and return results.

    This is the main entry point for functional analysis.
    """
    start_time = time.time()

    segments = extract_segments(payload)
    findings: List[Dict[str, Any]] = []

    for segment in segments:
        findings.extend(analyze_segment(segment, rules, payload))

    runtime_ms = int((time.time() - start_time) * 1000)

    return {
        "analyzer": {
            "name": ANALYZER_NAME,
            "version": ANALYZER_VERSION,
            "runtime_ms": runtime_ms,
        },
        "findings": findings,
        "stats": {
            "frames_analyzed": len(payload.get("frames", [])),
            "code_segments": len(segments),
        },
    }


# =============================================================================
# Backward Compatible Class (OOP wrapper)
# =============================================================================


class JSAnalyzer:
    """
    OOP wrapper for backward compatibility.
    Internally delegates to pure functions.
    """

    def __init__(self) -> None:
        # Keep parser instances for performance (avoid re-creating)
        self._parsers: Dict[str, Parser] = {}

    def _get_parser(self, language: str) -> Parser:
        """Get or create parser for language (cached)."""
        lang_lower = language.lower()
        if lang_lower not in self._parsers:
            self._parsers[lang_lower] = create_parser(lang_lower)
        return self._parsers[lang_lower]

    def analyze(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Delegate to pure function."""
        return analyze(payload, RULE_FUNCTIONS)


def main() -> None:
    try:
        raw_input = sys.stdin.read().strip()
        payload = json.loads(raw_input or "{}")
        analyzer = JSAnalyzer()
        result = analyzer.analyze(payload)
        print(json.dumps(result))
    except Exception as e:
        error_result = {
            "error": str(e),
            "analyzer": {"name": ANALYZER_NAME, "version": ANALYZER_VERSION, "runtime_ms": 0},
            "findings": [],
            "stats": {"frames_analyzed": 0, "code_segments": 0}
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
