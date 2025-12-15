"""
Memory Leak Rule - Pure Functional Implementation

Detects patterns that may cause memory leaks.
Common patterns:
- Event listeners not removed
- Unclosed resources (streams, connections)
- Circular references
- Large objects in closures
- Timers not cleared
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Set

from ..base import AnalysisContext

# Rule metadata (constants)
RULE_ID = "MEMORY_LEAK"
RULE_TITLE = "Potential memory leak"
RULE_SEVERITY = "medium"

# Error patterns that suggest memory issues
MEMORY_LEAK_PATTERNS = [
    re.compile(r"memory\s*leak", re.IGNORECASE),
    re.compile(r"out\s*of\s*memory", re.IGNORECASE),
    re.compile(r"heap\s*(?:overflow|size|limit)", re.IGNORECASE),
    re.compile(r"allocation\s*failed", re.IGNORECASE),
    re.compile(r"maximum\s*call\s*stack", re.IGNORECASE),
    re.compile(r"too\s*many\s*listeners", re.IGNORECASE),
]

# Event listener methods
EVENT_LISTENER_ADD = {"addEventListener", "on", "once", "addListener", "subscribe"}
EVENT_LISTENER_REMOVE = {"removeEventListener", "off", "removeListener", "unsubscribe", "removeAllListeners"}

# Resource creation patterns
RESOURCE_CREATE = {
    "createReadStream", "createWriteStream", "open", "connect",
    "createConnection", "createServer", "createClient",
    "setInterval", "setTimeout", "requestAnimationFrame",
}

# Resource cleanup patterns
RESOURCE_CLEANUP = {
    "close", "end", "destroy", "disconnect",
    "clearInterval", "clearTimeout", "cancelAnimationFrame",
}


def _matches_memory_error(error_message: str) -> bool:
    """Check if error message suggests memory issue."""
    return any(p.search(error_message) for p in MEMORY_LEAK_PATTERNS)


def _find_event_listener_adds(context: AnalysisContext) -> List[Dict[str, Any]]:
    """Find addEventListener calls and similar patterns."""
    adds = []

    for node in context.iter_nodes(["call_expression"]):
        func_node = node.child_by_field_name("function")
        if not func_node:
            continue

        func_text = context.text_for_node(func_node)
        method_name = func_text.split(".")[-1]

        if method_name in EVENT_LISTENER_ADD:
            line_number = node.start_point[0] + 1
            adds.append({
                "line": line_number,
                "method": method_name,
                "full_text": func_text,
                "node": node,
            })

    return adds


def _find_event_listener_removes(context: AnalysisContext) -> Set[str]:
    """Find removeEventListener calls and extract their targets."""
    removes = set()

    for node in context.iter_nodes(["call_expression"]):
        func_node = node.child_by_field_name("function")
        if not func_node:
            continue

        func_text = context.text_for_node(func_node)
        method_name = func_text.split(".")[-1]

        if method_name in EVENT_LISTENER_REMOVE:
            # Extract the target object
            if "." in func_text:
                target = func_text.rsplit(".", 1)[0]
                removes.add(target)

    return removes


def _find_timer_creates(context: AnalysisContext) -> List[Dict[str, Any]]:
    """Find setInterval/setTimeout without corresponding clear."""
    creates = []

    for node in context.iter_nodes(["call_expression"]):
        func_node = node.child_by_field_name("function")
        if not func_node:
            continue

        func_text = context.text_for_node(func_node)

        if func_text in ("setInterval", "setTimeout"):
            line_number = node.start_point[0] + 1

            # Check if result is assigned
            parent = node.parent
            is_assigned = parent and parent.type in ("variable_declarator", "assignment_expression")

            creates.append({
                "line": line_number,
                "method": func_text,
                "is_assigned": is_assigned,
            })

    return creates


def _find_cleanup_calls(context: AnalysisContext) -> Set[str]:
    """Find cleanup method calls."""
    cleanups = set()

    for node in context.iter_nodes(["call_expression"]):
        func_node = node.child_by_field_name("function")
        if not func_node:
            continue

        func_text = context.text_for_node(func_node)
        method_name = func_text.split(".")[-1]

        if method_name in RESOURCE_CLEANUP:
            cleanups.add(method_name)

    return cleanups


def _check_closure_captures(context: AnalysisContext) -> List[Dict[str, Any]]:
    """Check for potentially problematic closure captures."""
    issues = []

    # Look for closures that capture 'this' or large objects
    for node in context.iter_nodes(["arrow_function", "function"]):
        line_number = node.start_point[0] + 1
        if abs(line_number - context.error_line) > 6:
            continue

        func_text = context.text_for_node(node)

        # Check if closure captures 'this' without cleanup pattern
        if "this." in func_text:
            parent = node.parent
            if parent:
                parent_text = context.text_for_node(parent)
                # Check if this is in an event handler setup
                if any(m in parent_text for m in EVENT_LISTENER_ADD):
                    issues.append({
                        "line": line_number,
                        "type": "closure_captures_this",
                        "code": func_text[:50] + "..." if len(func_text) > 50 else func_text,
                    })

    return issues


def evaluate_memory_leak(context: AnalysisContext) -> List[Dict[str, Any]]:
    """
    Pure function that evaluates code for memory leak patterns.

    Args:
        context: Analysis context containing AST and code segment

    Returns:
        List of findings (deterministic, same input = same output)
    """
    findings: List[Dict[str, Any]] = []

    # Check for event listeners without removal
    listener_adds = _find_event_listener_adds(context)
    listener_remove_targets = _find_event_listener_removes(context)

    for add in listener_adds:
        line_number = add["line"]
        if abs(line_number - context.error_line) > 6:
            continue

        # Check if this target has a corresponding remove
        target = add["full_text"].rsplit(".", 1)[0] if "." in add["full_text"] else "window"

        if target not in listener_remove_targets:
            confidence = 0.65
            if _matches_memory_error(context.error_message):
                confidence = 0.82

            findings.append(
                context.build_finding(
                    rule_id=RULE_ID,
                    title=RULE_TITLE,
                    severity=RULE_SEVERITY,
                    message=f"Event listener added with `{add['method']}` but no corresponding removal found - may cause memory leak.",
                    line_number=line_number,
                    confidence=confidence,
                    metadata={
                        "type": "event_listener_not_removed",
                        "method": add["method"],
                        "target": target,
                    },
                )
            )

        if len(findings) >= 2:
            break

    # Check for timers without clear
    if not findings:
        timer_creates = _find_timer_creates(context)
        cleanup_calls = _find_cleanup_calls(context)

        for timer in timer_creates:
            line_number = timer["line"]
            if abs(line_number - context.error_line) > 6:
                continue

            # setInterval is worse than setTimeout for leaks
            if timer["method"] == "setInterval":
                expected_cleanup = "clearInterval"
            else:
                expected_cleanup = "clearTimeout"

            if expected_cleanup not in cleanup_calls and not timer["is_assigned"]:
                confidence = 0.60
                if timer["method"] == "setInterval":
                    confidence = 0.75  # setInterval is more likely to leak
                if _matches_memory_error(context.error_message):
                    confidence = min(confidence + 0.15, 0.90)

                findings.append(
                    context.build_finding(
                        rule_id=RULE_ID,
                        title=RULE_TITLE,
                        severity=RULE_SEVERITY,
                        message=f"`{timer['method']}` result not stored and no `{expected_cleanup}` found - timer may keep running.",
                        line_number=line_number,
                        confidence=confidence,
                        metadata={
                            "type": "timer_not_cleared",
                            "method": timer["method"],
                            "is_assigned": timer["is_assigned"],
                        },
                    )
                )

            if len(findings) >= 2:
                break

    # Check for closure captures in event handlers
    if not findings:
        closure_issues = _check_closure_captures(context)
        for issue in closure_issues[:2]:
            findings.append(
                context.build_finding(
                    rule_id=RULE_ID,
                    title=RULE_TITLE,
                    severity=RULE_SEVERITY,
                    message="Event handler closure captures `this` - may prevent garbage collection if not removed.",
                    line_number=issue["line"],
                    confidence=0.55,
                    metadata={
                        "type": issue["type"],
                    },
                )
            )

    return findings


# Backward compatibility - wrapper class for existing code
class MemoryLeakRule:
    """Wrapper class for backward compatibility. Delegates to pure function."""
    rule_id = RULE_ID
    title = RULE_TITLE
    severity = RULE_SEVERITY

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        return evaluate_memory_leak(context)
