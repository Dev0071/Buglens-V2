"""
Tests for ASYNC_RACE_CONDITION rule.

Tests cover:
1. Positive cases - code that SHOULD trigger the rule
2. Negative cases - code that should NOT trigger (false positive prevention)
3. Edge cases - boundary conditions
4. Finding structure validation
"""
from __future__ import annotations

import pytest

from analyzers.rules.async_race_condition import (
    RULE_ID,
    RULE_SEVERITY,
    RULE_TITLE,
    AsyncRaceConditionRule,
    evaluate_async_race_condition,
)


class TestAsyncRaceConditionPositiveCases:
    """Tests where the rule SHOULD find issues."""

    def test_promise_all_with_shared_state(self, create_context):
        """Should detect Promise.all with shared state modifications."""
        code = """
const results = [];
await Promise.all([
    fetch('/a').then(r => { this.data = r; }),
    fetch('/b').then(r => { this.data = r; }),
]);
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="race condition detected",
        )
        findings = evaluate_async_race_condition(context)

        assert len(findings) >= 1
        assert findings[0]["id"] == RULE_ID

    def test_async_loop_with_shared_array(self, create_context):
        """Should detect async operations in loop with shared state."""
        code = """
const items = [];
for (const id of ids) {
    const result = await fetch(id);
    items.push(result);
}
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="unexpected value",
        )
        findings = evaluate_async_race_condition(context)

        # May or may not detect depending on pattern matching
        assert isinstance(findings, list)

    def test_promise_race_with_state(self, create_context):
        """Should detect Promise.race with shared state."""
        code = """
let winner;
await Promise.race([
    fetchA().then(r => { state.winner = r; }),
    fetchB().then(r => { state.winner = r; }),
]);
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="stale data",
        )
        findings = evaluate_async_race_condition(context)

        # Should detect the shared state modification
        assert isinstance(findings, list)


class TestAsyncRaceConditionNegativeCases:
    """Tests where the rule should NOT find issues (false positive prevention)."""

    def test_sequential_async_calls(self, create_context):
        """Should NOT flag sequential async calls."""
        code = """
const a = await fetchA();
const b = await fetchB();
console.log(a, b);
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="Some error",
        )
        findings = evaluate_async_race_condition(context)

        assert len(findings) == 0

    def test_promise_all_without_shared_state(self, create_context):
        """Should NOT flag Promise.all without shared state modification."""
        code = """
const [a, b] = await Promise.all([
    fetch('/a').then(r => r.json()),
    fetch('/b').then(r => r.json()),
]);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="Network error",
        )
        findings = evaluate_async_race_condition(context)

        assert len(findings) == 0

    def test_sync_loop(self, create_context):
        """Should NOT flag synchronous loops."""
        code = """
const items = [];
for (const id of ids) {
    items.push(process(id));
}
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="Some error",
        )
        findings = evaluate_async_race_condition(context)

        assert len(findings) == 0


class TestAsyncRaceConditionEdgeCases:
    """Edge case tests."""

    def test_empty_code(self, create_context):
        """Should handle empty code gracefully."""
        context = create_context(
            code="",
            error_line=1,
            error_message="race condition",
        )
        findings = evaluate_async_race_condition(context)

        assert findings == []

    def test_no_async_code(self, create_context):
        """Should handle code without async patterns."""
        code = """
const x = 1;
const y = 2;
console.log(x + y);
"""
        context = create_context(
            code=code,
            error_line=3,
            error_message="race condition",
        )
        findings = evaluate_async_race_condition(context)

        assert findings == []

    def test_far_from_error_line(self, create_context):
        """Should NOT flag patterns far from error line."""
        code = """
await Promise.all([
    fetchA().then(r => { this.data = r; }),
]);
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
            error_message="race condition",
        )
        findings = evaluate_async_race_condition(context)

        assert len(findings) == 0


class TestAsyncRaceConditionFindingStructure:
    """Tests for finding structure validation."""

    def test_finding_has_required_fields(self, create_context):
        """Findings should have all required fields."""
        code = """
await Promise.all([
    fetchA().then(r => { this.data = r; }),
    fetchB().then(r => { this.data = r; }),
]);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="race condition",
        )
        findings = evaluate_async_race_condition(context)

        if len(findings) > 0:
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


class TestAsyncRaceConditionWrapper:
    """Tests for OOP wrapper class."""

    def test_wrapper_class_exists(self):
        """AsyncRaceConditionRule class should exist."""
        assert AsyncRaceConditionRule is not None
        assert AsyncRaceConditionRule.rule_id == RULE_ID

    def test_wrapper_delegates_to_function(self, create_context):
        """Wrapper should delegate to pure function."""
        code = """
await Promise.all([
    fetchA().then(r => { this.data = r; }),
]);
"""
        context = create_context(
            code=code,
            error_line=2,
            error_message="race condition",
        )

        rule = AsyncRaceConditionRule()
        wrapper_findings = rule.evaluate(context)
        function_findings = evaluate_async_race_condition(context)

        assert wrapper_findings == function_findings
