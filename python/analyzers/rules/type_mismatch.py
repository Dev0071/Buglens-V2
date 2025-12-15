"""
Type Mismatch Rule - Pure Functional Implementation

Detects operations on values that may be the wrong type.
Common error patterns:
- "X is not a function"
- "X.Y is not a function"
- "Cannot read property 'X' of Y" where Y is a primitive
- Type coercion issues
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

from ..base import AnalysisContext

# Rule metadata (constants)
RULE_ID = "TYPE_MISMATCH"
RULE_TITLE = "Possible type mismatch"
RULE_SEVERITY = "high"

# Error patterns that suggest type mismatch (NOT null/undefined access)
TYPE_ERROR_PATTERNS = [
    re.compile(r"is not a function", re.IGNORECASE),
    re.compile(r"is not iterable", re.IGNORECASE),
    re.compile(r"is not a constructor", re.IGNORECASE),
    # Property access on primitives (NOT null/undefined - that's handled by NULL_ACCESS rule)
    re.compile(r"Cannot read propert(?:y|ies) .+ of (?:number|string|boolean)", re.IGNORECASE),
    re.compile(r"(?:number|string|boolean) has no propert(?:y|ies)", re.IGNORECASE),
    re.compile(r"\.(\w+) is not a function", re.IGNORECASE),
    re.compile(r"cannot be called", re.IGNORECASE),
    re.compile(r"is not callable", re.IGNORECASE),
]


def _matches_type_error(error_message: str) -> bool:
    """Check if error message suggests a type mismatch."""
    return any(p.search(error_message) for p in TYPE_ERROR_PATTERNS)


def _extract_function_name_from_error(error_message: str) -> str | None:
    """Extract the function name from 'X is not a function' errors."""
    # Match: "X is not a function" or "X.Y is not a function"
    match = re.search(r"(\w+(?:\.\w+)?)\s+is not a function", error_message, re.IGNORECASE)
    if match:
        return match.group(1).split(".")[-1]  # Return last part
    return None


def _find_call_expressions(context: AnalysisContext, target_name: str | None = None) -> List[Any]:
    """Find call expressions, optionally filtering by name."""
    calls = []
    for node in context.iter_nodes(["call_expression"]):
        if target_name is None:
            calls.append(node)
            continue

        # Check if this call matches the target name
        function_node = node.child_by_field_name("function")
        if function_node:
            func_text = context.text_for_node(function_node)
            # Handle both direct calls (foo()) and method calls (x.foo())
            if func_text == target_name or func_text.endswith(f".{target_name}"):
                calls.append(node)

    return calls


def _is_callback_parameter(context: AnalysisContext, var_name: str, line_number: int) -> bool:
    """Check if variable is used as a callback but might not be a function."""
    code = context.segment.content
    lines = code.split("\n")

    # Look for callback patterns
    callback_patterns = [
        re.compile(rf"\.\s*(?:map|filter|reduce|forEach|find|some|every|sort)\s*\(\s*{re.escape(var_name)}\s*\)"),
        re.compile(rf"\.\s*then\s*\(\s*{re.escape(var_name)}\s*\)"),
        re.compile(rf"\.\s*catch\s*\(\s*{re.escape(var_name)}\s*\)"),
        re.compile(rf"setTimeout\s*\(\s*{re.escape(var_name)}"),
        re.compile(rf"setInterval\s*\(\s*{re.escape(var_name)}"),
    ]

    for i, line in enumerate(lines):
        line_num = i + 1
        if abs(line_num - line_number) > 5:
            continue
        for pattern in callback_patterns:
            if pattern.search(line):
                return True
    return False


def _check_variable_reassignment(context: AnalysisContext, var_name: str) -> bool:
    """Check if variable is reassigned to a non-function value."""
    code = context.segment.content

    # Look for reassignment patterns: var_name = <non-function>
    reassign_pattern = re.compile(
        rf"(?:^|\s){re.escape(var_name)}\s*=\s*(?!function|async|=>|\()"
    )

    return bool(reassign_pattern.search(code))


def evaluate_type_mismatch(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Pure function that evaluates code for type mismatch issues.

    Args:
        context: Analysis context containing AST and code segment

    Returns:
        List of findings (deterministic, same input = same output)
    """
    findings: List[Dict[str, Any]] = []

    # Early exit if error doesn't look like a type error
    if not _matches_type_error(context.error_message):
        return findings

    # Extract target function name from error if available
    target_func = _extract_function_name_from_error(context.error_message)

    # Find relevant call expressions
    calls = _find_call_expressions(context, target_func)

    for call_node in calls:
        line_number = call_node.start_point[0] + 1
        if abs(line_number - context.error_line) > 6:
            continue

        function_node = call_node.child_by_field_name("function")
        if not function_node:
            continue

        func_text = context.text_for_node(function_node)

        # Get the variable/expression being called
        callee_name = func_text.split(".")[-1] if "." in func_text else func_text

        # Check for specific patterns
        confidence = 0.70
        message = f"`{func_text}` is called but may not be a function at runtime."

        # Higher confidence if function name matches error
        if target_func and callee_name == target_func:
            confidence = 0.85
            message = f"`{func_text}` is called but the error indicates it's not a function."

        # Check for callback misuse
        if _is_callback_parameter(context, callee_name, line_number):
            confidence = 0.80
            message = f"`{callee_name}` is passed as a callback but may not be a function."

        # Check for reassignment
        if _check_variable_reassignment(context, callee_name):
            confidence = 0.82
            message = f"`{callee_name}` may have been reassigned to a non-function value."

        metadata = {
            "callee": func_text,
            "line": line_number,
            "pattern": "not_a_function" if target_func else "possible_type_error",
        }

        findings.append(
            context.build_finding(
                rule_id=RULE_ID,
                title=RULE_TITLE,
                severity=RULE_SEVERITY,
                message=message,
                line_number=line_number,
                confidence=confidence,
                metadata=metadata,
            )
        )

        if len(findings) >= 2:
            break

    # Also check for property access on primitives
    if not findings and "of number" in context.error_message.lower():
        findings.extend(_check_property_access_on_primitive(context, "number"))
    elif not findings and "of string" in context.error_message.lower():
        findings.extend(_check_property_access_on_primitive(context, "string"))

    return findings


def _check_property_access_on_primitive(context: AnalysisContext, primitive_type: str) -> List[Dict[str, Any]]:
    """Check for property access that might be on a primitive instead of object."""
    findings: List[Dict[str, Any]] = []

    for node in context.iter_nodes(["member_expression"]):
        line_number = node.start_point[0] + 1
        if abs(line_number - context.error_line) > 6:
            continue

        object_node = node.child_by_field_name("object")
        property_node = node.child_by_field_name("property")
        if not object_node or not property_node:
            continue

        obj_text = context.text_for_node(object_node)
        prop_text = context.text_for_node(property_node)

        # Skip optional chaining
        access_text = context.text_for_node(node)
        if "?." in access_text:
            continue

        message = f"`{obj_text}.{prop_text}` - `{obj_text}` may be a {primitive_type} instead of an object."

        findings.append(
            context.build_finding(
                rule_id=RULE_ID,
                title=RULE_TITLE,
                severity=RULE_SEVERITY,
                message=message,
                line_number=line_number,
                confidence=0.72,
                metadata={
                    "object": obj_text,
                    "property": prop_text,
                    "expected_type": "object",
                    "actual_type": primitive_type,
                },
            )
        )

        if len(findings) >= 2:
            break

    return findings


# Backward compatibility - wrapper class for existing code
class TypeMismatchRule:
    """Wrapper class for backward compatibility. Delegates to pure function."""
    rule_id = RULE_ID
    title = RULE_TITLE
    severity = RULE_SEVERITY

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        return evaluate_type_mismatch(context)
