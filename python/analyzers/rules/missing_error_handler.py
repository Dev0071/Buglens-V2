from __future__ import annotations

from typing import Any, Dict, List

from ..base import AnalysisContext, AnalyzerRule


class MissingErrorHandlerRule(AnalyzerRule):
    rule_id = "MISSING_ERROR_HANDLER"
    title = "Try block missing catch"
    severity = "medium"

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
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
                    rule_id=self.rule_id,
                    title=self.title,
                    severity=self.severity,
                    message=message,
                    line_number=start_line,
                    confidence=0.55,
                    metadata={"range": f"{start_line}-{end_line}"},
                )
            )

            if len(findings) >= 1:
                break

        return findings
