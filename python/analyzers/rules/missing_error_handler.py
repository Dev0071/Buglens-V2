"""
Missing Error Handler Rule - Pure Functional Implementation

Detects try blocks that are missing catch handlers.
"""
from __future__ import annotations

from typing import Any, Dict, List

from ..base import AnalysisContext

# Rule metadata (constants)
RULE_ID = "MISSING_ERROR_HANDLER"
RULE_TITLE = "Try block missing catch"
RULE_SEVERITY = "medium"


def evaluate_missing_error_handler(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Pure function that evaluates code for try blocks missing catch handlers.

    Args:
        context: Analysis context containing AST and code segment

    Returns:
        List of findings (deterministic, same input = same output)
    """
    findings: List[Dict[str, Any]] = []

    for node in context.iter_nodes(["try_statement"]):
        has_catch = any(child.type == "catch_clause" for child in node.children)
        if has_catch:
            continue

        start_line = node.start_point[0] + 1
        end_line = node.end_point[0] + 1
        if context.error_line < start_line - 2 or context.error_line > end_line + 5:
            continue

        message = "try block wraps risky code but lacks a catch/finally handler"
        findings.append(
            context.build_finding(
                rule_id=RULE_ID,
                title=RULE_TITLE,
                severity=RULE_SEVERITY,
                message=message,
                line_number=start_line,
                confidence=0.55,
                metadata={"range": f"{start_line}-{end_line}"},
            )
        )

        if len(findings) >= 1:
            break

    return findings


# Backward compatibility - wrapper class for existing code
class MissingErrorHandlerRule:
    """Wrapper class for backward compatibility. Delegates to pure function."""
    rule_id = RULE_ID
    title = RULE_TITLE
    severity = RULE_SEVERITY

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        return evaluate_missing_error_handler(context)
