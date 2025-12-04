from __future__ import annotations

import json
import sys
import time
from typing import Any, Dict, List

from tree_sitter import Language, Parser
from tree_sitter_javascript import language as javascript_language
from tree_sitter_typescript import language_typescript, language_tsx

from .base import AnalysisContext, CodeSegment
from .rules import (
    MissingErrorHandlerRule,
    NullAccessRule,
    UnawaitedPromiseRule,
)

SUPPORTED_LANGUAGES = {"javascript", "typescript", "tsx", "jsx"}
ANALYZER_NAME = "js_analyzer"
ANALYZER_VERSION = "1.0.0"


class JSAnalyzer:
    def __init__(self) -> None:
        # Wrap raw language pointers in Language objects
        js_lang = Language(javascript_language())
        ts_lang = Language(language_typescript())
        tsx_lang = Language(language_tsx())

        self.js_parser = Parser(js_lang)
        self.ts_parser = Parser(ts_lang)
        self.tsx_parser = Parser(tsx_lang)
        self.rules = [
            NullAccessRule(),
            UnawaitedPromiseRule(),
            MissingErrorHandlerRule(),
        ]

    def _get_parser(self, language: str) -> Parser:
        """Get the appropriate parser for the language."""
        lang_lower = language.lower()
        if lang_lower in ("tsx", "jsx"):
            return self.tsx_parser
        elif lang_lower in ("typescript", "ts"):
            return self.ts_parser
        return self.js_parser

    def analyze(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        start_time = time.time()
        segments = [
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

        findings: List[Dict[str, Any]] = []

        for segment in segments:
            parser = self._get_parser(segment.language)
            tree = parser.parse(bytes(segment.content, "utf-8"))
            context = AnalysisContext(segment, tree, payload)
            for rule in self.rules:
                findings.extend(rule.evaluate(context))

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
