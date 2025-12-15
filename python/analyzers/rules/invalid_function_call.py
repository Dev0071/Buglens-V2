"""
Invalid Function Call Rule - Pure Functional Implementation

Detects calls to non-function values or invalid call patterns.
Common error patterns:
- Calling undefined methods
- Calling null/undefined values
- Wrong number of arguments (when detectable)
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

from ..base import AnalysisContext

# Rule metadata (constants)
RULE_ID = "INVALID_FUNCTION_CALL"
RULE_TITLE = "Possibly invalid function call"
RULE_SEVERITY = "high"

# Error patterns that suggest invalid function calls
INVALID_CALL_PATTERNS = [
    re.compile(r"(\w+(?:\.\w+)?)\s+is not a function", re.IGNORECASE),
    re.compile(r"Cannot call\s+(\w+)", re.IGNORECASE),
    re.compile(r"(\w+)\s+is not callable", re.IGNORECASE),
    re.compile(r"undefined\s+is not a function", re.IGNORECASE),
    re.compile(r"null\s+is not a function", re.IGNORECASE),
    re.compile(r"(\w+)\s+is undefined", re.IGNORECASE),
]

# Common typos in method names
COMMON_TYPOS = {
    "lenght": "length",
    "legth": "length",
    "toSting": "toString",
    "tostring": "toString",
    "valueof": "valueOf",
    "indexof": "indexOf",
    "lastindexof": "lastIndexOf",
    "pushState": "pushState",
    "getElementByID": "getElementById",
    "addEventListner": "addEventListener",
    "removeEventListner": "removeEventListener",
    "setTimeOut": "setTimeout",
    "setTimeot": "setTimeout",
    "setinterval": "setInterval",
    "consol": "console",
    "documnet": "document",
    "widnow": "window",
}


def _extract_function_from_error(error_message: str) -> str | None:
    """Extract the function/method name from the error message."""
    for pattern in INVALID_CALL_PATTERNS:
        match = pattern.search(error_message)
        if match and match.groups():
            return match.group(1).split(".")[-1]  # Get last part
    return None


def _check_for_typo(method_name: str) -> str | None:
    """Check if method name is a common typo."""
    lower_name = method_name.lower()
    for typo, correct in COMMON_TYPOS.items():
        if lower_name == typo.lower():
            # Don't suggest if it's already correct
            if method_name == correct:
                return None
            return correct
    return None


def _is_chained_call(node: Any) -> bool:
    """Check if this is a chained method call like obj.method().anotherMethod()."""
    parent = node.parent
    if parent and parent.type == "member_expression":
        grandparent = parent.parent
        if grandparent and grandparent.type == "call_expression":
            return True
    return False


def evaluate_invalid_function_call(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Pure function that evaluates code for invalid function calls.

    Args:
        context: Analysis context containing AST and code segment

    Returns:
        List of findings (deterministic, same input = same output)
    """
    findings: List[Dict[str, Any]] = []

    # Extract target from error if available
    target_func = _extract_function_from_error(context.error_message)

    # Check all call expressions
    for node in context.iter_nodes(["call_expression"]):
        line_number = node.start_point[0] + 1
        if abs(line_number - context.error_line) > 6:
            continue

        function_node = node.child_by_field_name("function")
        if not function_node:
            continue

        func_text = context.text_for_node(function_node)
        callee_name = func_text.split(".")[-1] if "." in func_text else func_text

        # Check for typos
        typo_correction = _check_for_typo(callee_name)
        if typo_correction:
            findings.append(
                context.build_finding(
                    rule_id=RULE_ID,
                    title=RULE_TITLE,
                    severity=RULE_SEVERITY,
                    message=f"`{callee_name}` may be a typo - did you mean `{typo_correction}`?",
                    line_number=line_number,
                    confidence=0.85,
                    metadata={
                        "callee": func_text,
                        "typo": callee_name,
                        "suggestion": typo_correction,
                    },
                )
            )
            continue

        # Check if target matches error
        if target_func and callee_name == target_func:
            confidence = 0.82
            message = f"`{func_text}()` - error indicates `{target_func}` is not a valid function."

            # Check for chained calls
            if _is_chained_call(function_node):
                message = f"`{func_text}()` - previous call in chain may return wrong type."
                confidence = 0.78

            findings.append(
                context.build_finding(
                    rule_id=RULE_ID,
                    title=RULE_TITLE,
                    severity=RULE_SEVERITY,
                    message=message,
                    line_number=line_number,
                    confidence=confidence,
                    metadata={
                        "callee": func_text,
                        "line": line_number,
                        "is_chained": _is_chained_call(function_node),
                    },
                )
            )

        if len(findings) >= 2:
            break

    # Also check member expressions for undefined method access
    if not findings and "is not a function" in context.error_message.lower():
        for node in context.iter_nodes(["member_expression"]):
            line_number = node.start_point[0] + 1
            if abs(line_number - context.error_line) > 6:
                continue

            property_node = node.child_by_field_name("property")
            if property_node:
                prop_name = context.text_for_node(property_node)

                if target_func and prop_name == target_func:
                    parent = node.parent
                    if parent and parent.type == "call_expression":
                        findings.append(
                            context.build_finding(
                                rule_id=RULE_ID,
                                title=RULE_TITLE,
                                severity=RULE_SEVERITY,
                                message=f"`.{prop_name}()` - method may not exist on this object.",
                                line_number=line_number,
                                confidence=0.75,
                                metadata={
                                    "method": prop_name,
                                    "line": line_number,
                                },
                            )
                        )

            if len(findings) >= 2:
                break

    return findings


# Backward compatibility - wrapper class for existing code
class InvalidFunctionCallRule:
    """Wrapper class for backward compatibility. Delegates to pure function."""
    rule_id = RULE_ID
    title = RULE_TITLE
    severity = RULE_SEVERITY

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        return evaluate_invalid_function_call(context)
