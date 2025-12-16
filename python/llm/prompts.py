"""
LLM prompt templates for RCA generation.

Key design principles:
1. Evidence-first: LLM sees structured evidence, not raw logs
2. Deterministic anchoring: Reference AST findings prominently
3. Schema enforcement: Clear JSON output requirements
4. Cost control: Concise prompts to minimize tokens
"""

from typing import List, Dict, Any, Optional


# =============================================================================
# SYSTEM PROMPT
# =============================================================================


SYSTEM_PROMPT = """You are an expert debugging assistant analyzing production errors.

Your output MUST be valid JSON matching this exact schema:
{
  "title": "Brief error title (max 100 chars)",
  "summary": "2-3 sentence overview of what happened",
  "root_cause": "Specific root cause based on evidence",
  "causal_chain": [
    {
      "step": "What happened at this step",
      "evidence": "Specific reference: file:line, log entry, or commit hash",
      "confidence": 0.85
    }
  ],
  "suggested_fix": {
    "description": "What to fix and why",
    "file_path": "path/to/file.js",
    "patch_description": "Human-readable description of the code change"
  },
  "test_intentions": [
    {
      "description": "Test to add",
      "rationale": "Why it prevents recurrence"
    }
  ],
  "confidence": 0.85
}

CRITICAL RULES:
1. Every claim MUST reference specific evidence (file:line, log timestamp, commit SHA)
2. The DETERMINISTIC FINDINGS section contains HIGH-CONFIDENCE AST analysis - trust these findings
3. If uncertain, lower your confidence score - DO NOT GUESS
4. Never hallucinate: if evidence doesn't support a claim, state "insufficient data"
5. Be specific: include variable names, function names, exact line numbers
6. Focus on the DIRECT root cause, not symptoms

EVIDENCE TRUST HIERARCHY (most to least trusted):
1. DETERMINISTIC FINDINGS - AST analysis, pattern matches (trust these most)
2. Stack trace - exact error location
3. Code context - surrounding code at error location
4. Recent commits - code changes that might have caused the bug
5. Timeline - user actions before the error (context only)

Your analysis should synthesize ALL evidence sources but give highest weight to deterministic findings."""


# =============================================================================
# PROMPT BUILDER
# =============================================================================


def build_user_prompt(evidence: Dict[str, Any]) -> str:
    """
    Build evidence-rich user prompt from evidence bundle.

    Structures the evidence to maximize LLM understanding while
    minimizing token count. Deterministic findings are prominently
    placed to anchor the analysis.

    Args:
        evidence: Evidence bundle dict with error, code, findings, timeline, commits

    Returns:
        Formatted prompt string
    """
    sections = []

    # 1. Error information (REQUIRED)
    error_section = _format_error_section(evidence.get("error", {}))
    sections.append(error_section)

    # 2. DETERMINISTIC FINDINGS (CRITICAL - placed early for emphasis)
    findings_section = _format_findings_section(
        evidence.get("deterministic_findings", [])
    )
    if findings_section:
        sections.append(findings_section)

    # 3. Code context
    code_section = _format_code_section(evidence.get("code", {}))
    if code_section:
        sections.append(code_section)

    # 4. Timeline (last 5 events)
    timeline_section = _format_timeline_section(evidence.get("timeline"))
    if timeline_section:
        sections.append(timeline_section)

    # 5. Recent commits
    commits_section = _format_commits_section(evidence.get("recent_commits", []))
    if commits_section:
        sections.append(commits_section)

    # 6. Environment context
    env_section = _format_environment_section(evidence.get("environment", {}))
    if env_section:
        sections.append(env_section)

    # 7. Instruction footer
    sections.append("Provide root cause analysis in JSON format following the schema exactly.")

    return "\n\n".join(sections)


def _format_error_section(error: Dict[str, Any]) -> str:
    """Format error information section."""
    error_type = error.get("type", "Error")
    message = error.get("message", "Unknown error")
    value = error.get("value", message)

    lines = [
        "## ERROR",
        f"Type: {error_type}",
        f"Message: {message}",
    ]

    if value and value != message:
        lines.append(f"Details: {value}")

    # Stack trace (top 3 frames)
    stack = error.get("stack_trace", [])
    if stack:
        lines.append("\nStack Trace (top 3 frames):")
        for i, frame in enumerate(stack[:3]):
            file_path = frame.get("file", "unknown")
            line = frame.get("line")
            func = frame.get("function", "<anonymous>")
            in_app = "✓" if frame.get("in_app", True) else "○"

            line_str = f":{line}" if line else ""
            lines.append(f"  {i+1}. {in_app} {file_path}{line_str} in {func}")

    return "\n".join(lines)


def _format_findings_section(findings: List[Dict[str, Any]]) -> Optional[str]:
    """
    Format deterministic findings section.

    This is the MOST IMPORTANT section - AST analysis results that
    the LLM should trust and reference.
    """
    if not findings:
        return None

    lines = [
        "## DETERMINISTIC FINDINGS (HIGH CONFIDENCE)",
        "These are verified through AST analysis. Trust these findings.",
        ""
    ]

    for i, finding in enumerate(findings, 1):
        rule_id = finding.get("rule_id", "unknown")
        title = finding.get("title", "Unknown finding")
        severity = finding.get("severity", "medium")
        confidence = finding.get("confidence", 0.8)
        message = finding.get("message", "")
        location = finding.get("location", {})

        # Format location
        file_path = location.get("file", "")
        line = location.get("line")
        col = location.get("column")
        loc_str = file_path
        if line:
            loc_str += f":{line}"
            if col:
                loc_str += f":{col}"

        lines.append(f"### Finding {i}: {title}")
        lines.append(f"- Rule: {rule_id}")
        lines.append(f"- Severity: {severity.upper()}")
        lines.append(f"- Confidence: {confidence:.0%}")
        if loc_str:
            lines.append(f"- Location: {loc_str}")
        if message:
            lines.append(f"- Details: {message}")

        # Suggested fix if present
        fix = finding.get("suggested_fix")
        if fix:
            lines.append(f"- Suggested Fix: {fix}")

        lines.append("")

    return "\n".join(lines)


def _format_code_section(code: Dict[str, Any]) -> Optional[str]:
    """Format code context section."""
    primary = code.get("primary")
    if not primary:
        return None

    file_path = primary.get("file_path", "unknown")
    line_number = primary.get("line_number", 0)
    language = primary.get("language", "")
    snippet = primary.get("snippet", "")
    snippet_start = primary.get("snippet_start_line", line_number - 5)

    if not snippet:
        return None

    repo = code.get("repo", "")
    commit = code.get("commit_sha", "")[:7] if code.get("commit_sha") else ""

    lines = [
        "## CODE CONTEXT",
        f"File: {file_path}",
        f"Error Line: {line_number}",
    ]

    if repo:
        lines.append(f"Repository: {repo}")
    if commit:
        lines.append(f"Commit: {commit}")
    if language:
        lines.append(f"Language: {language}")

    # Format code with line numbers
    lines.append("")
    lines.append(f"```{language}")

    for i, code_line in enumerate(snippet.split("\n")):
        actual_line = snippet_start + i
        marker = ">>>" if actual_line == line_number else "   "
        lines.append(f"{marker} {actual_line:4d} | {code_line}")

    lines.append("```")

    return "\n".join(lines)


def _format_timeline_section(timeline: Optional[Dict[str, Any]]) -> Optional[str]:
    """Format timeline section (last 5 events)."""
    if not timeline:
        return None

    steps = timeline.get("steps", [])
    if not steps:
        return None

    # Take last 5 steps
    recent_steps = steps[-5:]

    anomalies = timeline.get("anomalies_count", 0)
    duration = timeline.get("duration_ms", 0)

    lines = [
        "## TIMELINE (last 5 events before error)",
    ]

    if anomalies > 0:
        lines.append(f"⚠️ {anomalies} anomalies detected")
    if duration > 0:
        lines.append(f"Session duration: {duration}ms")

    lines.append("")

    for step in recent_steps:
        ts = step.get("timestamp", "")
        step_type = step.get("type", "default")
        message = step.get("message", "")
        level = step.get("level", "info")
        is_anomaly = step.get("is_anomaly", False)

        # Format timestamp (just time portion if full ISO)
        time_str = ts.split("T")[-1].split(".")[0] if "T" in ts else ts

        icon = "🔴" if level == "error" else "⚠️" if is_anomaly else "○"
        lines.append(f"  {icon} [{time_str}] [{step_type}] {message}")

    return "\n".join(lines)


def _format_commits_section(commits: List[Dict[str, Any]]) -> Optional[str]:
    """Format recent commits section."""
    if not commits:
        return None

    # Take last 5 commits
    recent_commits = commits[:5]

    lines = [
        "## RECENT COMMITS (that might have caused this bug)",
        ""
    ]

    for commit in recent_commits:
        sha = commit.get("short_sha", commit.get("sha", "")[:7])
        message = commit.get("message", "").split("\n")[0]  # First line only
        author = commit.get("author", {})
        author_name = author.get("name", "unknown")
        date = author.get("date", "")

        # Parse date to just the date portion
        date_str = date.split("T")[0] if "T" in date else date

        files_changed = commit.get("files_changed", 0)
        additions = commit.get("additions", 0)
        deletions = commit.get("deletions", 0)

        stat_str = ""
        if files_changed:
            stat_str = f" ({files_changed} files, +{additions}/-{deletions})"

        lines.append(f"- [{sha}] {message}")
        lines.append(f"  by {author_name} on {date_str}{stat_str}")

    return "\n".join(lines)


def _format_environment_section(env: Dict[str, Any]) -> Optional[str]:
    """Format environment context section."""
    if not env:
        return None

    environment = env.get("environment")
    release = env.get("release")
    browser = env.get("browser", {})
    os_info = env.get("os", {})
    runtime = env.get("runtime", {})

    parts = []

    if environment:
        parts.append(f"Environment: {environment}")
    if release:
        parts.append(f"Release: {release}")

    if browser and browser.get("name"):
        b = f"{browser.get('name', '')} {browser.get('version', '')}".strip()
        if b:
            parts.append(f"Browser: {b}")

    if os_info and os_info.get("name"):
        o = f"{os_info.get('name', '')} {os_info.get('version', '')}".strip()
        if o:
            parts.append(f"OS: {o}")

    if runtime and runtime.get("name"):
        r = f"{runtime.get('name', '')} {runtime.get('version', '')}".strip()
        if r:
            parts.append(f"Runtime: {r}")

    if not parts:
        return None

    return "## ENVIRONMENT\n" + "\n".join(f"- {p}" for p in parts)


# =============================================================================
# PROMPT ESTIMATION
# =============================================================================


def estimate_prompt_tokens(prompt: str) -> int:
    """
    Estimate token count for a prompt.

    Uses a rough approximation: ~4 characters per token.
    This is conservative for English text with code.

    Args:
        prompt: The prompt string

    Returns:
        Estimated token count
    """
    # Rough estimation: 4 characters per token
    # This tends to overestimate which is safer for cost control
    return len(prompt) // 4


def truncate_evidence_for_tokens(
    evidence: Dict[str, Any],
    max_tokens: int = 3000
) -> Dict[str, Any]:
    """
    Truncate evidence to fit within token budget.

    Prioritizes:
    1. Error info (always keep)
    2. Deterministic findings (always keep)
    3. Primary code context (always keep)
    4. Timeline (truncate to last 3)
    5. Commits (truncate to last 3)

    Args:
        evidence: Evidence bundle
        max_tokens: Maximum token budget for user prompt

    Returns:
        Truncated evidence bundle
    """
    result = dict(evidence)

    # Build prompt and check size
    prompt = build_user_prompt(result)
    estimated = estimate_prompt_tokens(prompt)

    if estimated <= max_tokens:
        return result

    # First: truncate timeline to 3 events
    if result.get("timeline") and result["timeline"].get("steps"):
        result["timeline"] = dict(result["timeline"])
        result["timeline"]["steps"] = result["timeline"]["steps"][-3:]

        prompt = build_user_prompt(result)
        estimated = estimate_prompt_tokens(prompt)
        if estimated <= max_tokens:
            return result

    # Second: truncate commits to 3
    if result.get("recent_commits"):
        result["recent_commits"] = result["recent_commits"][:3]

        prompt = build_user_prompt(result)
        estimated = estimate_prompt_tokens(prompt)
        if estimated <= max_tokens:
            return result

    # Third: truncate code snippet
    if result.get("code", {}).get("primary", {}).get("snippet"):
        code = dict(result.get("code", {}))
        primary = dict(code.get("primary", {}))
        snippet = primary.get("snippet", "")
        lines = snippet.split("\n")

        # Keep only 10 lines around error
        if len(lines) > 10:
            primary["snippet"] = "\n".join(lines[:10])
            code["primary"] = primary
            result["code"] = code

    return result
