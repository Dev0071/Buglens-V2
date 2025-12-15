"""
Regex Catastrophic Rule - Pure Functional Implementation

Detects ReDoS (Regular Expression Denial of Service) vulnerable patterns.
These are regex patterns that can cause exponential backtracking.
Common vulnerable patterns:
- Nested quantifiers: (a+)+
- Overlapping alternation: (a|a)+
- Repeated groups with overlap: (a+b)+
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from ..base import AnalysisContext

# Rule metadata (constants)
RULE_ID = "REGEX_CATASTROPHIC"
RULE_TITLE = "Potentially catastrophic regex (ReDoS)"
RULE_SEVERITY = "high"

# Error patterns that suggest regex issues
REGEX_ERROR_PATTERNS = [
    re.compile(r"regex", re.IGNORECASE),
    re.compile(r"regular\s*expression", re.IGNORECASE),
    re.compile(r"timeout", re.IGNORECASE),
    re.compile(r"backtrack", re.IGNORECASE),
    re.compile(r"stack\s*overflow", re.IGNORECASE),
    re.compile(r"maximum.*exceeded", re.IGNORECASE),
]

# Vulnerable regex patterns (simplified detection)
VULNERABLE_PATTERNS = [
    # Nested quantifiers: (a+)+ , (a*)*, (a+)*, etc.
    (re.compile(r"\([^)]*[+*][^)]*\)[+*]"), "nested_quantifier", "Nested quantifier pattern detected (e.g., `(a+)+`) - can cause exponential backtracking."),

    # Overlapping character classes with quantifiers
    (re.compile(r"\[[^\]]*\][+*]\s*\[[^\]]*\][+*]"), "overlapping_classes", "Multiple quantified character classes may overlap - potential ReDoS."),

    # Repeated alternation with similar patterns
    (re.compile(r"\([^)]*\|[^)]*\)[+*]"), "quantified_alternation", "Quantified alternation detected - may cause backtracking if alternatives overlap."),

    # Greedy .* followed by same pattern
    (re.compile(r"\.\*[^?].*\.\*"), "multiple_greedy", "Multiple greedy `.*` patterns may cause excessive backtracking."),

    # Possessive-like patterns that aren't possessive
    (re.compile(r"[+*]{2}"), "double_quantifier", "Double quantifier detected - likely a typo or error."),
]

# Safe patterns that mitigate ReDoS
# Note: $ anchor alone doesn't prevent ReDoS - backtracking still occurs
SAFE_INDICATORS = [
    r"\?\?",  # Non-greedy quantifier ??
    r"\+\?",  # Non-greedy +?
    r"\*\?",  # Non-greedy *?
    # Anchors don't prevent backtracking, so not included
]


def _matches_regex_error(error_message: str) -> bool:
    """Check if error message suggests regex issue."""
    return any(p.search(error_message) for p in REGEX_ERROR_PATTERNS)


def _extract_regex_literals(context: AnalysisContext) -> List[Tuple[str, int, Any]]:
    """Extract regex literals from the code."""
    regexes = []

    # Find regex literals (e.g., /pattern/)
    for node in context.iter_nodes(["regex"]):
        line_number = node.start_point[0] + 1
        regex_text = context.text_for_node(node)
        regexes.append((regex_text, line_number, node))

    # Also find RegExp constructor calls
    for node in context.iter_nodes(["new_expression"]):
        # For new_expression, get the identifier directly
        # The structure is: new_expression -> new, identifier (RegExp), arguments
        constructor_name = None
        for child in node.children:
            if child.type == "identifier":
                constructor_name = context.text_for_node(child)
                break

        if constructor_name == "RegExp":
            args_node = node.child_by_field_name("arguments")
            if args_node:
                # Find the first string argument
                for arg in args_node.children:
                    if arg.type == "string":
                        line_number = node.start_point[0] + 1
                        pattern_text = context.text_for_node(arg)
                        regexes.append((pattern_text, line_number, node))
                        break

    return regexes


def _check_regex_for_redos(pattern: str) -> List[Tuple[str, str, str]]:
    """Check a regex pattern for ReDoS vulnerabilities."""
    vulnerabilities = []

    # Remove regex delimiters if present
    clean_pattern = pattern
    if clean_pattern.startswith("/"):
        # Find the closing /
        end_idx = clean_pattern.rfind("/")
        if end_idx > 0:
            clean_pattern = clean_pattern[1:end_idx]
    elif clean_pattern.startswith(("'", '"')):
        clean_pattern = clean_pattern[1:-1]

    # Skip if pattern has safe indicators
    for safe in SAFE_INDICATORS:
        if re.search(safe, clean_pattern):
            return []  # Pattern has mitigating factors

    # Check against vulnerable patterns
    for vuln_pattern, vuln_type, vuln_message in VULNERABLE_PATTERNS:
        if vuln_pattern.search(clean_pattern):
            vulnerabilities.append((vuln_type, vuln_message, clean_pattern))

    return vulnerabilities


def _has_input_length_check(context: AnalysisContext, line_number: int) -> bool:
    """Check if there's an input length check before regex use."""
    # Look for length checks in preceding lines
    for i in range(max(1, line_number - 5), line_number):
        line = context.get_line(i)
        if re.search(r"\.length\s*[<>]=?\s*\d+", line):
            return True
        if re.search(r"if\s*\(\s*\w+\.length", line):
            return True
    return False


def evaluate_regex_catastrophic(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Pure function that evaluates code for ReDoS-vulnerable regex patterns.

    Args:
        context: Analysis context containing AST and code segment

    Returns:
        List of findings (deterministic, same input = same output)
    """
    findings: List[Dict[str, Any]] = []

    # Extract all regex patterns
    regexes = _extract_regex_literals(context)

    for pattern, line_number, node in regexes:
        if abs(line_number - context.error_line) > 6:
            continue

        # Check for vulnerabilities
        vulnerabilities = _check_regex_for_redos(pattern)

        for vuln_type, vuln_message, clean_pattern in vulnerabilities:
            confidence = 0.70

            # Higher confidence if error suggests regex issue
            if _matches_regex_error(context.error_message):
                confidence = 0.85

            # Lower confidence if there's input length checking
            if _has_input_length_check(context, line_number):
                confidence -= 0.15

            # Skip very short patterns (less likely to be problematic)
            if len(clean_pattern) < 5:
                continue

            findings.append(
                context.build_finding(
                    rule_id=RULE_ID,
                    title=RULE_TITLE,
                    severity=RULE_SEVERITY,
                    message=vuln_message,
                    line_number=line_number,
                    confidence=max(0.45, confidence),
                    metadata={
                        "type": vuln_type,
                        "pattern": clean_pattern[:100],  # Truncate long patterns
                        "original": pattern[:100],
                    },
                )
            )

        if len(findings) >= 2:
            break

    return findings


# Backward compatibility - wrapper class for existing code
class RegexCatastrophicRule:
    """Wrapper class for backward compatibility. Delegates to pure function."""
    rule_id = RULE_ID
    title = RULE_TITLE
    severity = RULE_SEVERITY

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        return evaluate_regex_catastrophic(context)
