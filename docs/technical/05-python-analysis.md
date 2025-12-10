# 05 - Python Analysis Engine

## Overview

The Python Analysis Engine provides deterministic code analysis using AST (Abstract Syntax Tree) parsing with tree-sitter. This is **Layer 1** of Buglens' analysis - the ground truth that cannot be hallucinated. LLM enhancement (Layer 2) only explains what deterministic analysis finds.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PYTHON ANALYSIS ENGINE                                │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                      ANALYSIS PIPELINE                                  │ │
│  │                                                                         │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐ │ │
│  │  │   Source    │    │    Parse    │    │   Pattern   │    │  Rule    │ │ │
│  │  │    Code     │───▶│    AST      │───▶│   Matcher   │───▶│  Engine  │ │ │
│  │  └─────────────┘    └─────────────┘    └─────────────┘    └──────────┘ │ │
│  │                                                                │        │ │
│  │                                                                ▼        │ │
│  │                                                         ┌──────────┐   │ │
│  │                                                         │ Findings │   │ │
│  │                                                         └──────────┘   │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                       TREE-SITTER PARSERS                               │ │
│  │                                                                         │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────┐  │ │
│  │  │  JavaScript  │  │  TypeScript  │  │    Python    │  │    JSX     │  │ │
│  │  │    Parser    │  │    Parser    │  │    Parser    │  │   Parser   │  │ │
│  │  │ tree-sitter- │  │ tree-sitter- │  │ tree-sitter- │  │ tree-sitter│  │ │
│  │  │  javascript  │  │  typescript  │  │    python    │  │    -tsx    │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └────────────┘  │ │
│  │                                                                         │ │
│  │  Phase 1 (MVP): JavaScript + TypeScript                                │ │
│  │  Phase 2:       Python                                                  │ │
│  │  Phase 3:       Go, Java, Ruby                                          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        RULE CATEGORIES                                  │ │
│  │                                                                         │ │
│  │  Null/Undefined Access       │  Async/Promise Patterns                 │ │
│  │  • Optional chaining missing │  • Unhandled rejections                 │ │
│  │  • Null guard absent         │  • Missing await                        │ │
│  │  • Type narrowing needed     │  • Race conditions                      │ │
│  │                              │                                          │ │
│  │  Type Coercion Issues        │  Array/Object Operations                │ │
│  │  • Loose equality (==)       │  • Index out of bounds                  │ │
│  │  • Implicit conversions      │  • Missing property checks              │ │
│  │  • parseInt without radix    │  • Spread on undefined                  │ │
│  │                              │                                          │ │
│  │  Error Handling              │  AI-Generated Code Signatures           │ │
│  │  • Empty catch blocks        │  • Common ChatGPT patterns              │ │
│  │  • Swallowed errors          │  • Copilot-typical mistakes             │ │
│  │  • Missing finally           │  • LLM hallucination artifacts          │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Files

| File                                  | Purpose                         |
| ------------------------------------- | ------------------------------- |
| `python/analyzers/ast_analyzer.py`    | Core AST analysis orchestrator  |
| `python/analyzers/js_analyzer.py`     | JavaScript/TypeScript analyzer  |
| `python/analyzers/pattern_matcher.py` | Pattern matching utilities      |
| `python/analyzers/rules/`             | Individual rule implementations |
| `python/utils/tree_sitter_utils.py`   | Tree-sitter helper functions    |

---

## Core Analyzer

### AST Analyzer Orchestrator

```python
# python/analyzers/ast_analyzer.py
from dataclasses import dataclass
from typing import List, Optional
import tree_sitter_javascript as ts_javascript
from tree_sitter import Language, Parser

from .rules import (
    evaluate_null_access,
    evaluate_async_patterns,
    evaluate_error_handling,
    evaluate_type_coercion,
    evaluate_array_operations,
    evaluate_ai_signatures,
)

@dataclass
class AnalysisContext:
    """Context passed to all rule evaluators."""
    source_code: str
    ast_tree: 'Tree'
    error_message: str
    error_type: str
    file_path: str
    language: str
    line_number: Optional[int] = None


@dataclass
class Finding:
    """A deterministic finding from AST analysis."""
    rule_id: str
    title: str
    severity: str  # 'high', 'medium', 'low'
    confidence: float  # 0.0 - 1.0
    message: str
    line_start: int
    line_end: int
    column_start: int
    column_end: int
    code_snippet: str
    suggested_fix: Optional[str] = None
    explanation: Optional[str] = None


class ASTAnalyzer:
    """
    Orchestrates AST analysis across multiple rule sets.

    Uses functional rule evaluators for all analysis logic.
    This class only handles orchestration and resource management.
    """

    def __init__(self):
        self.parsers = {}
        self.rules = [
            evaluate_null_access,
            evaluate_async_patterns,
            evaluate_error_handling,
            evaluate_type_coercion,
            evaluate_array_operations,
            evaluate_ai_signatures,
        ]

    def get_parser(self, language: str) -> Parser:
        """Get or create parser for language."""
        if language not in self.parsers:
            if language in ('javascript', 'typescript', 'jsx', 'tsx'):
                lang = Language(ts_javascript.language())
            else:
                raise ValueError(f"Unsupported language: {language}")

            parser = Parser(lang)
            self.parsers[language] = parser

        return self.parsers[language]

    def analyze(
        self,
        source_code: str,
        error_message: str,
        error_type: str,
        file_path: str,
        line_number: Optional[int] = None,
    ) -> List[Finding]:
        """
        Run all deterministic rules against source code.

        Returns findings sorted by confidence (highest first).
        """
        # Detect language from file extension
        language = self._detect_language(file_path)

        # Parse AST
        parser = self.get_parser(language)
        tree = parser.parse(source_code.encode('utf-8'))

        # Build context
        context = AnalysisContext(
            source_code=source_code,
            ast_tree=tree,
            error_message=error_message,
            error_type=error_type,
            file_path=file_path,
            language=language,
            line_number=line_number,
        )

        # Run all rules (functional)
        findings: List[Finding] = []
        for rule_fn in self.rules:
            rule_findings = rule_fn(context)
            findings.extend(rule_findings)

        # Sort by confidence, then severity
        severity_order = {'high': 0, 'medium': 1, 'low': 2}
        findings.sort(
            key=lambda f: (-f.confidence, severity_order.get(f.severity, 3))
        )

        return findings

    def _detect_language(self, file_path: str) -> str:
        """Detect language from file extension."""
        ext_map = {
            '.js': 'javascript',
            '.jsx': 'jsx',
            '.ts': 'typescript',
            '.tsx': 'tsx',
            '.mjs': 'javascript',
            '.cjs': 'javascript',
        }
        for ext, lang in ext_map.items():
            if file_path.endswith(ext):
                return lang
        return 'javascript'  # Default
```

---

## Rule Engine

### Rule Pattern (Functional)

```python
# python/analyzers/rules/null_access.py
"""
Null/undefined access detection rule.

All functions in this module are PURE - output depends only on input.
"""
import re
from typing import List, Dict, Any
from tree_sitter import Node

from ..ast_analyzer import AnalysisContext, Finding

# Constants for rule metadata
RULE_ID = "null-access"
RULE_TITLE = "Potential null/undefined property access"
RULE_SEVERITY = "high"
BASE_CONFIDENCE = 0.85

# Patterns that suggest null access errors
NULL_ACCESS_PATTERNS = [
    re.compile(r"Cannot read propert(?:y|ies) ['\"]?(\w+)['\"]? of (undefined|null)", re.I),
    re.compile(r"(\w+) is not defined", re.I),
    re.compile(r"undefined is not an object", re.I),
    re.compile(r"null is not an object", re.I),
    re.compile(r"TypeError: (\w+)\.(\w+) is not a function", re.I),
]


def evaluate_null_access(context: AnalysisContext) -> List[Finding]:
    """
    Detect potential null/undefined property access patterns.

    @pure - output depends only on input context
    """
    findings = []

    # Check if error message suggests null access
    property_name = _extract_property_from_error(context.error_message)
    if not property_name:
        return findings

    # Find member access expressions in AST
    member_accesses = _find_member_access_nodes(context.ast_tree.root_node)

    for node in member_accesses:
        # Check if this access matches the error
        if not _matches_error_property(node, property_name):
            continue

        # Check if access is unguarded
        if _is_unchecked_access(node, context.ast_tree.root_node):
            finding = _create_finding(node, property_name, context)
            findings.append(finding)

    return findings


def _extract_property_from_error(message: str) -> str | None:
    """Extract property name from error message."""
    for pattern in NULL_ACCESS_PATTERNS:
        match = pattern.search(message)
        if match:
            groups = match.groups()
            # Return the property name (varies by pattern)
            return groups[0] if groups else None
    return None


def _find_member_access_nodes(root: Node) -> List[Node]:
    """Find all member_expression nodes in AST."""
    nodes = []

    def traverse(node: Node):
        if node.type == 'member_expression':
            nodes.append(node)
        for child in node.children:
            traverse(child)

    traverse(root)
    return nodes


def _matches_error_property(node: Node, property_name: str) -> bool:
    """Check if member access matches the error property."""
    # Get property part of member expression (right side)
    property_node = node.child_by_field_name('property')
    if property_node and property_node.text:
        return property_node.text.decode('utf-8') == property_name
    return False


def _is_unchecked_access(node: Node, root: Node) -> bool:
    """
    Check if property access lacks null guard.

    Looks for:
    - Optional chaining (?.)
    - if (x !== null) checks
    - Nullish coalescing (??)
    """
    parent = node.parent

    # Check for optional chaining (already safe)
    if node.type == 'optional_chain_expression':
        return False

    # Check parent chain for guards
    while parent:
        # Inside if condition checking for null
        if parent.type == 'if_statement':
            condition = parent.child_by_field_name('condition')
            if condition and _is_null_check(condition, node):
                return False

        # Ternary with null check
        if parent.type == 'ternary_expression':
            condition = parent.child_by_field_name('condition')
            if condition and _is_null_check(condition, node):
                return False

        # Logical AND short-circuit (x && x.prop)
        if parent.type == 'binary_expression':
            operator = parent.child_by_field_name('operator')
            if operator and operator.text == b'&&':
                left = parent.child_by_field_name('left')
                if left and _references_same_object(left, node):
                    return False

        parent = parent.parent

    return True


def _is_null_check(condition: Node, access: Node) -> bool:
    """Check if condition is a null/undefined check for the accessed object."""
    # Look for patterns like: x !== null, x != null, x !== undefined
    condition_text = condition.text.decode('utf-8') if condition.text else ''

    object_node = access.child_by_field_name('object')
    if not object_node or not object_node.text:
        return False

    object_name = object_node.text.decode('utf-8')

    null_check_patterns = [
        f'{object_name} !== null',
        f'{object_name} !== undefined',
        f'{object_name} != null',
        f'{object_name}',  # Truthy check
    ]

    return any(pattern in condition_text for pattern in null_check_patterns)


def _references_same_object(node: Node, access: Node) -> bool:
    """Check if node references the same object as the member access."""
    object_node = access.child_by_field_name('object')
    if not object_node or not node.text or not object_node.text:
        return False
    return node.text == object_node.text


def _create_finding(
    node: Node,
    property_name: str,
    context: AnalysisContext
) -> Finding:
    """Create a Finding object from AST node."""
    # Get line info
    start_line = node.start_point[0] + 1
    end_line = node.end_point[0] + 1
    start_col = node.start_point[1]
    end_col = node.end_point[1]

    # Extract code snippet
    lines = context.source_code.split('\n')
    snippet_lines = lines[max(0, start_line-2):min(len(lines), end_line+1)]
    code_snippet = '\n'.join(snippet_lines)

    # Adjust confidence based on context
    confidence = BASE_CONFIDENCE
    if context.line_number and abs(context.line_number - start_line) <= 2:
        confidence = min(confidence + 0.1, 1.0)  # Boost if near error line

    return Finding(
        rule_id=RULE_ID,
        title=RULE_TITLE,
        severity=RULE_SEVERITY,
        confidence=confidence,
        message=f"Property '{property_name}' accessed without null check. The object may be null or undefined at runtime.",
        line_start=start_line,
        line_end=end_line,
        column_start=start_col,
        column_end=end_col,
        code_snippet=code_snippet,
        suggested_fix=_generate_fix(node, property_name, context),
        explanation=f"Add optional chaining (?.{property_name}) or a null check before accessing this property.",
    )


def _generate_fix(node: Node, property_name: str, context: AnalysisContext) -> str:
    """Generate suggested code fix."""
    if not node.text:
        return ''

    original = node.text.decode('utf-8')
    object_node = node.child_by_field_name('object')

    if object_node and object_node.text:
        object_name = object_node.text.decode('utf-8')
        return f"{object_name}?.{property_name}"

    return original.replace('.', '?.')
```

### Async Pattern Rule

```python
# python/analyzers/rules/async_patterns.py
"""
Async/Promise pattern detection rule.
"""
import re
from typing import List
from tree_sitter import Node

from ..ast_analyzer import AnalysisContext, Finding

RULE_ID = "async-patterns"
RULE_TITLE = "Async/Promise pattern issue"


def evaluate_async_patterns(context: AnalysisContext) -> List[Finding]:
    """Detect async/promise-related issues."""
    findings = []

    # Check for unhandled promise rejection patterns
    findings.extend(_find_unhandled_promises(context))

    # Check for missing await
    findings.extend(_find_missing_await(context))

    # Check for promise constructor anti-patterns
    findings.extend(_find_promise_constructor_issues(context))

    return findings


def _find_unhandled_promises(context: AnalysisContext) -> List[Finding]:
    """Find promises without .catch() or try/catch."""
    findings = []

    # Look for .then() without .catch()
    call_expressions = _find_nodes_by_type(context.ast_tree.root_node, 'call_expression')

    for node in call_expressions:
        # Check if it's a .then() call
        callee = node.child_by_field_name('function')
        if not callee or callee.type != 'member_expression':
            continue

        property_node = callee.child_by_field_name('property')
        if not property_node or property_node.text != b'then':
            continue

        # Check if there's a subsequent .catch()
        if not _has_catch_handler(node):
            findings.append(Finding(
                rule_id=RULE_ID,
                title="Unhandled Promise rejection",
                severity="medium",
                confidence=0.75,
                message="Promise chain has .then() without .catch(). Unhandled rejections crash Node.js processes.",
                line_start=node.start_point[0] + 1,
                line_end=node.end_point[0] + 1,
                column_start=node.start_point[1],
                column_end=node.end_point[1],
                code_snippet=_extract_snippet(context.source_code, node),
                suggested_fix="Add .catch(error => { /* handle error */ })",
            ))

    return findings


def _find_missing_await(context: AnalysisContext) -> List[Finding]:
    """Find async functions where await may be missing."""
    findings = []

    # Only check if error suggests async issue
    if not _suggests_async_error(context.error_message):
        return findings

    # Find all call expressions in async functions
    async_functions = _find_nodes_by_type(
        context.ast_tree.root_node,
        ['async_function', 'async_arrow_function', 'async_method_definition']
    )

    for async_fn in async_functions:
        # Find calls that might return promises but aren't awaited
        calls = _find_nodes_by_type(async_fn, 'call_expression')

        for call in calls:
            parent = call.parent

            # Check if call is awaited
            if parent and parent.type == 'await_expression':
                continue

            # Check if call looks like it returns a promise
            if _looks_like_async_call(call):
                findings.append(Finding(
                    rule_id=RULE_ID,
                    title="Possible missing await",
                    severity="medium",
                    confidence=0.6,
                    message="Function call may return a Promise but is not awaited. This could cause race conditions or unexpected behavior.",
                    line_start=call.start_point[0] + 1,
                    line_end=call.end_point[0] + 1,
                    column_start=call.start_point[1],
                    column_end=call.end_point[1],
                    code_snippet=_extract_snippet(context.source_code, call),
                    suggested_fix="Add 'await' before the function call",
                ))

    return findings


def _suggests_async_error(message: str) -> bool:
    """Check if error message suggests async issue."""
    async_patterns = [
        r"promise",
        r"async",
        r"await",
        r"undefined is not a function",
        r"\.then is not a function",
    ]
    message_lower = message.lower()
    return any(re.search(p, message_lower) for p in async_patterns)


def _looks_like_async_call(node: Node) -> bool:
    """Heuristic: does this call look like it returns a Promise?"""
    callee = node.child_by_field_name('function')
    if not callee:
        return False

    # Get function name
    name = ''
    if callee.type == 'identifier':
        name = callee.text.decode('utf-8') if callee.text else ''
    elif callee.type == 'member_expression':
        prop = callee.child_by_field_name('property')
        name = prop.text.decode('utf-8') if prop and prop.text else ''

    # Common async function patterns
    async_patterns = [
        'fetch', 'axios', 'request',
        'find', 'findOne', 'findById', 'save', 'create', 'update', 'delete',
        'query', 'execute', 'run',
        'read', 'write', 'readFile', 'writeFile',
        'send', 'post', 'get', 'put', 'patch',
    ]

    return any(p in name.lower() for p in async_patterns)


def _has_catch_handler(then_call: Node) -> bool:
    """Check if .then() is followed by .catch()."""
    parent = then_call.parent

    # Check if this .then() is the object of another member access
    if parent and parent.type == 'member_expression':
        grandparent = parent.parent
        if grandparent and grandparent.type == 'call_expression':
            # Check if the next method is .catch()
            property_node = parent.child_by_field_name('property')
            if property_node and property_node.text == b'catch':
                return True

    return False


def _find_nodes_by_type(root: Node, types) -> List[Node]:
    """Find all nodes of given type(s)."""
    if isinstance(types, str):
        types = [types]

    nodes = []

    def traverse(node: Node):
        if node.type in types:
            nodes.append(node)
        for child in node.children:
            traverse(child)

    traverse(root)
    return nodes


def _extract_snippet(source: str, node: Node, context_lines: int = 1) -> str:
    """Extract code snippet around node."""
    lines = source.split('\n')
    start = max(0, node.start_point[0] - context_lines)
    end = min(len(lines), node.end_point[0] + context_lines + 1)
    return '\n'.join(lines[start:end])
```

---

## AI-Generated Code Detection

```python
# python/analyzers/rules/ai_signatures.py
"""
Detection of common AI-generated code patterns and mistakes.

This is Buglens' competitive moat: catching bugs that LLMs commonly introduce.
"""
import re
from typing import List
from tree_sitter import Node

from ..ast_analyzer import AnalysisContext, Finding

RULE_ID = "ai-generated-pattern"
RULE_TITLE = "AI-generated code pattern"


# Patterns commonly introduced by LLMs
AI_CODE_PATTERNS = {
    # ChatGPT tends to use these placeholder patterns
    'placeholder_comments': [
        re.compile(r'// TODO: implement'),
        re.compile(r'// Add your code here'),
        re.compile(r'// Your implementation'),
        re.compile(r'// Handle error'),
        re.compile(r'// Process the data'),
    ],

    # Copilot common mistakes
    'incorrect_api_usage': [
        re.compile(r'\.map\s*\(\s*async'),  # async in map without Promise.all
        re.compile(r'JSON\.parse\([^)]+\)(?!\s*catch)'),  # unhandled parse errors
    ],

    # Generic LLM hallucinations
    'non_existent_apis': [
        'Array.prototype.flatMap',  # Before Node 11
        'Object.fromEntries',  # Before Node 12
        'Promise.allSettled',  # Before Node 12.9
    ],

    # Overly confident patterns (no error handling)
    'missing_validation': [
        re.compile(r'const\s+\{[^}]+\}\s*=\s*(?:req\.body|request\.body|data)\s*;?\s*$'),
    ],
}


def evaluate_ai_signatures(context: AnalysisContext) -> List[Finding]:
    """Detect patterns commonly produced by AI code generators."""
    findings = []

    # Check for placeholder comments (AI often leaves these)
    findings.extend(_find_placeholder_comments(context))

    # Check for async map without Promise.all
    findings.extend(_find_async_map_issues(context))

    # Check for unhandled JSON.parse
    findings.extend(_find_unhandled_json_parse(context))

    # Check for missing input validation
    findings.extend(_find_missing_validation(context))

    return findings


def _find_placeholder_comments(context: AnalysisContext) -> List[Finding]:
    """Find TODO/placeholder comments left by AI."""
    findings = []

    for i, line in enumerate(context.source_code.split('\n')):
        for pattern in AI_CODE_PATTERNS['placeholder_comments']:
            if pattern.search(line):
                findings.append(Finding(
                    rule_id=RULE_ID,
                    title="AI placeholder comment",
                    severity="low",
                    confidence=0.9,
                    message="This looks like a placeholder comment from AI-generated code. The actual implementation may be missing.",
                    line_start=i + 1,
                    line_end=i + 1,
                    column_start=0,
                    column_end=len(line),
                    code_snippet=line,
                    suggested_fix="Implement the actual logic or remove if not needed",
                ))

    return findings


def _find_async_map_issues(context: AnalysisContext) -> List[Finding]:
    """Find async callbacks in .map() without Promise.all."""
    findings = []

    # Find all .map() calls
    call_expressions = _find_nodes_by_type(context.ast_tree.root_node, 'call_expression')

    for call in call_expressions:
        callee = call.child_by_field_name('function')
        if not callee or callee.type != 'member_expression':
            continue

        prop = callee.child_by_field_name('property')
        if not prop or prop.text != b'map':
            continue

        # Check if callback is async
        arguments = call.child_by_field_name('arguments')
        if not arguments:
            continue

        for arg in arguments.children:
            if arg.type in ('arrow_function', 'function_expression'):
                # Check for async keyword
                if _is_async_function(arg):
                    # Check if wrapped in Promise.all
                    if not _wrapped_in_promise_all(call):
                        findings.append(Finding(
                            rule_id=RULE_ID,
                            title="Async map without Promise.all",
                            severity="high",
                            confidence=0.9,
                            message="Using async function in .map() without Promise.all() returns an array of promises, not resolved values. This is a common AI-generated code mistake.",
                            line_start=call.start_point[0] + 1,
                            line_end=call.end_point[0] + 1,
                            column_start=call.start_point[1],
                            column_end=call.end_point[1],
                            code_snippet=_extract_snippet(context.source_code, call),
                            suggested_fix="Wrap with Promise.all(): await Promise.all(items.map(async item => ...))",
                        ))

    return findings


def _find_unhandled_json_parse(context: AnalysisContext) -> List[Finding]:
    """Find JSON.parse without try/catch."""
    findings = []

    # Only check if error suggests parse issue
    if 'JSON' not in context.error_message and 'parse' not in context.error_message.lower():
        return findings

    call_expressions = _find_nodes_by_type(context.ast_tree.root_node, 'call_expression')

    for call in call_expressions:
        callee = call.child_by_field_name('function')
        if not callee or callee.type != 'member_expression':
            continue

        # Check for JSON.parse
        obj = callee.child_by_field_name('object')
        prop = callee.child_by_field_name('property')

        if not obj or not prop:
            continue

        if obj.text == b'JSON' and prop.text == b'parse':
            # Check if inside try block
            if not _is_inside_try_block(call):
                findings.append(Finding(
                    rule_id=RULE_ID,
                    title="Unhandled JSON.parse",
                    severity="medium",
                    confidence=0.85,
                    message="JSON.parse can throw on invalid JSON. AI-generated code often omits error handling.",
                    line_start=call.start_point[0] + 1,
                    line_end=call.end_point[0] + 1,
                    column_start=call.start_point[1],
                    column_end=call.end_point[1],
                    code_snippet=_extract_snippet(context.source_code, call),
                    suggested_fix="Wrap in try/catch: try { JSON.parse(str) } catch (e) { /* handle invalid JSON */ }",
                ))

    return findings


def _find_missing_validation(context: AnalysisContext) -> List[Finding]:
    """Find request body destructuring without validation."""
    findings = []

    # Look for object pattern in variable declarator with req.body
    variable_declarators = _find_nodes_by_type(
        context.ast_tree.root_node, 'variable_declarator'
    )

    for decl in variable_declarators:
        name = decl.child_by_field_name('name')
        value = decl.child_by_field_name('value')

        if not name or not value:
            continue

        # Check if destructuring from request body
        if name.type == 'object_pattern':
            value_text = value.text.decode('utf-8') if value.text else ''
            if any(pattern in value_text for pattern in ['req.body', 'request.body', 'ctx.body']):
                findings.append(Finding(
                    rule_id=RULE_ID,
                    title="Missing input validation",
                    severity="medium",
                    confidence=0.7,
                    message="Destructuring request body without validation. AI often generates code that trusts user input.",
                    line_start=decl.start_point[0] + 1,
                    line_end=decl.end_point[0] + 1,
                    column_start=decl.start_point[1],
                    column_end=decl.end_point[1],
                    code_snippet=_extract_snippet(context.source_code, decl),
                    suggested_fix="Add validation with Zod, Joi, or manual checks before using request data",
                ))

    return findings


def _is_async_function(node: Node) -> bool:
    """Check if function node is async."""
    # Check for 'async' keyword
    for child in node.children:
        if child.type == 'async':
            return True
    return False


def _wrapped_in_promise_all(map_call: Node) -> bool:
    """Check if .map() call is wrapped in Promise.all()."""
    parent = map_call.parent
    while parent:
        if parent.type == 'call_expression':
            callee = parent.child_by_field_name('function')
            if callee and callee.type == 'member_expression':
                obj = callee.child_by_field_name('object')
                prop = callee.child_by_field_name('property')
                if obj and prop:
                    if obj.text == b'Promise' and prop.text in (b'all', b'allSettled'):
                        return True
        parent = parent.parent
    return False


def _is_inside_try_block(node: Node) -> bool:
    """Check if node is inside a try block."""
    parent = node.parent
    while parent:
        if parent.type == 'try_statement':
            return True
        parent = parent.parent
    return False


def _find_nodes_by_type(root: Node, types) -> List[Node]:
    """Find all nodes of given type(s)."""
    if isinstance(types, str):
        types = [types]
    nodes = []
    def traverse(node: Node):
        if node.type in types:
            nodes.append(node)
        for child in node.children:
            traverse(child)
    traverse(root)
    return nodes


def _extract_snippet(source: str, node: Node, context_lines: int = 1) -> str:
    """Extract code snippet around node."""
    lines = source.split('\n')
    start = max(0, node.start_point[0] - context_lines)
    end = min(len(lines), node.end_point[0] + context_lines + 1)
    return '\n'.join(lines[start:end])
```

---

## Node.js Bridge

### Calling Python from Node.js

```typescript
// src/services/python-bridge.ts
import { spawn, ChildProcess } from "child_process";

export interface AnalysisRequest {
  sourceCode: string;
  errorMessage: string;
  errorType: string;
  filePath: string;
  lineNumber?: number;
}

export interface AnalysisResult {
  findings: Finding[];
  parseErrors?: string[];
  executionTimeMs: number;
}

export class PythonBridge {
  private pythonPath: string;
  private modulePath: string;

  constructor(options: { pythonPath?: string; modulePath?: string } = {}) {
    this.pythonPath = options.pythonPath || "python3";
    this.modulePath = options.modulePath || "./python";
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResult> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const process = spawn(
        this.pythonPath,
        ["-m", "analyzers.ast_analyzer", "--json"],
        {
          cwd: this.modulePath,
          env: { ...process.env, PYTHONPATH: this.modulePath },
        }
      );

      let stdout = "";
      let stderr = "";

      process.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      process.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      // Send request as JSON to stdin
      process.stdin.write(JSON.stringify(request));
      process.stdin.end();

      process.on("close", (code) => {
        const executionTimeMs = Date.now() - startTime;

        if (code !== 0) {
          reject(new Error(`Python analyzer failed: ${stderr}`));
          return;
        }

        try {
          const result = JSON.parse(stdout);
          resolve({
            ...result,
            executionTimeMs,
          });
        } catch (parseError) {
          reject(new Error(`Failed to parse Python output: ${stdout}`));
        }
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        process.kill();
        reject(new Error("Python analyzer timeout"));
      }, 30000);
    });
  }
}
```

---

## Testing

```python
# tests/unit/test_null_access_rule.py
import pytest
from python.analyzers.ast_analyzer import ASTAnalyzer

@pytest.fixture
def analyzer():
    return ASTAnalyzer()

def test_detects_null_access_without_guard(analyzer):
    source = """
const user = await db.findUser(id);
console.log(user.name);  // No null check!
"""
    findings = analyzer.analyze(
        source_code=source,
        error_message="Cannot read property 'name' of undefined",
        error_type="TypeError",
        file_path="test.js",
        line_number=3,
    )

    assert len(findings) >= 1
    assert findings[0].rule_id == "null-access"
    assert findings[0].confidence >= 0.8

def test_ignores_optional_chaining(analyzer):
    source = """
const user = await db.findUser(id);
console.log(user?.name);  // Safe!
"""
    findings = analyzer.analyze(
        source_code=source,
        error_message="Cannot read property 'name' of undefined",
        error_type="TypeError",
        file_path="test.js",
    )

    # Should NOT find issues (optional chaining is safe)
    null_access_findings = [f for f in findings if f.rule_id == "null-access"]
    assert len(null_access_findings) == 0

def test_detects_async_map_without_promise_all(analyzer):
    source = """
const results = items.map(async item => {
    return await processItem(item);
});
"""
    findings = analyzer.analyze(
        source_code=source,
        error_message="results[0].then is not a function",
        error_type="TypeError",
        file_path="test.js",
    )

    ai_findings = [f for f in findings if f.rule_id == "ai-generated-pattern"]
    assert any("Promise.all" in f.message for f in ai_findings)
```

---

## Configuration

```yaml
# python/config/analyzer_config.yaml
rules:
  null-access:
    enabled: true
    severity: high
    confidence_threshold: 0.7

  async-patterns:
    enabled: true
    severity: medium
    confidence_threshold: 0.6

  ai-generated-pattern:
    enabled: true
    severity: medium
    confidence_threshold: 0.7

  error-handling:
    enabled: true
    severity: medium
    confidence_threshold: 0.65

  type-coercion:
    enabled: true
    severity: low
    confidence_threshold: 0.6

parsing:
  timeout_ms: 10000
  max_file_size_kb: 500

output:
  max_findings: 20
  include_snippets: true
  snippet_context_lines: 2
```
