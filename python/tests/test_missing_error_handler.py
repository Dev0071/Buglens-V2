"""
Tests for MISSING_ERROR_HANDLER rule.

This rule detects try blocks that are missing catch handlers.
"""
from __future__ import annotations

from tree_sitter import Language, Parser
from tree_sitter_javascript import language as javascript_language

from analyzers.base import AnalysisContext, CodeSegment
from analyzers.rules.missing_error_handler import evaluate_missing_error_handler, RULE_ID


def create_context(code: str, error_line: int = 1) -> AnalysisContext:
    """Helper to create AnalysisContext from code string."""
    segment = CodeSegment(
        file_path="test.js",
        language="javascript",
        content=code,
        error_line=error_line,
    )
    parser = Parser(Language(javascript_language(), name="javascript"))
    tree = parser.parse(bytes(code, "utf-8"))
    return AnalysisContext(segment, tree, {})


class TestMissingErrorHandlerPositiveCases:
    """Tests where rule SHOULD detect issues."""

    def test_try_without_catch(self):
        """try block without catch should be flagged."""
        code = """
try {
    riskyOperation();
} finally {
    cleanup();
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_missing_error_handler(ctx)

        assert len(findings) >= 1
        assert findings[0]["id"] == RULE_ID

    def test_try_only_finally(self):
        """try with only finally (no catch) should be flagged."""
        code = """
try {
    await db.query('DELETE FROM users');
} finally {
    db.close();
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_missing_error_handler(ctx)

        assert len(findings) >= 1

    def test_nested_try_outer_missing_catch(self):
        """Nested try where outer is missing catch."""
        code = """
try {
    try {
        innerRisky();
    } catch (e) {
        handleInner(e);
    }
} finally {
    cleanup();
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_missing_error_handler(ctx)

        # Outer try should be flagged
        assert len(findings) >= 1


class TestMissingErrorHandlerNegativeCases:
    """Tests where rule should NOT detect issues (false positive prevention)."""

    def test_try_with_catch(self):
        """try block with catch should NOT be flagged."""
        code = """
try {
    riskyOperation();
} catch (error) {
    handleError(error);
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_missing_error_handler(ctx)

        assert len(findings) == 0

    def test_try_with_catch_and_finally(self):
        """try with both catch and finally should NOT be flagged."""
        code = """
try {
    riskyOperation();
} catch (error) {
    handleError(error);
} finally {
    cleanup();
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_missing_error_handler(ctx)

        assert len(findings) == 0

    def test_try_with_empty_catch(self):
        """try with empty catch (swallowing) should NOT be flagged by this rule."""
        code = """
try {
    riskyOperation();
} catch (e) {
    // Intentionally swallowed
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_missing_error_handler(ctx)

        # This rule only checks for MISSING catch, not empty catch
        assert len(findings) == 0


class TestMissingErrorHandlerEdgeCases:
    """Edge cases and boundary conditions."""

    def test_far_from_error_line(self):
        """try block far from error line should NOT be flagged."""
        code = """
const x = 1;
const y = 2;
const z = 3;
const a = 4;
const b = 5;
const c = 6;
const d = 7;
const e = 8;
try {
    risky();
} finally {
    cleanup();
}
"""
        # Error on line 1, try starts on line 9 (>7 lines away)
        ctx = create_context(code, error_line=1)
        findings = evaluate_missing_error_handler(ctx)

        assert len(findings) == 0

    def test_limits_findings_to_one(self):
        """Rule should limit to max 1 finding (per the implementation)."""
        code = """
try {
    risky1();
} finally {
    cleanup1();
}
try {
    risky2();
} finally {
    cleanup2();
}
"""
        ctx = create_context(code, error_line=5)
        findings = evaluate_missing_error_handler(ctx)

        # Should cap at 1 (as per rule implementation)
        assert len(findings) <= 1

    def test_empty_code(self):
        """Empty code should not crash."""
        code = ""
        ctx = create_context(code)
        findings = evaluate_missing_error_handler(ctx)

        assert findings == []

    def test_no_try_blocks(self):
        """Code without try blocks should return empty."""
        code = """
function doSomething() {
    return compute(1, 2);
}
"""
        ctx = create_context(code)
        findings = evaluate_missing_error_handler(ctx)

        assert findings == []


class TestMissingErrorHandlerFindingStructure:
    """Tests for the structure of findings."""

    def test_finding_has_required_fields(self):
        """Finding should have all required fields."""
        code = """
try {
    risky();
} finally {
    cleanup();
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_missing_error_handler(ctx)

        assert len(findings) >= 1
        finding = findings[0]

        # Required fields
        assert "id" in finding
        assert "title" in finding
        assert "severity" in finding
        assert "confidence" in finding
        assert "message" in finding
        assert "evidence" in finding

    def test_confidence_is_reasonable(self):
        """Confidence should be between 0 and 1."""
        code = """
try {
    risky();
} finally {
    cleanup();
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_missing_error_handler(ctx)

        for finding in findings:
            assert 0.0 <= finding["confidence"] <= 1.0

    def test_severity_is_medium(self):
        """MISSING_ERROR_HANDLER should have medium severity."""
        code = """
try {
    risky();
} finally {
    cleanup();
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_missing_error_handler(ctx)

        assert len(findings) >= 1
        assert findings[0]["severity"] == "medium"
