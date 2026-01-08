"""
Tests for NULL_ACCESS rule.

This rule detects property access on potentially null/undefined values.
"""
from __future__ import annotations

from tree_sitter import Language, Parser
from tree_sitter_javascript import language as javascript_language

from analyzers.base import AnalysisContext, CodeSegment
from analyzers.rules.null_access import evaluate_null_access, RULE_ID


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


class TestNullAccessPositiveCases:
    """Tests where rule SHOULD detect issues."""

    def test_simple_property_access(self):
        """Direct property access without null check."""
        code = "const name = user.name;"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        assert len(findings) >= 1
        assert findings[0]["id"] == RULE_ID
        assert "user" in findings[0]["message"]

    def test_nested_property_access(self):
        """Nested property access without null check."""
        code = "const city = user.address.city;"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        assert len(findings) >= 1
        # Should detect user.address or address.city

    def test_method_call_on_property(self):
        """Method call on potentially null property."""
        code = "const upper = user.name.toUpperCase();"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        assert len(findings) >= 1

    def test_property_access_in_function(self):
        """Property access inside function body."""
        code = """
function getUsername(user) {
    return user.name;
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_null_access(ctx)

        assert len(findings) >= 1

    def test_property_access_in_arrow_function(self):
        """Property access in arrow function."""
        code = "const getName = (user) => user.name;"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        assert len(findings) >= 1

    def test_db_result_property_access(self):
        """Common pattern: accessing property on database result."""
        code = """
async function getUser(id) {
    const user = await db.findOne({ id });
    return user.email;
}
"""
        ctx = create_context(code, error_line=4)
        findings = evaluate_null_access(ctx)

        assert len(findings) >= 1


class TestNullAccessNegativeCases:
    """Tests where rule should NOT detect issues (false positive prevention)."""

    def test_optional_chaining(self):
        """Optional chaining should NOT be flagged."""
        code = "const name = user?.name;"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        # Should not flag optional chaining
        assert len(findings) == 0

    def test_if_null_check_before(self):
        """If null check before access should NOT be flagged."""
        code = """
if (user) {
    const name = user.name;
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_null_access(ctx)

        # Guard detected, should not flag
        assert len(findings) == 0

    def test_if_not_null_check_before(self):
        """If !null check before access should NOT be flagged."""
        code = """
if (!user) {
    return null;
}
const name = user.name;
"""
        ctx = create_context(code, error_line=5)
        findings = evaluate_null_access(ctx)

        # Guard detected via early return pattern
        assert len(findings) == 0

    def test_nullish_coalescing(self):
        """Nullish coalescing should NOT be flagged."""
        code = "const name = user?.name ?? 'default';"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        assert len(findings) == 0

    def test_typeof_check_before(self):
        """typeof !== undefined check should NOT be flagged."""
        code = """
if (typeof user !== 'undefined') {
    const name = user.name;
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_null_access(ctx)

        assert len(findings) == 0

    def test_and_guard(self):
        """AND guard (user && user.name) should NOT be flagged."""
        code = "const name = user && user.name;"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        # The && pattern is a guard itself
        assert len(findings) == 0

    def test_explicit_equality_check(self):
        """Explicit null check should NOT be flagged."""
        code = """
if (user !== null) {
    const name = user.name;
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_null_access(ctx)

        assert len(findings) == 0


class TestNullAccessEdgeCases:
    """Edge cases and boundary conditions."""

    def test_far_from_error_line(self):
        """Access far from error line should NOT be flagged."""
        code = """
const x = 1;
const y = 2;
const z = 3;
const a = 4;
const b = 5;
const c = 6;
const d = 7;
const name = user.name;
"""
        # Error on line 1, access on line 9 (>6 lines away)
        ctx = create_context(code, error_line=1)
        findings = evaluate_null_access(ctx)

        # Should not detect - too far from error line
        assert len(findings) == 0

    def test_limits_findings_to_two(self):
        """Rule should limit to max 2 findings."""
        code = """
const a = obj1.prop;
const b = obj2.prop;
const c = obj3.prop;
const d = obj4.prop;
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_null_access(ctx)

        # Should cap at 2
        assert len(findings) <= 2

    def test_empty_code(self):
        """Empty code should not crash."""
        code = ""
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        assert findings == []

    def test_only_comments(self):
        """Only comments should not crash."""
        code = "// Just a comment"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        assert findings == []


class TestNullAccessFindingStructure:
    """Tests for the structure of findings."""

    def test_finding_has_required_fields(self):
        """Finding should have all required fields."""
        code = "const name = user.name;"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        assert len(findings) >= 1
        finding = findings[0]

        # Required fields
        assert "id" in finding
        assert "title" in finding
        assert "severity" in finding
        assert "confidence" in finding
        assert "message" in finding
        assert "evidence" in finding

        # Evidence structure
        evidence = finding["evidence"]
        assert "file_path" in evidence
        assert "line_number" in evidence
        assert "snippet" in evidence

    def test_confidence_is_reasonable(self):
        """Confidence should be between 0 and 1."""
        code = "const name = user.name;"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        for finding in findings:
            assert 0.0 <= finding["confidence"] <= 1.0

    def test_severity_is_high(self):
        """NULL_ACCESS should have high severity."""
        code = "const name = user.name;"
        ctx = create_context(code)
        findings = evaluate_null_access(ctx)

        assert len(findings) >= 1
        assert findings[0]["severity"] == "high"
