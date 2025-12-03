from __future__ import annotations

from typing import Any, Dict, List

from ..base import AnalysisContext, AnalyzerRule


class NullAccessRule(AnalyzerRule):
    rule_id = "NULL_ACCESS"
    title = "Possible null or undefined property access"
    severity = "high"

    def evaluate(self, context: AnalysisContext) -> List[Dict[str, Any]]:
        findings: List[Dict[str, Any]] = []

        for node in context.iter_nodes(["member_expression"]):
            line_number = node.start_point[0] + 1
            if abs(line_number - context.error_line) > 6:
                continue

            object_node = node.child_by_field_name("object")
            property_node = node.child_by_field_name("property")
            if object_node is None or property_node is None:
                continue

            access_text = context.text_for_node(node)
            if "?." in access_text:
                continue

            object_name = context.text_for_node(object_node).strip()
            property_name = context.text_for_node(property_node).strip()
            if not object_name or context.has_guard(object_name, line_number):
                continue

            metadata = {
                "object": object_name,
                "property": property_name,
            }

            message = (
                f"{object_name}.{property_name} is accessed but {object_name} "
                "is never checked for null/undefined nearby."
            )

            findings.append(
                context.build_finding(
                    rule_id=self.rule_id,
                    title=self.title,
                    severity=self.severity,
                    message=message,
                    line_number=line_number,
                    confidence=0.78,
                    metadata=metadata,
                )
            )

            if len(findings) >= 2:
                break

        return findings
