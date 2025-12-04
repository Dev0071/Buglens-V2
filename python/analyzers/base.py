from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterator, List, Optional, Protocol, Sequence
import re

from tree_sitter import Node, Tree


@dataclass
class CodeSegment:
  file_path: str
  language: str
  content: str
  error_line: int
  error_column: Optional[int] = None


class AnalyzerRule(Protocol):
  rule_id: str
  title: str
  severity: str

  def evaluate(self, context: "AnalysisContext") -> List[Dict[str, Any]]:
    ...


class AnalysisContext:
  def __init__(self, segment: CodeSegment, tree: Tree, metadata: Dict[str, Any]):
    self.segment = segment
    self.tree = tree
    self.metadata = metadata
    self.lines = segment.content.splitlines()

  @property
  def error_line(self) -> int:
    return self.segment.error_line

  def iter_nodes(self, types: Sequence[str]) -> Iterator[Node]:
    wanted = set(types)
    stack: List[Node] = [self.tree.root_node]
    while stack:
      node = stack.pop()
      if node.type in wanted:
        yield node
      stack.extend(reversed(node.children))

  def text_for_node(self, node: Node) -> str:
    return self.segment.content[node.start_byte : node.end_byte]

  def get_line(self, line_number: int) -> str:
    if line_number <= 0 or line_number > len(self.lines):
      return ""
    return self.lines[line_number - 1]

  def snippet(self, center_line: int, radius: int = 2) -> str:
    if not self.lines:
      return ""
    start = max(1, center_line - radius)
    end = min(len(self.lines), center_line + radius)
    return "\n".join(self.lines[start - 1 : end])

  def has_guard(self, identifier: str, line_number: int) -> bool:
    if not identifier:
      return False
    root_identifier = re.split(r"[.[]", identifier)[0]
    escaped = re.escape(root_identifier)
    guard_patterns = [
      # if (!x)
      re.compile(rf"if\s*\(\s*!\s*{escaped}\s*\)"),
      # if (x == null) or if (x === null)
      re.compile(rf"if\s*\(\s*{escaped}\s*==+\s*null"),
      # if (x == undefined) or if (x === undefined)
      re.compile(rf"if\s*\(\s*{escaped}\s*==+\s*undefined"),
      # if (null == x) or if (undefined == x)
      re.compile(rf"if\s*\(\s*(null|undefined)\s*==+\s*{escaped}"),
      # if (!x || !x.property)
      re.compile(rf"if\s*\(\s*!\s*{escaped}\s*\|\|"),
      # if (x && x.property)
      re.compile(rf"if\s*\(\s*{escaped}\s*&&"),
      # if (x?.property)
      re.compile(rf"if\s*\(\s*{escaped}\s*\?\.\w+"),
      # x ?? default
      re.compile(rf"{escaped}\s*\?\?"),
      # typeof x !== 'undefined'
      re.compile(rf"typeof\s+{escaped}\s*!==?\s*['\"]undefined['\"]"),
    ]

    start = max(1, line_number - 5)
    for idx in range(start - 1, max(0, line_number - 2)):
      line = self.lines[idx].strip()
      if not line:
        continue
      for pattern in guard_patterns:
        if pattern.search(line):
          return True
    return False

  def build_finding(
    self,
    *,
    rule_id: str,
    title: str,
    severity: str,
    message: str,
    line_number: int,
    confidence: float,
    metadata: Optional[Dict[str, Any]] = None,
  ) -> Dict[str, Any]:
    line_number = max(1, line_number)
    start_line = max(1, line_number - 2)
    end_line = min(len(self.lines) if self.lines else line_number, line_number + 2)
    return {
      "id": rule_id,
      "title": title,
      "severity": severity,
      "confidence": max(0.0, min(1.0, confidence)),
      "message": message,
      "evidence": {
        "file_path": self.segment.file_path,
        "line_number": line_number,
        "snippet": self.snippet(line_number, radius=2),
        "language": self.segment.language,
        "snippet_start_line": start_line,
        "snippet_end_line": end_line,
      },
      "metadata": metadata or {},
    }

