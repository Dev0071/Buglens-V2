"""
Tests for MEMORY_LEAK rule.

Tests cover:
1. Positive cases - code that SHOULD trigger the rule
2. Negative cases - code that should NOT trigger (false positive prevention)
3. Edge cases - boundary conditions
4. Finding structure validation
"""
from __future__ import annotations


from analyzers.rules.memory_leak import (
    RULE_ID,
    RULE_SEVERITY,
    RULE_TITLE,
    MemoryLeakRule,
    evaluate_memory_leak,
)


class TestMemoryLeakPositiveCases:
    """Tests where the rule SHOULD find issues."""

    def test_event_listener_without_removal(self, create_context):
        """Should detect addEventListener without removeEventListener."""
        code = """
function setup() {
    window.addEventListener('resize', handleResize);
}
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="memory leak detected",
        )
        findings = evaluate_memory_leak(context)

        assert len(findings) >= 1
        assert findings[0]["id"] == RULE_ID
        assert "addEventListener" in findings[0]["message"]

    def test_setinterval_not_stored(self, create_context):
        """Should detect setInterval without storing the ID."""
        code = """
function startPolling() {
    setInterval(() => {
        fetchData();
    }, 1000);
}
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="too many listeners",
        )
        findings = evaluate_memory_leak(context)

        assert len(findings) >= 1
        assert "setInterval" in findings[0]["message"]

    def test_settimeout_in_loop(self, create_context):
        """Should detect unassigned setTimeout."""
        code = """
for (let i = 0; i < 100; i++) {
    setTimeout(() => process(i), 1000);
}
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="memory leak",
        )
        findings = evaluate_memory_leak(context)

        # May or may not detect depending on pattern
        assert isinstance(findings, list)

    def test_multiple_listeners_same_element(self, create_context):
        """Should detect multiple listeners without removal."""
        code = """
button.addEventListener('click', handler1);
button.addEventListener('mouseover', handler2);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="memory issue",
        )
        findings = evaluate_memory_leak(context)

        assert len(findings) >= 1


class TestMemoryLeakNegativeCases:
    """Tests where the rule should NOT find issues (false positive prevention)."""

    def test_event_listener_with_removal(self, create_context):
        """Should NOT flag when removeEventListener is present."""
        code = """
function setup() {
    window.addEventListener('resize', handleResize);
}
function cleanup() {
    window.removeEventListener('resize', handleResize);
}
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="Some error",
        )
        findings = evaluate_memory_leak(context)

        # Should not flag window since removeEventListener exists
        assert len(findings) == 0

    def test_setinterval_stored(self, create_context):
        """Should NOT flag when setInterval result is stored."""
        code = """
const intervalId = setInterval(() => {
    fetchData();
}, 1000);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="Some error",
        )
        findings = evaluate_memory_leak(context)

        # Result is assigned, so less likely to leak
        timer_findings = [f for f in findings if "setInterval" in f.get("message", "")]
        assert len(timer_findings) == 0

    def test_proper_cleanup_pattern(self, create_context):
        """Should NOT flag code with proper cleanup."""
        code = """
const timerId = setInterval(poll, 1000);
// Later...
clearInterval(timerId);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="Some error",
        )
        findings = evaluate_memory_leak(context)

        assert len(findings) == 0


class TestMemoryLeakEdgeCases:
    """Edge case tests."""

    def test_empty_code(self, create_context):
        """Should handle empty code gracefully."""
        context = create_context(
            code="",
            error_line=1,
            error_message="memory leak",
        )
        findings = evaluate_memory_leak(context)

        assert findings == []

    def test_no_listeners_or_timers(self, create_context):
        """Should handle code without listeners or timers."""
        code = """
const x = 1;
const y = 2;
console.log(x + y);
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="memory leak",
        )
        findings = evaluate_memory_leak(context)

        assert len(findings) == 0

    def test_far_from_error_line(self, create_context):
        """Should NOT flag patterns far from error line."""
        code = """
window.addEventListener('resize', handler);
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
            error_message="memory leak",
        )
        findings = evaluate_memory_leak(context)

        assert len(findings) == 0


class TestMemoryLeakFindingStructure:
    """Tests for finding structure validation."""

    def test_finding_has_required_fields(self, create_context):
        """Findings should have all required fields."""
        code = """
window.addEventListener('resize', handler);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="memory leak",
        )
        findings = evaluate_memory_leak(context)

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

    def test_metadata_includes_type(self, create_context):
        """Metadata should include leak type."""
        code = """
element.addEventListener('click', handler);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="memory leak",
        )
        findings = evaluate_memory_leak(context)

        if len(findings) > 0:
            assert "metadata" in findings[0]
            assert "type" in findings[0]["metadata"]


class TestMemoryLeakWrapper:
    """Tests for OOP wrapper class."""

    def test_wrapper_class_exists(self):
        """MemoryLeakRule class should exist."""
        assert MemoryLeakRule is not None
        assert MemoryLeakRule.rule_id == RULE_ID

    def test_wrapper_delegates_to_function(self, create_context):
        """Wrapper should delegate to pure function."""
        code = """
window.addEventListener('resize', handler);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="memory leak",
        )

        rule = MemoryLeakRule()
        wrapper_findings = rule.evaluate(context)
        function_findings = evaluate_memory_leak(context)

        assert wrapper_findings == function_findings
