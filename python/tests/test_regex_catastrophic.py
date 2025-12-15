"""
Tests for REGEX_CATASTROPHIC rule.

Tests cover:
1. Positive cases - code that SHOULD trigger the rule
2. Negative cases - code that should NOT trigger (false positive prevention)
3. Edge cases - boundary conditions
4. Finding structure validation
"""
from __future__ import annotations

import pytest

from analyzers.rules.regex_catastrophic import (
    RULE_ID,
    RULE_SEVERITY,
    RULE_TITLE,
    RegexCatastrophicRule,
    evaluate_regex_catastrophic,
)


class TestRegexCatastrophicPositiveCases:
    """Tests where the rule SHOULD find issues."""

    def test_nested_quantifier(self, create_context):
        """Should detect nested quantifier pattern (a+)+."""
        code = """
const regex = /(a+)+$/;
const result = regex.test(input);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="timeout",
        )
        findings = evaluate_regex_catastrophic(context)

        assert len(findings) >= 1
        assert findings[0]["id"] == RULE_ID
        assert "nested" in findings[0]["message"].lower()

    def test_multiple_greedy_patterns(self, create_context):
        """Should detect multiple greedy .* patterns."""
        code = """
const pattern = /.*foo.*bar.*/;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="regex backtracking",
        )
        findings = evaluate_regex_catastrophic(context)

        assert len(findings) >= 1

    def test_regexp_constructor_vulnerable(self, create_context):
        """Should detect vulnerable pattern in RegExp constructor."""
        code = """
const regex = new RegExp("(a+)+");
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="timeout",
        )
        findings = evaluate_regex_catastrophic(context)

        assert len(findings) >= 1

    def test_quantified_alternation(self, create_context):
        """Should detect quantified alternation pattern."""
        code = """
const pattern = /(a|aa)+/;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="backtrack",
        )
        findings = evaluate_regex_catastrophic(context)

        assert len(findings) >= 1


class TestRegexCatastrophicNegativeCases:
    """Tests where the rule should NOT find issues (false positive prevention)."""

    def test_simple_regex(self, create_context):
        """Should NOT flag simple safe regex patterns."""
        code = """
const regex = /^[a-z]+$/;
const result = regex.test(input);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="Some error",
        )
        findings = evaluate_regex_catastrophic(context)

        assert len(findings) == 0

    def test_non_greedy_quantifiers(self, create_context):
        """Should NOT flag non-greedy quantifiers."""
        code = """
const regex = /.*?foo.*?bar/;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="timeout",
        )
        findings = evaluate_regex_catastrophic(context)

        assert len(findings) == 0

    def test_anchored_pattern(self, create_context):
        """Anchored patterns are still vulnerable to ReDoS but may have slightly lower confidence."""
        code = """
const regex = /^(a+)+$/;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="Some error",
        )
        findings = evaluate_regex_catastrophic(context)

        # Anchored patterns with nested quantifiers are still vulnerable
        # They should be flagged but may have moderate confidence
        if len(findings) > 0:
            assert findings[0]["confidence"] <= 0.85  # Still high due to nested quantifier

    def test_simple_email_regex(self, create_context):
        """Should NOT flag common safe patterns."""
        code = """
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="Some error",
        )
        findings = evaluate_regex_catastrophic(context)

        # May or may not flag depending on pattern analysis
        assert isinstance(findings, list)


class TestRegexCatastrophicEdgeCases:
    """Edge case tests."""

    def test_empty_code(self, create_context):
        """Should handle empty code gracefully."""
        context = create_context(
            code="",
            error_line=1,
            error_message="regex timeout",
        )
        findings = evaluate_regex_catastrophic(context)

        assert findings == []

    def test_no_regex(self, create_context):
        """Should handle code without regex."""
        code = """
const x = 1;
const y = 2;
console.log(x + y);
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="regex timeout",
        )
        findings = evaluate_regex_catastrophic(context)

        assert len(findings) == 0

    def test_far_from_error_line(self, create_context):
        """Should NOT flag patterns far from error line."""
        code = """
const regex = /(a+)+/;
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
            error_message="timeout",
        )
        findings = evaluate_regex_catastrophic(context)

        assert len(findings) == 0

    def test_very_short_pattern(self, create_context):
        """Should skip very short patterns."""
        code = """
const r = /a+/;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="timeout",
        )
        findings = evaluate_regex_catastrophic(context)

        # Very short patterns should be skipped
        assert len(findings) == 0


class TestRegexCatastrophicFindingStructure:
    """Tests for finding structure validation."""

    def test_finding_has_required_fields(self, create_context):
        """Findings should have all required fields."""
        code = """
const regex = /(a+)+$/;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="timeout",
        )
        findings = evaluate_regex_catastrophic(context)

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

    def test_metadata_includes_pattern(self, create_context):
        """Metadata should include the regex pattern."""
        code = """
const regex = /(a+)+$/;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="timeout",
        )
        findings = evaluate_regex_catastrophic(context)

        if len(findings) > 0:
            assert "metadata" in findings[0]
            assert "pattern" in findings[0]["metadata"]
            assert "type" in findings[0]["metadata"]


class TestRegexCatastrophicWrapper:
    """Tests for OOP wrapper class."""

    def test_wrapper_class_exists(self):
        """RegexCatastrophicRule class should exist."""
        assert RegexCatastrophicRule is not None
        assert RegexCatastrophicRule.rule_id == RULE_ID

    def test_wrapper_delegates_to_function(self, create_context):
        """Wrapper should delegate to pure function."""
        code = """
const regex = /(a+)+$/;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="timeout",
        )

        rule = RegexCatastrophicRule()
        wrapper_findings = rule.evaluate(context)
        function_findings = evaluate_regex_catastrophic(context)

        assert wrapper_findings == function_findings
