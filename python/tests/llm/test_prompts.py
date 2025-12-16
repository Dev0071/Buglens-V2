"""
Tests for LLM prompt building.
"""

import pytest
from llm.prompts import (
    SYSTEM_PROMPT,
    build_user_prompt,
    estimate_prompt_tokens,
    truncate_evidence_for_tokens,
)


class TestSystemPrompt:
    """Tests for system prompt content."""

    def test_system_prompt_exists(self):
        """System prompt should be defined."""
        assert SYSTEM_PROMPT is not None
        assert len(SYSTEM_PROMPT) > 100

    def test_system_prompt_has_schema(self):
        """System prompt should describe JSON schema."""
        assert "JSON" in SYSTEM_PROMPT
        assert "title" in SYSTEM_PROMPT
        assert "root_cause" in SYSTEM_PROMPT
        assert "causal_chain" in SYSTEM_PROMPT
        assert "confidence" in SYSTEM_PROMPT

    def test_system_prompt_has_rules(self):
        """System prompt should include critical rules."""
        assert "CRITICAL RULES" in SYSTEM_PROMPT or "Rules" in SYSTEM_PROMPT
        assert "evidence" in SYSTEM_PROMPT.lower()
        assert "hallucinate" in SYSTEM_PROMPT.lower()


class TestBuildUserPrompt:
    """Tests for user prompt building."""

    @pytest.fixture
    def sample_evidence(self):
        """Sample evidence bundle for testing."""
        return {
            "error": {
                "type": "TypeError",
                "message": "Cannot read property 'name' of undefined",
                "value": "Cannot read property 'name' of undefined at line 42",
                "stack_trace": [
                    {
                        "file": "src/services/user.js",
                        "line": 42,
                        "function": "getUserName",
                        "in_app": True,
                    },
                    {
                        "file": "src/routes/profile.js",
                        "line": 15,
                        "function": "handleProfile",
                        "in_app": True,
                    },
                ],
            },
            "code": {
                "primary": {
                    "file_path": "src/services/user.js",
                    "line_number": 42,
                    "column_number": 10,
                    "snippet": "function getUserName(user) {\n  return user.name;\n}",
                    "snippet_start_line": 40,
                    "snippet_end_line": 45,
                    "language": "javascript",
                },
                "repo": "test-org/test-repo",
                "commit_sha": "abc1234567890",
            },
            "deterministic_findings": [
                {
                    "rule_id": "null-access",
                    "title": "Potential null access",
                    "severity": "high",
                    "confidence": 0.92,
                    "message": "Accessing property 'name' without null check",
                    "location": {
                        "file": "src/services/user.js",
                        "line": 42,
                        "column": 10,
                    },
                    "suggested_fix": "Add null check before accessing property",
                },
            ],
            "timeline": {
                "steps": [
                    {
                        "timestamp": "2024-01-15T14:30:00Z",
                        "type": "http",
                        "message": "GET /api/profile",
                        "level": "info",
                        "is_anomaly": False,
                    },
                    {
                        "timestamp": "2024-01-15T14:30:01Z",
                        "type": "query",
                        "message": "SELECT * FROM users WHERE id = ?",
                        "level": "info",
                        "is_anomaly": False,
                    },
                    {
                        "timestamp": "2024-01-15T14:30:02Z",
                        "type": "error",
                        "message": "TypeError: Cannot read property",
                        "level": "error",
                        "is_anomaly": True,
                    },
                ],
                "anomalies_count": 1,
                "duration_ms": 2000,
            },
            "recent_commits": [
                {
                    "sha": "abc123def456",
                    "short_sha": "abc123d",
                    "message": "Refactor user service\n\nRemoved null checks for performance",
                    "author": {
                        "name": "John Dev",
                        "email": "john@example.com",
                        "date": "2024-01-14T10:00:00Z",
                    },
                    "files_changed": 3,
                    "additions": 50,
                    "deletions": 20,
                },
            ],
            "environment": {
                "environment": "production",
                "release": "1.2.3",
                "browser": {"name": "Chrome", "version": "120"},
                "os": {"name": "macOS", "version": "14.0"},
                "runtime": {"name": "Node.js", "version": "20.0"},
            },
        }

    def test_builds_prompt_with_all_sections(self, sample_evidence):
        """Prompt should include all evidence sections."""
        prompt = build_user_prompt(sample_evidence)

        # Error section
        assert "## ERROR" in prompt
        assert "TypeError" in prompt
        assert "Cannot read property" in prompt

        # Deterministic findings (should be prominent)
        assert "DETERMINISTIC FINDINGS" in prompt
        assert "null-access" in prompt
        assert "HIGH CONFIDENCE" in prompt

        # Code section
        assert "## CODE CONTEXT" in prompt
        assert "src/services/user.js" in prompt

        # Timeline
        assert "## TIMELINE" in prompt

        # Commits
        assert "## RECENT COMMITS" in prompt
        assert "abc123d" in prompt

        # Environment
        assert "## ENVIRONMENT" in prompt or "production" in prompt

    def test_findings_placed_prominently(self, sample_evidence):
        """Deterministic findings should appear before code context."""
        prompt = build_user_prompt(sample_evidence)

        findings_pos = prompt.find("DETERMINISTIC FINDINGS")
        code_pos = prompt.find("## CODE CONTEXT")

        assert findings_pos < code_pos

    def test_empty_evidence_handled(self):
        """Should handle minimal/empty evidence."""
        minimal = {
            "error": {
                "type": "Error",
                "message": "Something broke",
                "stack_trace": [],
            }
        }

        prompt = build_user_prompt(minimal)

        assert "## ERROR" in prompt
        assert "Error" in prompt
        assert "Something broke" in prompt

    def test_no_findings_section_when_empty(self):
        """Should not include findings section if no findings."""
        evidence = {
            "error": {
                "type": "Error",
                "message": "Error",
                "stack_trace": [],
            },
            "deterministic_findings": [],
        }

        prompt = build_user_prompt(evidence)

        assert "DETERMINISTIC FINDINGS" not in prompt

    def test_stack_trace_limited_to_3(self, sample_evidence):
        """Stack trace should be limited to top 3 frames."""
        sample_evidence["error"]["stack_trace"] = [
            {"file": f"file{i}.js", "line": i, "function": f"fn{i}", "in_app": True}
            for i in range(10)
        ]

        prompt = build_user_prompt(sample_evidence)

        # Should only show 3 frames
        assert "file0.js" in prompt
        assert "file1.js" in prompt
        assert "file2.js" in prompt
        assert "file9.js" not in prompt


class TestTokenEstimation:
    """Tests for token estimation."""

    def test_estimate_prompt_tokens(self):
        """Should estimate tokens roughly as chars/4."""
        text = "Hello world, this is a test prompt with some content."
        estimate = estimate_prompt_tokens(text)

        # Should be roughly len/4
        expected = len(text) // 4
        assert estimate == expected

    def test_empty_string(self):
        """Empty string should return 0 tokens."""
        assert estimate_prompt_tokens("") == 0


class TestTruncateEvidence:
    """Tests for evidence truncation."""

    def test_small_evidence_unchanged(self):
        """Small evidence should not be truncated."""
        evidence = {
            "error": {"type": "Error", "message": "Short"},
            "deterministic_findings": [],
        }

        result = truncate_evidence_for_tokens(evidence, max_tokens=10000)

        # Should be essentially unchanged
        assert result["error"]["message"] == "Short"

    def test_timeline_truncated_first(self):
        """Timeline should be truncated to 3 events when too long."""
        evidence = {
            "error": {"type": "Error", "message": "Test" * 1000},
            "deterministic_findings": [],
            "timeline": {
                "steps": [{"timestamp": f"t{i}", "type": "http", "message": f"Step {i}"}
                          for i in range(20)],
                "anomalies_count": 0,
                "duration_ms": 1000,
            },
        }

        result = truncate_evidence_for_tokens(evidence, max_tokens=500)

        # Timeline should be truncated
        assert len(result.get("timeline", {}).get("steps", [])) <= 3

    def test_commits_truncated_second(self):
        """Commits should be truncated after timeline."""
        evidence = {
            "error": {"type": "Error", "message": "Test" * 2000},
            "deterministic_findings": [],
            "timeline": {"steps": [], "anomalies_count": 0, "duration_ms": 0},
            "recent_commits": [
                {"sha": f"sha{i}", "message": f"Commit {i}", "author": {"name": "Dev", "email": "dev@example.com", "date": "2024-01-01"}}
                for i in range(10)
            ],
        }

        result = truncate_evidence_for_tokens(evidence, max_tokens=500)

        # Commits should be truncated
        assert len(result.get("recent_commits", [])) <= 3
