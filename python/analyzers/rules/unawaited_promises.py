from __future__ import annotations

from typing import Any, Dict, List

from ..base import AnalysisContext, AnalyzerRule

ASYNC_HINTS = ("fetch", "axios", "request", "client", "query", "prisma", "db", "http")


class UnawaitedPromiseRule(AnalyzerRule):
    rule_id = "UNAWAITED_PROMISE"
    title = "Async call missing await or .catch"
    severity = "medium"

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        findings: List[Dict[str, Any]] = []

        for node in context.iter_nodes(["call_expression"]):
            line_number = node.start_point[0] + 1
            if abs(line_number - context.error_line) > 8:
                continue

            callee = node.child_by_field_name("function")
            if callee is None:
                continue

            callee_text = context.text_for_node(callee)
            if not self._looks_async(callee_text):
                continue

            if self._is_awaited(node):
                continue

            metadata = {"call": callee_text}
            message = f"Call to {callee_text} is not awaited and may resolve after the function returns."

            findings.append(
                context.build_finding(
                    rule_id=self.rule_id,
                    title=self.title,
                    severity=self.severity,
                    message=message,
                    line_number=line_number,
                    confidence=0.62,
                    metadata=metadata,
                )
            )

            if len(findings) >= 2:
                break

        return findings

    def _looks_async(self, callee_text: str) -> bool:
        lowered = callee_text.lower()
        return any(hint in lowered for hint in ASYNC_HINTS)

    def _is_awaited(self, node) -> bool:
        parent = node.parent
        while parent and parent.type in {"expression_statement", "parenthesized_expression"}:
            parent = parent.parent

        if parent and parent.type in {"await_expression", "yield_expression"}:
            return True

        call_parent = parent
        if call_parent and call_parent.type == "call_expression":
            callee = call_parent.child_by_field_name("function")
            if callee and callee.type == "member_expression":
                property_node = callee.child_by_field_name("property")
                if property_node:
                    prop_name = property_node.text.decode('utf-8')
                    if prop_name in {"then", "catch", "finally"}:
                        return True

        return False
