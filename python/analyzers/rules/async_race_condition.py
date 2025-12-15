"""
Async Race Condition Rule - Pure Functional Implementation

Detects potential race conditions in async code.
Common patterns:
- Shared state modified in parallel async operations
- Missing await before accessing async results
- Uncoordinated Promise.all with shared state
- Event handlers modifying shared state
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

from ..base import AnalysisContext

# Rule metadata (constants)
RULE_ID = "ASYNC_RACE_CONDITION"
RULE_TITLE = "Potential async race condition"
RULE_SEVERITY = "medium"

# Error patterns that suggest race conditions
RACE_CONDITION_PATTERNS = [
    re.compile(r"race\s*condition", re.IGNORECASE),
    re.compile(r"concurrent", re.IGNORECASE),
    re.compile(r"stale\s*(?:data|state|value)", re.IGNORECASE),
    re.compile(r"out\s*of\s*order", re.IGNORECASE),
    re.compile(r"unexpected\s*(?:value|state|result)", re.IGNORECASE),
]

# Shared state indicators
SHARED_STATE_PATTERNS = [
    re.compile(r"\bthis\."),  # Instance properties
    re.compile(r"\bstate\."),  # React state pattern
    re.compile(r"\bglobal\."),  # Global state
    re.compile(r"\bwindow\."),  # Browser globals
    re.compile(r"(?:let|var)\s+\w+\s*="),  # Mutable declarations
]


def _matches_race_condition_error(error_message: str) -> bool:
    """Check if error message suggests a race condition."""
    return any(p.search(error_message) for p in RACE_CONDITION_PATTERNS)


def _find_async_functions(context: AnalysisContext) -> List[Any]:
    """Find async function declarations and arrow functions."""
    async_funcs = []

    for node in context.iter_nodes(["function_declaration", "arrow_function", "function"]):
        # Check if it's async
        node_text = context.text_for_node(node)
        if node_text.strip().startswith("async"):
            async_funcs.append(node)

    return async_funcs


def _find_parallel_async_calls(context: AnalysisContext) -> List[Any]:
    """Find Promise.all, Promise.race, Promise.allSettled calls."""
    parallel_calls = []

    for node in context.iter_nodes(["call_expression"]):
        func_node = node.child_by_field_name("function")
        if func_node:
            func_text = context.text_for_node(func_node)
            if func_text in ("Promise.all", "Promise.race", "Promise.allSettled"):
                parallel_calls.append(node)

    return parallel_calls


def _find_shared_state_modifications(context: AnalysisContext, node: Any) -> List[str]:
    """Find assignments to shared state within a node."""
    modifications = []
    code = context.text_for_node(node)

    # Look for assignment patterns
    assignment_pattern = re.compile(
        r"(this\.\w+|state\.\w+|global\.\w+)\s*(?:=|\+=|-=|\*=|/=)"
    )

    for match in assignment_pattern.finditer(code):
        modifications.append(match.group(1))

    return modifications


def _check_for_state_access_without_await(context: AnalysisContext) -> List[Dict[str, Any]]:
    """Check for patterns where state is accessed immediately after async call without await."""
    findings = []

    for node in context.iter_nodes(["expression_statement"]):
        line_number = node.start_point[0] + 1
        if abs(line_number - context.error_line) > 6:
            continue

        node_text = context.text_for_node(node)

        # Pattern: async call then immediate state access
        # e.g., fetchData(); console.log(data.value);
        if re.search(r"\b(?:fetch|axios|get|post|request)\s*\([^)]*\)\s*;", node_text):
            # Check next line for state access
            next_line = context.get_line(line_number + 1)
            if next_line and not next_line.strip().startswith("await"):
                for pattern in SHARED_STATE_PATTERNS:
                    if pattern.search(next_line):
                        findings.append({
                            "line": line_number,
                            "pattern": "async_then_immediate_access",
                            "code": node_text.strip(),
                        })
                        break

    return findings


def evaluate_async_race_condition(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Pure function that evaluates code for async race conditions.

    Args:
        context: Analysis context containing AST and code segment

    Returns:
        List of findings (deterministic, same input = same output)
    """
    findings: List[Dict[str, Any]] = []

    # Check for parallel async calls with shared state modifications
    parallel_calls = _find_parallel_async_calls(context)

    for call_node in parallel_calls:
        line_number = call_node.start_point[0] + 1
        if abs(line_number - context.error_line) > 6:
            continue

        # Get the arguments (the array of promises)
        args_node = call_node.child_by_field_name("arguments")
        if args_node:

            # Check if any of the parallel operations modify shared state
            modifications = _find_shared_state_modifications(context, args_node)

            if modifications:
                confidence = 0.72
                if _matches_race_condition_error(context.error_message):
                    confidence = 0.85

                findings.append(
                    context.build_finding(
                        rule_id=RULE_ID,
                        title=RULE_TITLE,
                        severity=RULE_SEVERITY,
                        message=f"Parallel async operations may cause race condition - shared state `{modifications[0]}` is modified.",
                        line_number=line_number,
                        confidence=confidence,
                        metadata={
                            "type": "parallel_shared_state",
                            "modifications": modifications[:3],
                        },
                    )
                )

        if len(findings) >= 2:
            break

    # Check for async operations in loops without proper handling
    if not findings:
        for node in context.iter_nodes(["for_statement", "while_statement", "for_in_statement"]):
            line_number = node.start_point[0] + 1
            if abs(line_number - context.error_line) > 6:
                continue

            loop_body = context.text_for_node(node)

            # Check for async calls in loop without await
            if re.search(r"\basync\b", loop_body) or re.search(r"\bawait\b", loop_body):
                if re.search(r"\.push\s*\(", loop_body) or re.search(r"\[\w+\]\s*=", loop_body):
                    confidence = 0.65
                    if _matches_race_condition_error(context.error_message):
                        confidence = 0.78

                    findings.append(
                        context.build_finding(
                            rule_id=RULE_ID,
                            title=RULE_TITLE,
                            severity=RULE_SEVERITY,
                            message="Async operations in loop with shared array/object may cause race condition.",
                            line_number=line_number,
                            confidence=confidence,
                            metadata={
                                "type": "async_loop_shared_state",
                            },
                        )
                    )

            if len(findings) >= 2:
                break

    # Check for state access without await
    if not findings:
        state_issues = _check_for_state_access_without_await(context)
        for issue in state_issues[:2]:
            findings.append(
                context.build_finding(
                    rule_id=RULE_ID,
                    title=RULE_TITLE,
                    severity=RULE_SEVERITY,
                    message="Async call may complete after state is accessed - possible race condition.",
                    line_number=issue["line"],
                    confidence=0.60,
                    metadata={
                        "type": issue["pattern"],
                        "code": issue["code"],
                    },
                )
            )

    return findings


# Backward compatibility - wrapper class for existing code
class AsyncRaceConditionRule:
    """Wrapper class for backward compatibility. Delegates to pure function."""
    rule_id = RULE_ID
    title = RULE_TITLE
    severity = RULE_SEVERITY

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        return evaluate_async_race_condition(context)
