"""
Tests for ARRAY_OUT_OF_BOUNDS rule.

Tests cover:
1. Positive cases - code that SHOULD trigger the rule
2. Negative cases - code that should NOT trigger (false positive prevention)
3. Edge cases - boundary conditions
4. Finding structure validation
"""
from __future__ import annotations

from analyzers.rules.array_out_of_bounds import (
    RULE_ID,
    RULE_SEVERITY,
    RULE_TITLE,
    ArrayOutOfBoundsRule,
    evaluate_array_out_of_bounds,
)


class TestArrayOutOfBoundsPositiveCases:
    """Tests where the rule SHOULD find issues."""

    def test_direct_index_access_no_check(self, create_context):
        """Should detect array access without bounds check."""
        code = '''
const items = getItems();
const first = items[0];
const last = items[items.length - 1];
const specific = items[5];  // no check if items has 6 elements
console.log(specific.name);
'''
        context = create_context(
            code=code,
            error_line=5,
            error_message="Cannot read property 'name' of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) >= 1
        assert findings[0]["id"] == RULE_ID
        assert "5" in findings[0]["message"] or "items" in findings[0]["message"]

    def test_variable_index_access(self, create_context):
        """Should detect variable index access without bounds check."""
        code = '''
const data = response.items;
const idx = parseInt(params.index);
const item = data[idx];  // no bounds check
return item.value;
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="Cannot read property 'value' of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) >= 1
        assert findings[0]["confidence"] >= 0.70

    def test_loop_index_outside_bounds(self, create_context):
        """Should detect potentially unsafe loop access."""
        code = '''
const arr = [1, 2, 3];
for (let i = 0; i <= arr.length; i++) {  // off-by-one: <= instead of <
    console.log(arr[i].toString());
}
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="Cannot read property 'toString' of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) >= 1

    def test_nested_array_access(self, create_context):
        """Should detect nested array access issues."""
        code = '''
const matrix = getMatrix();
const row = matrix[0];
const cell = row[5];  // row might not have 6 columns
return cell.value;
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="Cannot read property 'value' of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) >= 1

    def test_computed_index_access(self, create_context):
        """Should detect computed index access."""
        code = '''
const items = fetchItems();
const offset = getOffset();
const item = items[offset + 1];  // computed index
return item.name;
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="Cannot read property 'name' of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) >= 1
        assert "offset + 1" in findings[0]["message"] or "items" in findings[0]["message"]

    def test_length_minus_one_access(self, create_context):
        """Should detect arr.length - 1 access (common but can fail on empty)."""
        code = '''
const list = getList();  // might be empty
const last = list[list.length - 1];  // undefined if empty
return last.id;
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property 'id' of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) >= 1

    def test_property_access_after_index(self, create_context):
        """Should have higher confidence when accessing property on indexed result."""
        code = '''
const users = getUsers();
const user = users[i];
const name = user.name;  // user might be undefined
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property 'name' of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        if len(findings) > 0:
            assert findings[0]["metadata"].get("accessing_property") or "i" in findings[0]["message"]


class TestArrayOutOfBoundsNegativeCases:
    """Tests where the rule should NOT find issues (false positive prevention)."""

    def test_with_bounds_check_before(self, create_context):
        """Should NOT flag when bounds check exists before access."""
        code = '''
const items = getItems();
if (items.length > 5) {
    const item = items[5];
    console.log(item.name);
}
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="Cannot read property 'name' of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) == 0

    def test_with_index_check(self, create_context):
        """Should NOT flag when index is checked against length."""
        code = '''
const arr = getData();
const idx = getIndex();
if (idx < arr.length) {
    const value = arr[idx];
    console.log(value);
}
'''
        context = create_context(
            code=code,
            error_line=5,
            error_message="Cannot read property of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) == 0

    def test_with_optional_chaining(self, create_context):
        """Should NOT flag when optional chaining is used."""
        code = '''
const items = getItems();
const item = items[5]?.name;  // safe access
console.log(item);
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Some error"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) == 0

    def test_with_array_at_method(self, create_context):
        """Should NOT flag when using .at() method (safe access)."""
        code = '''
const arr = getData();
const last = arr.at(-1);  // safe negative index access
console.log(last);
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Some error"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) == 0

    def test_proper_for_loop(self, create_context):
        """Should have lower confidence for proper for loops."""
        code = '''
const arr = [1, 2, 3];
for (let i = 0; i < arr.length; i++) {
    console.log(arr[i]);
}
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="Cannot read property of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        # May still flag but with lower confidence, or not at all
        if len(findings) > 0:
            assert findings[0]["confidence"] < 0.75

    def test_foreach_iteration(self, create_context):
        """Should NOT flag forEach since it doesn't use indices."""
        code = '''
const items = getItems();
items.forEach(item => {
    console.log(item.name);
});
'''
        context = create_context(
            code=code,
            error_line=4,
            error_message="Cannot read property 'name' of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        # No subscript access, so no findings
        assert len(findings) == 0

    def test_string_key_access(self, create_context):
        """Should NOT flag object property access (not array index)."""
        code = '''
const obj = getObject();
const value = obj["propertyName"];
console.log(value);
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        # String key access is not a numeric index
        assert len(findings) == 0


class TestArrayOutOfBoundsEdgeCases:
    """Edge case tests."""

    def test_empty_code(self, create_context):
        """Should handle empty code gracefully."""
        context = create_context(
            code="",
            error_line=1,
            error_message="Cannot read property of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert findings == []

    def test_no_array_access(self, create_context):
        """Should handle code without array access."""
        code = '''
const x = 1;
const y = 2;
const z = x + y;
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert findings == []

    def test_far_from_error_line(self, create_context):
        """Should NOT flag access far from error line."""
        code = '''
const arr = [1, 2, 3];
const first = arr[0];
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
            error_message="Cannot read property of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        # arr[0] is on line 3, error on line 11 - too far
        assert len(findings) == 0

    def test_max_findings_limit(self, create_context):
        """Should limit findings to prevent noise."""
        code = '''
const arr = getData();
const a = arr[0];
const b = arr[1];
const c = arr[2];
const d = arr[3];
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        # Should limit to max 2 findings
        assert len(findings) <= 2


class TestArrayOutOfBoundsFindingStructure:
    """Tests for finding structure validation."""

    def test_finding_has_required_fields(self, create_context):
        """Findings should have all required fields."""
        code = '''
const items = getItems();
const item = items[i];
console.log(item);
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

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

    def test_metadata_includes_array_and_index(self, create_context):
        """Metadata should include array and index information."""
        code = '''
const data = getData();
const value = data[5];
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property of undefined"
        )
        findings = evaluate_array_out_of_bounds(context)

        assert len(findings) >= 1
        assert "metadata" in findings[0]
        metadata = findings[0]["metadata"]
        assert "array" in metadata
        assert "index" in metadata
        assert metadata["array"] == "data"
        assert metadata["index"] == "5"


class TestArrayOutOfBoundsWrapper:
    """Tests for OOP wrapper class."""

    def test_wrapper_class_exists(self):
        """ArrayOutOfBoundsRule class should exist."""
        assert ArrayOutOfBoundsRule is not None
        assert ArrayOutOfBoundsRule.rule_id == RULE_ID

    def test_wrapper_delegates_to_function(self, create_context):
        """Wrapper should delegate to pure function."""
        code = '''
const arr = getData();
const item = arr[i];
'''
        context = create_context(
            code=code,
            error_line=3,
            error_message="Cannot read property of undefined"
        )

        rule = ArrayOutOfBoundsRule()
        wrapper_findings = rule.evaluate(context)
        function_findings = evaluate_array_out_of_bounds(context)

        assert wrapper_findings == function_findings
