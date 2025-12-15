"""
Tests for UNAWAITED_PROMISE rule.

This rule detects async calls that are missing await or .catch handlers.
"""
from __future__ import annotations

from tree_sitter import Language, Parser
from tree_sitter_javascript import language as javascript_language

from analyzers.base import AnalysisContext, CodeSegment
from analyzers.rules.unawaited_promises import evaluate_unawaited_promise, RULE_ID


def create_context(code: str, error_line: int = 1) -> AnalysisContext:
    """Helper to create AnalysisContext from code string."""
    segment = CodeSegment(
        file_path="test.js",
        language="javascript",
        content=code,
        error_line=error_line,
    )
    parser = Parser(Language(javascript_language()))
    tree = parser.parse(bytes(code, "utf-8"))
    return AnalysisContext(segment, tree, {})


class TestUnawaitedPromisePositiveCases:
    """Tests where rule SHOULD detect issues."""

    def test_fetch_without_await(self):
        """fetch() without await should be flagged."""
        code = "fetch('/api/users');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) >= 1
        assert findings[0]["id"] == RULE_ID
        assert "fetch" in findings[0]["message"]

    def test_axios_without_await(self):
        """axios call without await should be flagged."""
        code = "axios.get('/api/users');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) >= 1

    def test_db_query_without_await(self):
        """Database query without await should be flagged."""
        code = "db.query('SELECT * FROM users');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) >= 1

    def test_prisma_without_await(self):
        """Prisma query without await should be flagged."""
        code = "prisma.user.findMany();"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) >= 1

    def test_client_request_without_await(self):
        """API client request without await should be flagged."""
        code = "client.post('/api/data', payload);"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) >= 1

    def test_http_request_without_await(self):
        """HTTP request without await should be flagged."""
        code = "http.get('https://api.example.com/data');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) >= 1


class TestUnawaitedPromiseNegativeCases:
    """Tests where rule should NOT detect issues (false positive prevention)."""

    def test_fetch_with_await(self):
        """fetch() with await should NOT be flagged."""
        code = "await fetch('/api/users');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) == 0

    def test_fetch_with_then(self):
        """fetch() with .then() should NOT be flagged."""
        code = "fetch('/api/users').then(response => response.json());"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) == 0

    def test_fetch_with_catch(self):
        """fetch() with .catch() should NOT be flagged."""
        code = "fetch('/api/users').catch(err => console.error(err));"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) == 0

    def test_fetch_with_finally(self):
        """fetch() with .finally() should NOT be flagged."""
        code = "fetch('/api/users').finally(() => setLoading(false));"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) == 0

    def test_sync_function_call(self):
        """Regular sync function calls should NOT be flagged."""
        code = "console.log('hello');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) == 0

    def test_non_async_hint_function(self):
        """Function without async hints should NOT be flagged."""
        code = "calculate(1, 2, 3);"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) == 0

    def test_assigned_fetch(self):
        """Assigned fetch (probably used later) with await should NOT be flagged."""
        code = "const promise = await fetch('/api');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) == 0


class TestUnawaitedPromiseEdgeCases:
    """Edge cases and boundary conditions."""

    def test_far_from_error_line(self):
        """Call far from error line should NOT be flagged."""
        code = """
const x = 1;
const y = 2;
const z = 3;
const a = 4;
const b = 5;
const c = 6;
const d = 7;
const e = 8;
const f = 9;
fetch('/api');
"""
        # Error on line 1, fetch on line 11 (>8 lines away)
        ctx = create_context(code, error_line=1)
        findings = evaluate_unawaited_promise(ctx)

        # Should not detect - too far from error line
        assert len(findings) == 0

    def test_limits_findings_to_two(self):
        """Rule should limit to max 2 findings."""
        code = """
fetch('/api/1');
fetch('/api/2');
fetch('/api/3');
fetch('/api/4');
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_unawaited_promise(ctx)

        # Should cap at 2
        assert len(findings) <= 2

    def test_empty_code(self):
        """Empty code should not crash."""
        code = ""
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert findings == []

    def test_nested_await(self):
        """Await inside async function should be handled."""
        code = """
async function loadData() {
    const response = await fetch('/api');
    return await response.json();
}
"""
        ctx = create_context(code, error_line=3)
        findings = evaluate_unawaited_promise(ctx)

        # Both awaited, should not flag
        assert len(findings) == 0


class TestUnawaitedPromiseFindingStructure:
    """Tests for the structure of findings."""

    def test_finding_has_required_fields(self):
        """Finding should have all required fields."""
        code = "fetch('/api');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

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
        code = "fetch('/api');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        for finding in findings:
            assert 0.0 <= finding["confidence"] <= 1.0

    def test_severity_is_medium(self):
        """UNAWAITED_PROMISE should have medium severity."""
        code = "fetch('/api');"
        ctx = create_context(code)
        findings = evaluate_unawaited_promise(ctx)

        assert len(findings) >= 1
        assert findings[0]["severity"] == "medium"
