"""
Tests for UNDEFINED_VARIABLE rule.

Tests cover:
1. Positive cases - code that SHOULD trigger the rule
2. Negative cases - code that should NOT trigger (false positive prevention)
3. Edge cases - boundary conditions
4. Finding structure validation
"""
from __future__ import annotations

import pytest

from analyzers.rules.undefined_variable import (
    RULE_ID,
    RULE_SEVERITY,
    RULE_TITLE,
    UndefinedVariableRule,
    evaluate_undefined_variable,
)


class TestUndefinedVariablePositiveCases:
    """Tests where the rule SHOULD find issues."""

    def test_undefined_variable_reference(self, create_context):
        """Should detect reference to undefined variable."""
        code = """
function getData() {
    return unknownVar.value;
}
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="unknownVar is not defined",
        )
        findings = evaluate_undefined_variable(context)

        assert len(findings) >= 1
        assert findings[0]["id"] == RULE_ID
        assert "unknownVar" in findings[0]["message"]

    def test_typo_in_variable_name(self, create_context):
        """Should detect typo in variable name."""
        code = """
const userData = fetchUser();
console.log(userdata.name);
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="userdata is not defined",
        )
        findings = evaluate_undefined_variable(context)

        assert len(findings) >= 1
        assert "userdata" in findings[0]["message"]

    def test_missing_import(self, create_context):
        """Should detect use of non-imported module."""
        code = """
const result = axios.get('/api/data');
console.log(result);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="axios is not defined",
        )
        findings = evaluate_undefined_variable(context)

        assert len(findings) >= 1
        assert findings[0]["confidence"] >= 0.70

    def test_scope_issue(self, create_context):
        """Should detect variable used outside its scope."""
        code = """
if (condition) {
    const temp = getValue();
}
console.log(temp);
"""
        context = create_context(
            code=code,
            error_line=5,
            error_message="temp is not defined",
        )
        findings = evaluate_undefined_variable(context)

        assert len(findings) >= 1


class TestUndefinedVariableNegativeCases:
    """Tests where the rule should NOT find issues (false positive prevention)."""

    def test_declared_variable(self, create_context):
        """Should NOT flag properly declared variables."""
        code = """
const userData = fetchUser();
console.log(userData.name);
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property 'name' of undefined",
        )
        findings = evaluate_undefined_variable(context)

        # userData is declared, so shouldn't flag it as undefined
        found_userdata = any("userData" in f.get("message", "") for f in findings)
        assert not found_userdata

    def test_global_console(self, create_context):
        """Should NOT flag global objects like console."""
        code = """
console.log("Hello");
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="Some error",
        )
        findings = evaluate_undefined_variable(context)

        found_console = any("console" in f.get("message", "") for f in findings)
        assert not found_console

    def test_function_parameter(self, create_context):
        """Should NOT flag function parameters."""
        code = """
function process(data) {
    return data.value;
}
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property 'value' of undefined",
        )
        findings = evaluate_undefined_variable(context)

        found_data = any("data" in f.get("message", "") for f in findings)
        assert not found_data

    def test_common_globals(self, create_context):
        """Should NOT flag common globals like Promise, Array, etc."""
        code = """
const promise = new Promise((resolve) => resolve(1));
const arr = new Array(10);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="Some error",
        )
        findings = evaluate_undefined_variable(context)

        assert len(findings) == 0


class TestUndefinedVariableEdgeCases:
    """Edge case tests."""

    def test_empty_code(self, create_context):
        """Should handle empty code gracefully."""
        context = create_context(
            code="",
            error_line=1,
            error_message="x is not defined",
        )
        findings = evaluate_undefined_variable(context)

        assert findings == []

    def test_far_from_error_line(self, create_context):
        """Should NOT flag variables far from error line."""
        code = """
undefinedVar;
// many lines
// many lines
// many lines
// many lines
// many lines
// error is here
const x = 1;
"""
        context = create_context(
            code=code,
            error_line=9,
            error_message="undefinedVar is not defined",
        )
        findings = evaluate_undefined_variable(context)

        # Line 2 is far from error line 9
        assert len(findings) == 0

    def test_max_findings_limit(self, create_context):
        """Should limit findings to prevent noise."""
        code = """
const a = unknownA;
const b = unknownB;
const c = unknownC;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="unknownA is not defined",
        )
        findings = evaluate_undefined_variable(context)

        assert len(findings) <= 2


class TestUndefinedVariableFindingStructure:
    """Tests for finding structure validation."""

    def test_finding_has_required_fields(self, create_context):
        """Findings should have all required fields."""
        code = """
const x = unknownVar;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="unknownVar is not defined",
        )
        findings = evaluate_undefined_variable(context)

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

    def test_metadata_includes_variable(self, create_context):
        """Metadata should include variable information."""
        code = """
console.log(missingVar);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="missingVar is not defined",
        )
        findings = evaluate_undefined_variable(context)

        if len(findings) > 0:
            assert "metadata" in findings[0]
            assert "variable" in findings[0]["metadata"]


class TestUndefinedVariableWrapper:
    """Tests for OOP wrapper class."""

    def test_wrapper_class_exists(self):
        """UndefinedVariableRule class should exist."""
        assert UndefinedVariableRule is not None
        assert UndefinedVariableRule.rule_id == RULE_ID

    def test_wrapper_delegates_to_function(self, create_context):
        """Wrapper should delegate to pure function."""
        code = """
const x = unknownVar;
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="unknownVar is not defined",
        )

        rule = UndefinedVariableRule()
        wrapper_findings = rule.evaluate(context)
        function_findings = evaluate_undefined_variable(context)

        assert wrapper_findings == function_findings
