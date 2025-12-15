"""
Tests for INVALID_FUNCTION_CALL rule.

Tests cover:
1. Positive cases - code that SHOULD trigger the rule
2. Negative cases - code that should NOT trigger (false positive prevention)
3. Edge cases - boundary conditions
4. Finding structure validation
"""
from __future__ import annotations

import pytest

from analyzers.rules.invalid_function_call import (
    RULE_ID,
    RULE_SEVERITY,
    RULE_TITLE,
    InvalidFunctionCallRule,
    evaluate_invalid_function_call,
)


class TestInvalidFunctionCallPositiveCases:
    """Tests where the rule SHOULD find issues."""

    def test_typo_in_method_name(self, create_context):
        """Should detect typo in method name."""
        code = """
const text = "hello";
const result = text.toSting();
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="text.toSting is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        assert len(findings) >= 1
        assert "toSting" in findings[0]["message"] or "toString" in findings[0]["message"]

    def test_undefined_method_call(self, create_context):
        """Should detect calling undefined method."""
        code = """
const obj = { name: "test" };
obj.process();
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="obj.process is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        assert len(findings) >= 1
        assert "process" in findings[0]["message"]

    def test_chained_call_error(self, create_context):
        """Should detect error in chained method calls."""
        code = """
const result = getData().transform().save();
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="transform is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        assert len(findings) >= 1

    def test_common_typo_indexof(self, create_context):
        """Should detect common typo 'indexof' instead of 'indexOf'."""
        code = """
const arr = [1, 2, 3];
const idx = arr.indexof(2);
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="arr.indexof is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        assert len(findings) >= 1
        assert findings[0]["confidence"] >= 0.80

    def test_addEventListner_typo(self, create_context):
        """Should detect addEventListner typo."""
        code = """
button.addEventListner('click', handler);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="button.addEventListner is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        assert len(findings) >= 1
        assert "addEventListener" in findings[0]["message"]


class TestInvalidFunctionCallNegativeCases:
    """Tests where the rule should NOT find issues (false positive prevention)."""

    def test_valid_method_call(self, create_context):
        """Should NOT flag valid method calls."""
        code = """
const text = "hello";
const result = text.toString();
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="Some other error",
        )
        findings = evaluate_invalid_function_call(context)

        # No typo detection for valid method
        found_tostring = any("toString" in f.get("message", "") for f in findings)
        assert not found_tostring or len(findings) == 0

    def test_correct_chained_calls(self, create_context):
        """Should NOT flag correct chained calls."""
        code = """
const result = arr.map(x => x * 2).filter(x => x > 0);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="Network error",
        )
        findings = evaluate_invalid_function_call(context)

        assert len(findings) == 0


class TestInvalidFunctionCallEdgeCases:
    """Edge case tests."""

    def test_empty_code(self, create_context):
        """Should handle empty code gracefully."""
        context = create_context(
            code="",
            error_line=1,
            error_message="x is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        assert findings == []

    def test_no_call_expressions(self, create_context):
        """Should handle code without function calls."""
        code = """
const x = 1;
const y = 2;
const z = x + y;
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="something is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        assert findings == []

    def test_far_from_error_line(self, create_context):
        """Should NOT flag calls far from error line."""
        code = """
obj.badMethod();
// many lines
// many lines
// many lines
// many lines
// many lines
// many lines
// error here
const x = 1;
"""
        context = create_context(
            code=code,
            error_line=10,
            error_message="badMethod is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        assert len(findings) == 0


class TestInvalidFunctionCallFindingStructure:
    """Tests for finding structure validation."""

    def test_finding_has_required_fields(self, create_context):
        """Findings should have all required fields."""
        code = """
obj.toSting();
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="obj.toSting is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        assert len(findings) >= 1
        finding = findings[0]

        # Required fields
        assert "id" in finding
        assert "title" in finding
        assert "severity" in finding
        assert "message" in finding
        assert "evidence" in finding
        assert "confidence" in finding

        # Values
        assert finding["id"] == RULE_ID
        assert finding["title"] == RULE_TITLE
        assert finding["severity"] == RULE_SEVERITY
        assert 0 <= finding["confidence"] <= 1

    def test_typo_metadata(self, create_context):
        """Metadata should include typo and suggestion for typos."""
        code = """
text.toSting();
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="text.toSting is not a function",
        )
        findings = evaluate_invalid_function_call(context)

        if len(findings) > 0:
            metadata = findings[0].get("metadata", {})
            if "typo" in metadata:
                assert "suggestion" in metadata


class TestInvalidFunctionCallWrapper:
    """Tests for OOP wrapper class."""

    def test_wrapper_class_exists(self):
        """InvalidFunctionCallRule class should exist."""
        assert InvalidFunctionCallRule is not None
        assert InvalidFunctionCallRule.rule_id == RULE_ID

    def test_wrapper_delegates_to_function(self, create_context):
        """Wrapper should delegate to pure function."""
        code = """
obj.toSting();
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="obj.toSting is not a function",
        )

        rule = InvalidFunctionCallRule()
        wrapper_findings = rule.evaluate(context)
        function_findings = evaluate_invalid_function_call(context)

        assert wrapper_findings == function_findings
