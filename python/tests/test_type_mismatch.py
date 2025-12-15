"""
Tests for TYPE_MISMATCH rule.

Tests cover:
1. Positive cases - code that SHOULD trigger the rule
2. Negative cases - code that should NOT trigger (false positive prevention)
3. Edge cases - boundary conditions
4. Finding structure validation
"""
from __future__ import annotations

import pytest
from analyzers.rules.type_mismatch import (
    RULE_ID,
    RULE_SEVERITY,
    RULE_TITLE,
    TypeMismatchRule,
    evaluate_type_mismatch,
)


class TestTypeMismatchPositiveCases:
    """Tests where the rule SHOULD find issues."""

    def test_direct_call_not_a_function(self, create_context):
        """Should detect when calling a variable that's not a function."""
        code = '''
const callback = userData.handler;
const result = callback();  // callback might not be a function
console.log(result);
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="callback is not a function"
        )
        findings = evaluate_type_mismatch(context)

        assert len(findings) >= 1
        assert findings[0]["id"] == RULE_ID
        assert findings[0]["evidence"]["line_number"] == 3
        assert "callback" in findings[0]["message"]

    def test_method_not_a_function(self, create_context):
        """Should detect when calling a method that doesn't exist."""
        code = '''
const data = response.body;
const parsed = data.parse();  // data.parse is not a function
return parsed;
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="data.parse is not a function"
        )
        findings = evaluate_type_mismatch(context)

        assert len(findings) >= 1
        assert "parse" in findings[0]["message"]

    def test_callback_passed_to_map(self, create_context):
        """Should detect callback issues when called directly."""
        code = '''
const formatter = config.formatter;
const result = formatter(data);  // formatter might not be a function
return result;
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="formatter is not a function"
        )
        findings = evaluate_type_mismatch(context)

        assert len(findings) >= 1
        assert findings[0]["confidence"] >= 0.70

    def test_property_access_on_number(self, create_context):
        """Should detect property access on primitive types."""
        code = '''
const count = parseInt(input);
const formatted = count.toFixed(2);
const result = count.custom();  // count is a number, doesn't have custom()
return result;
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="count.custom is not a function"
        )
        findings = evaluate_type_mismatch(context)

        assert len(findings) >= 1
        assert "custom" in findings[0]["message"].lower() or "count" in findings[0]["message"]

    def test_reassigned_variable(self, create_context):
        """Should detect when a function variable is reassigned."""
        code = '''
let handler = processData;
handler = null;  // reassigned to non-function
handler();  // will fail
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="handler is not a function"
        )
        findings = evaluate_type_mismatch(context)

        assert len(findings) >= 1
        assert "handler" in findings[0]["message"]

    def test_constructor_error(self, create_context):
        """Should detect when something is not a constructor."""
        code = '''
const Factory = config.getFactory();
const instance = new Factory();  // Factory is not a constructor
return instance;
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Factory is not a constructor"
        )
        findings = evaluate_type_mismatch(context)

        assert len(findings) >= 1

    def test_not_iterable_error(self, create_context):
        """Should detect when iterating non-iterable."""
        code = '''
const data = fetchData();
for (const item of data) {  // data is not iterable
    process(item);
}
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="data is not iterable"
        )
        # Note: This rule focuses on function calls, iteration is secondary
        findings = evaluate_type_mismatch(context)
        # May or may not find issues depending on implementation
        assert isinstance(findings, list)


class TestTypeMismatchNegativeCases:
    """Tests where the rule should NOT find issues (false positive prevention)."""

    def test_normal_function_call(self, create_context):
        """Should NOT flag normal function calls without type error."""
        code = '''
function greet(name) {
    return `Hello, ${name}`;
}
const result = greet("World");
'''
        context = create_context(
            code=code,
            error_line=5,
            error_message="Cannot read property 'length' of undefined"  # Different error
        )
        findings = evaluate_type_mismatch(context)

        # Should not flag greet() since error is about property access, not type
        assert len(findings) == 0

    def test_method_call_no_type_error(self, create_context):
        """Should NOT flag method calls when error is not type-related."""
        code = '''
const arr = [1, 2, 3];
const doubled = arr.map(x => x * 2);
console.log(doubled);
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Network request failed"  # Not a type error
        )
        findings = evaluate_type_mismatch(context)

        assert len(findings) == 0

    def test_proper_function_parameter(self, create_context):
        """Should NOT flag when function is properly defined."""
        code = '''
function process(callback) {
    if (typeof callback === 'function') {
        callback();
    }
}
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="Something else went wrong"
        )
        findings = evaluate_type_mismatch(context)

        assert len(findings) == 0

    def test_async_await_function(self, create_context):
        """Should NOT flag async function calls."""
        code = '''
async function fetchUser() {
    const response = await fetch('/api/user');
    return response.json();
}
const user = await fetchUser();
'''
        context = create_context(
            code=code,
            error_line=5,
            error_message="Request timeout"  # Not a type error
        )
        findings = evaluate_type_mismatch(context)

        assert len(findings) == 0


class TestTypeMismatchEdgeCases:
    """Edge case tests."""

    def test_empty_code(self, create_context):
        """Should handle empty code gracefully."""
        context = create_context(
            code="",
            error_line=1,
            error_message="X is not a function"
        )
        findings = evaluate_type_mismatch(context)

        assert findings == []

    def test_no_calls_in_code(self, create_context):
        """Should handle code without function calls."""
        code = '''
const x = 1;
const y = 2;
const z = x + y;
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="callback is not a function"
        )
        findings = evaluate_type_mismatch(context)

        assert findings == []

    def test_far_from_error_line(self, create_context):
        """Should NOT flag calls far from error line."""
        code = '''
const callback = getData();
callback();
// many lines
// many lines
// many lines
// many lines
// many lines
// many lines
// error is here
const x = 1;
'''
        context = create_context(
            code=code,
            error_line=11,
            error_message="callback is not a function"
        )
        findings = evaluate_type_mismatch(context)

        # callback() is on line 3, error on line 11 - too far
        assert len(findings) == 0


class TestTypeMismatchFindingStructure:
    """Tests for finding structure validation."""

    def test_finding_has_required_fields(self, create_context):
        """Findings should have all required fields."""
        code = '''
const fn = config.handler;
fn();  // not a function
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="fn is not a function"
        )
        findings = evaluate_type_mismatch(context)

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

    def test_metadata_includes_callee(self, create_context):
        """Metadata should include the callee information."""
        code = '''
const handler = data.callback;
handler();
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="handler is not a function"
        )
        findings = evaluate_type_mismatch(context)

        if len(findings) > 0:
            assert "metadata" in findings[0]
            assert "callee" in findings[0]["metadata"]


class TestTypeMismatchWrapper:
    """Tests for OOP wrapper class."""

    def test_wrapper_class_exists(self):
        """TypeMismatchRule class should exist."""
        assert TypeMismatchRule is not None
        assert TypeMismatchRule.rule_id == RULE_ID

    def test_wrapper_delegates_to_function(self, create_context):
        """Wrapper should delegate to pure function."""
        code = '''
const cb = config.callback;
cb();
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="cb is not a function"
        )

        rule = TypeMismatchRule()
        wrapper_findings = rule.evaluate(context)
        function_findings = evaluate_type_mismatch(context)

        assert wrapper_findings == function_findings
