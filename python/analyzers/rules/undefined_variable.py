"""
Undefined Variable Rule - Pure Functional Implementation

Detects references to variables that may not exist in scope.
Common error patterns:
- "X is not defined"
- "ReferenceError: X is not defined"
- "Cannot find name 'X'"
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Set

from ..base import AnalysisContext

# Rule metadata (constants)
RULE_ID = "UNDEFINED_VARIABLE"
RULE_TITLE = "Possible undefined variable reference"
RULE_SEVERITY = "high"

# Error patterns that suggest undefined variable
UNDEFINED_VAR_PATTERNS = [
    re.compile(r"(\w+)\s+is not defined", re.IGNORECASE),
    re.compile(r"ReferenceError:\s*(\w+)", re.IGNORECASE),
    re.compile(r"Cannot find name\s*['\"](\w+)['\"]", re.IGNORECASE),
    re.compile(r"(\w+)\s+is not declared", re.IGNORECASE),
]


def _extract_undefined_var_from_error(error_message: str) -> str | None:
    """Extract the undefined variable name from the error message."""
    for pattern in UNDEFINED_VAR_PATTERNS:
        match = pattern.search(error_message)
        if match:
            return match.group(1)
    return None


def _get_declared_identifiers(context: AnalysisContext) -> Set[str]:
    """Extract all declared variable names from the code."""
    declared: Set[str] = set()

    # Look for variable declarations
    declaration_types = [
        "variable_declarator",
        "lexical_declaration",
        "function_declaration",
        "class_declaration",
        "formal_parameters",
        "parameter",
        "import_specifier",
        "import_clause",
    ]

    for node in context.iter_nodes(declaration_types):
        # Get the identifier name from different declaration types
        if node.type == "variable_declarator":
            name_node = node.child_by_field_name("name")
            if name_node:
                declared.add(context.text_for_node(name_node))
        elif node.type in ("function_declaration", "class_declaration"):
            name_node = node.child_by_field_name("name")
            if name_node:
                declared.add(context.text_for_node(name_node))
        elif node.type == "formal_parameters":
            for child in node.children:
                if child.type == "identifier":
                    declared.add(context.text_for_node(child))
        elif node.type == "parameter":
            for child in node.children:
                if child.type == "identifier":
                    declared.add(context.text_for_node(child))
        elif node.type == "import_specifier":
            name_node = node.child_by_field_name("name") or node.child_by_field_name("alias")
            if name_node:
                declared.add(context.text_for_node(name_node))

    # Add common globals
    declared.update([
        "console", "window", "document", "global", "process",
        "require", "module", "exports", "__dirname", "__filename",
        "setTimeout", "setInterval", "clearTimeout", "clearInterval",
        "Promise", "Array", "Object", "String", "Number", "Boolean",
        "Map", "Set", "WeakMap", "WeakSet", "Symbol", "BigInt",
        "JSON", "Math", "Date", "RegExp", "Error", "TypeError",
        "ReferenceError", "SyntaxError", "RangeError",
        "fetch", "Response", "Request", "Headers", "URL",
        "Buffer", "Uint8Array", "ArrayBuffer",
        "undefined", "null", "NaN", "Infinity",
        "this", "arguments", "super",
    ])

    return declared


def _find_identifier_usages(context: AnalysisContext, target_name: str | None = None) -> List[Any]:
    """Find identifier usages that might be undefined."""
    usages = []

    for node in context.iter_nodes(["identifier"]):
        parent = node.parent

        # Skip if this is the NAME being declared (not the value)
        if parent and parent.type == "variable_declarator":
            # Only skip if this is the name field, not the value
            name_node = parent.child_by_field_name("name")
            if name_node and name_node.id == node.id:
                continue

        # Skip declaration names for other types
        if parent and parent.type in (
            "function_declaration",
            "class_declaration",
            "property_identifier",
            "shorthand_property_identifier",
            "import_specifier",
            "export_specifier",
        ):
            # Check if this is the name field
            name_node = parent.child_by_field_name("name")
            if name_node and name_node.id == node.id:
                continue

        # Skip property names in member expressions
        if parent and parent.type == "member_expression":
            prop_node = parent.child_by_field_name("property")
            if prop_node and prop_node.id == node.id:
                continue

        name = context.text_for_node(node)

        if target_name is None or name == target_name:
            usages.append((node, name))

    return usages


def evaluate_undefined_variable(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Pure function that evaluates code for undefined variable references.

    Args:
        context: Analysis context containing AST and code segment

    Returns:
        List of findings (deterministic, same input = same output)
    """
    findings: List[Dict[str, Any]] = []

    # Try to extract the specific undefined variable from error
    target_var = _extract_undefined_var_from_error(context.error_message)

    # Get all declared identifiers
    declared = _get_declared_identifiers(context)

    # Find usages of potentially undefined variables
    usages = _find_identifier_usages(context, target_var)

    for node, name in usages:
        line_number = node.start_point[0] + 1
        if abs(line_number - context.error_line) > 6:
            continue

        # If error explicitly says this var is not defined, trust it
        # (handles scope issues where var is declared but not accessible)
        if target_var and name == target_var:
            confidence = 0.88
            message = f"`{name}` is not defined - the error confirms this variable doesn't exist."

            # Check if it might be a scope issue (declared elsewhere but not accessible)
            if name in declared:
                message = f"`{name}` is not defined at this location - possibly a scope issue (the variable may be declared in a different block)."
                confidence = 0.85

            metadata = {
                "variable": name,
                "line": line_number,
                "scope_issue": name in declared,
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
            continue

        # Skip if variable is declared (and not the error target)
        if name in declared:
            continue

        # Skip short names that are likely loop vars or intentional
        if len(name) == 1 and name in "ijkxyzabcnm":
            continue

        confidence = 0.70
        message = f"`{name}` is used but may not be defined in scope."

        metadata = {
            "variable": name,
            "line": line_number,
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
class UndefinedVariableRule:
    """Wrapper class for backward compatibility. Delegates to pure function."""
    rule_id = RULE_ID
    title = RULE_TITLE
    severity = RULE_SEVERITY

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        return evaluate_undefined_variable(context)
