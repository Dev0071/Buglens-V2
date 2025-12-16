"""
Pytest configuration and shared fixtures for analyzer tests.
"""
from __future__ import annotations

from typing import Callable

import pytest
from tree_sitter import Language, Parser
from tree_sitter_javascript import language as javascript_language
from tree_sitter_typescript import language_typescript, language_tsx

from analyzers.base import AnalysisContext, CodeSegment


@pytest.fixture
def js_parser():
    """Create a JavaScript parser."""
    return Parser(Language(javascript_language()))


@pytest.fixture
def ts_parser():
    """Create a TypeScript parser."""
    return Parser(Language(language_typescript()))


@pytest.fixture
def tsx_parser():
    """Create a TSX parser."""
    return Parser(Language(language_tsx()))


def create_js_context(code: str, error_line: int = 1, error_message: str = "") -> AnalysisContext:
    """Helper to create AnalysisContext from JavaScript code string."""
    segment = CodeSegment(
        file_path="test.js",
        language="javascript",
        content=code,
        error_line=error_line,
    )
    parser = Parser(Language(javascript_language()))
    tree = parser.parse(bytes(code, "utf-8"))
    return AnalysisContext(segment, tree, {"error_message": error_message})


def create_ts_context(code: str, error_line: int = 1, error_message: str = "") -> AnalysisContext:
    """Helper to create AnalysisContext from TypeScript code string."""
    segment = CodeSegment(
        file_path="test.ts",
        language="typescript",
        content=code,
        error_line=error_line,
    )
    parser = Parser(Language(language_typescript()))
    tree = parser.parse(bytes(code, "utf-8"))
    return AnalysisContext(segment, tree, {"error_message": error_message})


@pytest.fixture
def create_context() -> Callable[..., AnalysisContext]:
    """
    Fixture that returns a context factory function.

    Usage:
        def test_something(create_context):
            context = create_context(code="const x = 1;", error_line=1, error_message="error")
            ...
    """
    def _create_context(
        code: str,
        error_line: int = 1,
        error_message: str = "",
        language: str = "javascript"
    ) -> AnalysisContext:
        segment = CodeSegment(
            file_path=f"test.{language[:2]}",
            language=language,
            content=code,
            error_line=error_line,
        )
        if language == "typescript":
            parser = Parser(Language(language_typescript()))
        elif language == "tsx":
            parser = Parser(Language(language_tsx()))
        else:
            parser = Parser(Language(javascript_language()))
        tree = parser.parse(bytes(code, "utf-8"))
        return AnalysisContext(segment, tree, {"error_message": error_message})

    return _create_context
