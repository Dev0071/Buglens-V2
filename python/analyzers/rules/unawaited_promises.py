"""
Unawaited Promise Rule - Pure Functional Implementation

Detects async calls that are missing await or .catch handlers.
"""
from __future__ import annotations

from typing import Any, Dict, List

from ..base import AnalysisContext

# Rule metadata (constants)
RULE_ID = "UNAWAITED_PROMISE"
RULE_TITLE = "Async call missing await or .catch"
RULE_SEVERITY = "medium"

# Async function hints (pure constant)
ASYNC_HINTS = ("fetch", "axios", "request", "client", "query", "prisma", "db", "http")


def _looks_async(callee_text: str) -> bool:
    """Pure helper: Check if function name suggests async behavior."""
    lowered = callee_text.lower()
    return any(hint in lowered for hint in ASYNC_HINTS)


def _is_promise_handled(node, context) -> bool:
    """
    Pure helper: Check if the call expression is properly handled.

    A promise is considered "handled" if:
    1. It's awaited
    2. It has .then(), .catch(), or .finally() chained
    3. Its parent is a member expression leading to .then/.catch/.finally
    4. It's a child of an await_expression or yield_expression
    """
    # Check if this call is the object of a member expression that chains to .then/.catch/.finally
    # This handles: fetch('/api').then(...) where fetch('/api') is the object
    parent = node.parent
    if parent and parent.type == "member_expression":
        property_node = parent.child_by_field_name("property")
        if property_node:
            prop_text = property_node.text
            if prop_text in {b"then", b"catch", b"finally"}:
                return True

    # Check if this node is inside an await expression
    ancestor = node.parent
    while ancestor:
        if ancestor.type in {"await_expression", "yield_expression"}:
            return True
        if ancestor.type == "expression_statement":
            # If we've hit the statement level without finding await, stop
            break
        ancestor = ancestor.parent

    # Check if the callee itself is a method like .then/.catch/.finally
    # This handles the outer call in: fetch('/api').then(...)
    callee = node.child_by_field_name("function")
    if callee and callee.type == "member_expression":
        property_node = callee.child_by_field_name("property")
        if property_node:
            prop_text = property_node.text
            if prop_text in {b"then", b"catch", b"finally"}:
                return True

    return False


def evaluate_unawaited_promise(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Pure function that evaluates code for unawaited async calls.

    Args:
        context: Analysis context containing AST and code segment

    Returns:
        List of findings (deterministic, same input = same output)
    """
    findings: List[Dict[str, Any]] = []

    for node in context.iter_nodes(["call_expression"]):
        line_number = node.start_point[0] + 1
        if abs(line_number - context.error_line) > 8:
            continue

        callee = node.child_by_field_name("function")
        if callee is None:
            continue

        callee_text = context.text_for_node(callee)
        if not _looks_async(callee_text):
            continue

        if _is_promise_handled(node, context):
            continue

        metadata = {"call": callee_text}
        message = f"Call to {callee_text} is not awaited and may resolve after the function returns."

        findings.append(
            context.build_finding(
                rule_id=RULE_ID,
                title=RULE_TITLE,
                severity=RULE_SEVERITY,
                message=message,
                line_number=line_number,
                confidence=0.62,
                metadata=metadata,
            )
        )

        if len(findings) >= 2:
            break


    return findings


# Backward compatibility - wrapper class for existing code
class UnawaitedPromiseRule:
    """Wrapper class for backward compatibility. Delegates to pure function."""
    rule_id = RULE_ID
    title = RULE_TITLE
    severity = RULE_SEVERITY

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        return evaluate_unawaited_promise(context)

    # Keep these for any code that might call them directly
    def _looks_async(self, callee_text: str) -> bool:
        return _looks_async(callee_text)

    def _is_promise_handled(self, node, context) -> bool:
        return _is_promise_handled(node, context)
