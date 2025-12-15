"""
Array Out of Bounds Rule - Pure Functional Implementation

Detects array access patterns that may result in out-of-bounds errors.
Common error patterns:
- "Cannot read property 'X' of undefined" (from arr[i].X where i is out of bounds)
- "undefined is not an object" (from arr[i].method())
- Direct index access without bounds checking
"""
from __future__ import annotations

import re
from typing import Any, Dict, List

from ..base import AnalysisContext

# Rule metadata (constants)
RULE_ID = "ARRAY_OUT_OF_BOUNDS"
RULE_TITLE = "Possible array out of bounds access"
RULE_SEVERITY = "high"

# Error patterns that suggest array out of bounds
BOUNDS_ERROR_PATTERNS = [
    re.compile(r"Cannot read propert(?:y|ies) .+ of undefined", re.IGNORECASE),
    re.compile(r"undefined is not an object", re.IGNORECASE),
    re.compile(r"is undefined", re.IGNORECASE),
    re.compile(r"index out of (?:range|bounds)", re.IGNORECASE),
    re.compile(r"Invalid array length", re.IGNORECASE),
]


def _matches_bounds_error(error_message: str) -> bool:
    """Check if error message suggests an out-of-bounds access."""
    return any(p.search(error_message) for p in BOUNDS_ERROR_PATTERNS)


def _is_numeric_index(index_text: str) -> bool:
    """Check if index is numeric (literal or variable typically used for indexing)."""
    # Direct numeric literal
    if index_text.isdigit():
        return True
    # Common index variable names
    if index_text in ("i", "j", "k", "n", "idx", "index", "pos", "offset"):
        return True
    # Arithmetic expressions (i + 1, i - 1, etc.)
    if re.match(r"^\w+\s*[+\-*/]\s*\d+$", index_text):
        return True
    # Length-based access (arr.length - 1)
    if ".length" in index_text:
        return True
    return False


def _has_bounds_check(context: AnalysisContext, array_name: str, index_text: str, line_number: int) -> bool:
    """Check if there's a bounds check for the array access."""
    code = context.segment.content
    lines = code.split("\n")

    # Look for bounds check patterns before the access
    bounds_patterns = [
        # if (arr.length > i)
        re.compile(rf"{re.escape(array_name)}\.length\s*[>>=]\s*{re.escape(index_text)}"),
        # if (i < arr.length)
        re.compile(rf"{re.escape(index_text)}\s*[<<=]\s*{re.escape(array_name)}\.length"),
        # if (arr[i])
        re.compile(rf"if\s*\(\s*{re.escape(array_name)}\s*\[\s*{re.escape(index_text)}\s*\]"),
        # arr[i] &&
        re.compile(rf"{re.escape(array_name)}\s*\[\s*{re.escape(index_text)}\s*\]\s*&&"),
        # Optional chaining: arr[i]?.
        re.compile(rf"{re.escape(array_name)}\s*\[\s*{re.escape(index_text)}\s*\]\s*\?\s*\."),
        # arr.at(i) - safe access method
        re.compile(rf"{re.escape(array_name)}\.at\s*\("),
        # Array.isArray check
        re.compile(rf"Array\.isArray\s*\(\s*{re.escape(array_name)}\s*\)"),
    ]

    for i, line in enumerate(lines):
        line_num = i + 1
        # Check lines before and on the error line
        if line_num > line_number:
            continue
        for pattern in bounds_patterns:
            if pattern.search(line):
                return True

    return False


def _is_loop_index_access(context: AnalysisContext, array_name: str, index_text: str, line_number: int) -> bool:
    """Check if this is an access inside a for loop with proper bounds."""
    code = context.segment.content
    lines = code.split("\n")

    # Look for enclosing for loop with proper bounds
    for_patterns = [
        # for (let i = 0; i < arr.length; i++)
        re.compile(rf"for\s*\([^)]*{re.escape(index_text)}\s*[<<=]\s*{re.escape(array_name)}\.length"),
        # for (let i of arr)
        re.compile(rf"for\s*\([^)]*of\s+{re.escape(array_name)}\s*\)"),
        # arr.forEach
        re.compile(rf"{re.escape(array_name)}\.forEach\s*\("),
        # arr.map, arr.filter, etc.
        re.compile(rf"{re.escape(array_name)}\.(?:map|filter|reduce|find|some|every)\s*\("),
    ]

    for i, line in enumerate(lines):
        line_num = i + 1
        if line_num > line_number:
            continue
        for pattern in for_patterns:
            if pattern.search(line):
                return True

    return False


def evaluate_array_out_of_bounds(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Pure function that evaluates code for array out of bounds access.

    Args:
        context: Analysis context containing AST and code segment

    Returns:
        List of findings (deterministic, same input = same output)
    """
    findings: List[Dict[str, Any]] = []

    # Check for subscript expressions (array[index])
    for node in context.iter_nodes(["subscript_expression"]):
        line_number = node.start_point[0] + 1
        if abs(line_number - context.error_line) > 6:
            continue

        # Get the array and index
        object_node = node.child_by_field_name("object")
        index_node = node.child_by_field_name("index")

        if not object_node or not index_node:
            continue

        array_name = context.text_for_node(object_node)
        index_text = context.text_for_node(index_node)

        # Skip if not a numeric-style index
        if not _is_numeric_index(index_text):
            continue

        # Skip if there's already a bounds check
        if _has_bounds_check(context, array_name, index_text, line_number):
            continue

        # Lower confidence if inside a proper loop
        confidence = 0.75
        if _is_loop_index_access(context, array_name, index_text, line_number):
            confidence = 0.55  # Still flag but lower confidence

        # Higher confidence if error matches bounds error pattern
        if _matches_bounds_error(context.error_message):
            confidence = min(confidence + 0.15, 0.90)

        # Check if accessing property on the result (arr[i].property)
        parent = node.parent
        accessing_property = parent and parent.type == "member_expression"

        message = f"`{array_name}[{index_text}]` - array index `{index_text}` may be out of bounds."
        if accessing_property:
            message = f"`{array_name}[{index_text}]` may be undefined, leading to property access error."
            confidence = min(confidence + 0.05, 0.90)

        metadata = {
            "array": array_name,
            "index": index_text,
            "accessing_property": accessing_property,
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

    return findings


# Backward compatibility - wrapper class for existing code
class ArrayOutOfBoundsRule:
    """Wrapper class for backward compatibility. Delegates to pure function."""
    rule_id = RULE_ID
    title = RULE_TITLE
    severity = RULE_SEVERITY

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        return evaluate_array_out_of_bounds(context)
