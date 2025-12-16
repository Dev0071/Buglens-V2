"""
LLM orchestrator for RCA generation.

Handles GPT-4o-mini API calls with:
- Cost tracking per request
- Schema validation of responses
- Retry logic for transient failures
- Deterministic fallback when LLM fails
- Token budget management

Entry point: Called via stdin/stdout from Node.js PythonBridge.
"""

import json
import sys
import os
import time
from typing import Dict, Any, Optional
from dataclasses import dataclass, asdict

from .schemas import validate_rca_response, RCAResponse
from .prompts import (
    SYSTEM_PROMPT,
    build_user_prompt,
    estimate_prompt_tokens,
    truncate_evidence_for_tokens,
)


# =============================================================================
# CONFIGURATION
# =============================================================================


@dataclass
class OrchestratorConfig:
    """Configuration for LLM orchestrator."""
    model: str = "gpt-4o-mini"
    temperature: float = 0.1  # Low for consistency
    max_tokens: int = 2000  # Output token limit
    max_input_tokens: int = 4000  # Input token budget
    timeout_seconds: int = 30
    max_retries: int = 2
    retry_delay_seconds: float = 1.0


# GPT-4o-mini pricing (as of Dec 2024)
# Input: $0.15 per 1M tokens, Output: $0.60 per 1M tokens
PRICING = {
    "input_per_token": 0.00000015,
    "output_per_token": 0.0000006,
}


# =============================================================================
# ORCHESTRATOR RESULT
# =============================================================================


@dataclass
class OrchestratorResult:
    """Result from RCA generation."""
    success: bool
    rca: Optional[RCAResponse]
    error: Optional[str]

    # Metadata
    llm_model: str
    llm_tokens_used: int
    llm_input_tokens: int
    llm_output_tokens: int
    llm_cost_usd: float
    processing_time_ms: int

    # Validation
    validation_passed: bool
    validation_errors: list[str]

    # Fallback indicator
    used_fallback: bool

    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dict."""
        return asdict(self)


# =============================================================================
# LLM ORCHESTRATOR
# =============================================================================


class RCAOrchestrator:
    """
    Orchestrates LLM-based RCA generation.

    Key responsibilities:
    1. Build structured prompts from evidence
    2. Call GPT-4o-mini with retries
    3. Validate and parse responses
    4. Track costs per request
    5. Provide deterministic fallback
    """

    def __init__(self, config: Optional[OrchestratorConfig] = None):
        """
        Initialize orchestrator.

        Args:
            config: Optional configuration override
        """
        self.config = config or OrchestratorConfig()
        self._client: Optional[Any] = None

    def _get_client(self):
        """Lazy-load OpenAI client."""
        if self._client is None:
            try:
                from openai import OpenAI
                api_key = os.environ.get("OPENAI_API_KEY")
                if not api_key:
                    raise ValueError("OPENAI_API_KEY environment variable not set")
                self._client = OpenAI(api_key=api_key)
            except ImportError:
                raise ImportError(
                    "openai package not installed. Run: pip install openai"
                )
        return self._client

    def generate_rca(self, evidence: Dict[str, Any]) -> OrchestratorResult:
        """
        Generate RCA from evidence bundle.

        Args:
            evidence: Evidence bundle with error, code, findings, timeline, commits

        Returns:
            OrchestratorResult with RCA or error
        """
        start_time = time.time()

        # Truncate evidence to fit token budget
        truncated = truncate_evidence_for_tokens(
            evidence,
            max_tokens=self.config.max_input_tokens
        )

        # Build prompts
        user_prompt = build_user_prompt(truncated)
        estimated_input = estimate_prompt_tokens(SYSTEM_PROMPT + user_prompt)

        # Try LLM generation with retries
        last_error: Optional[str] = None

        for attempt in range(self.config.max_retries + 1):
            try:
                result = self._call_llm(user_prompt)

                # Calculate processing time
                processing_time_ms = int((time.time() - start_time) * 1000)

                # Add metadata to RCA
                if result.rca:
                    result.rca["llm_model"] = self.config.model
                    result.rca["llm_tokens_used"] = result.llm_tokens_used
                    result.rca["llm_input_tokens"] = result.llm_input_tokens
                    result.rca["llm_output_tokens"] = result.llm_output_tokens
                    result.rca["llm_cost_usd"] = result.llm_cost_usd

                return OrchestratorResult(
                    success=result.success,
                    rca=result.rca,
                    error=result.error,
                    llm_model=self.config.model,
                    llm_tokens_used=result.llm_tokens_used,
                    llm_input_tokens=result.llm_input_tokens,
                    llm_output_tokens=result.llm_output_tokens,
                    llm_cost_usd=result.llm_cost_usd,
                    processing_time_ms=processing_time_ms,
                    validation_passed=result.validation_passed,
                    validation_errors=result.validation_errors,
                    used_fallback=False,
                )

            except Exception as e:
                last_error = str(e)

                # Don't retry on quota errors
                if "quota" in last_error.lower() or "rate" in last_error.lower():
                    break

                # Retry on transient errors
                if attempt < self.config.max_retries:
                    time.sleep(self.config.retry_delay_seconds * (attempt + 1))
                    continue

        # LLM failed - use deterministic fallback
        processing_time_ms = int((time.time() - start_time) * 1000)

        fallback_rca = self._build_deterministic_fallback(evidence)

        return OrchestratorResult(
            success=True,  # Fallback succeeded
            rca=fallback_rca,
            error=f"LLM failed after {self.config.max_retries + 1} attempts: {last_error}. Using deterministic fallback.",
            llm_model="deterministic-fallback",
            llm_tokens_used=0,
            llm_input_tokens=0,
            llm_output_tokens=0,
            llm_cost_usd=0,
            processing_time_ms=processing_time_ms,
            validation_passed=True,  # Fallback is pre-validated
            validation_errors=[],
            used_fallback=True,
        )

    def _call_llm(self, user_prompt: str) -> OrchestratorResult:
        """
        Make LLM API call with validation.

        Args:
            user_prompt: Formatted user prompt

        Returns:
            Result with parsed RCA or error
        """
        client = self._get_client()

        response = client.chat.completions.create(
            model=self.config.model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            temperature=self.config.temperature,
            max_tokens=self.config.max_tokens,
            response_format={"type": "json_object"},
            timeout=self.config.timeout_seconds,
        )

        # Extract usage
        usage = response.usage
        input_tokens = usage.prompt_tokens if usage else 0
        output_tokens = usage.completion_tokens if usage else 0
        total_tokens = usage.total_tokens if usage else 0

        # Calculate cost
        cost_usd = (
            input_tokens * PRICING["input_per_token"] +
            output_tokens * PRICING["output_per_token"]
        )

        # Get response content
        content = response.choices[0].message.content
        if not content:
            return OrchestratorResult(
                success=False,
                rca=None,
                error="Empty response from LLM",
                llm_model=self.config.model,
                llm_tokens_used=total_tokens,
                llm_input_tokens=input_tokens,
                llm_output_tokens=output_tokens,
                llm_cost_usd=cost_usd,
                processing_time_ms=0,
                validation_passed=False,
                validation_errors=["Empty response"],
                used_fallback=False,
            )

        # Validate response
        validation = validate_rca_response(content)

        if not validation.is_valid:
            return OrchestratorResult(
                success=False,
                rca=validation.parsed_data,  # May have partial data
                error=f"Validation failed: {'; '.join(validation.errors)}",
                llm_model=self.config.model,
                llm_tokens_used=total_tokens,
                llm_input_tokens=input_tokens,
                llm_output_tokens=output_tokens,
                llm_cost_usd=cost_usd,
                processing_time_ms=0,
                validation_passed=False,
                validation_errors=validation.errors,
                used_fallback=False,
            )

        return OrchestratorResult(
            success=True,
            rca=validation.parsed_data,
            error=None,
            llm_model=self.config.model,
            llm_tokens_used=total_tokens,
            llm_input_tokens=input_tokens,
            llm_output_tokens=output_tokens,
            llm_cost_usd=cost_usd,
            processing_time_ms=0,
            validation_passed=True,
            validation_errors=[],
            used_fallback=False,
        )

    def _build_deterministic_fallback(
        self,
        evidence: Dict[str, Any]
    ) -> RCAResponse:
        """
        Build RCA from deterministic findings only.

        Used when LLM is unavailable or fails. Provides a basic
        analysis based solely on AST findings and error info.

        Args:
            evidence: Evidence bundle

        Returns:
            Basic RCA response
        """
        error = evidence.get("error", {})
        findings = evidence.get("deterministic_findings", [])
        code = evidence.get("code", {})

        # Build title from error
        error_type = error.get("type", "Error")
        error_msg = error.get("message", "Unknown error")[:80]
        title = f"{error_type}: {error_msg}"

        # Build causal chain from findings
        causal_chain = []
        for finding in findings:
            causal_chain.append({
                "step": finding.get("title", finding.get("rule_id", "Unknown finding")),
                "evidence": f"AST analysis: {finding.get('message', 'No details')}",
                "confidence": finding.get("confidence", 0.7),
            })

        # If no findings, create basic error chain
        if not causal_chain:
            stack = error.get("stack_trace", [])
            if stack:
                frame = stack[0]
                causal_chain.append({
                    "step": f"Error occurred in {frame.get('function', '<anonymous>')}",
                    "evidence": f"Stack trace: {frame.get('file', 'unknown')}:{frame.get('line', '?')}",
                    "confidence": 0.6,
                })
            else:
                causal_chain.append({
                    "step": "Error occurred",
                    "evidence": f"Error message: {error_msg}",
                    "confidence": 0.4,
                })

        # Build summary
        if findings:
            finding_types = [f.get("rule_id", "pattern") for f in findings[:3]]
            summary = f"Deterministic analysis found {len(findings)} issue(s): {', '.join(finding_types)}. LLM analysis unavailable - review findings for details."
        else:
            summary = f"{error_type} occurred. Insufficient evidence for detailed analysis. LLM unavailable."

        # Build root cause from primary finding or error
        if findings:
            primary = findings[0]
            root_cause = primary.get("message", primary.get("title", "See findings for details"))
        else:
            root_cause = f"{error_type}: {error_msg}. Unable to determine specific cause without LLM analysis."

        # Build suggested fix if findings have one
        suggested_fix = None
        for finding in findings:
            if finding.get("suggested_fix"):
                primary_code = code.get("primary", {})
                suggested_fix = {
                    "description": finding["suggested_fix"],
                    "file_path": primary_code.get("file_path"),
                    "patch_description": "Review deterministic finding for specific fix",
                }
                break

        # Calculate confidence (lower without LLM)
        if findings:
            avg_confidence = sum(f.get("confidence", 0.5) for f in findings) / len(findings)
            confidence = min(avg_confidence * 0.8, 0.7)  # Cap at 0.7 for fallback
        else:
            confidence = 0.3

        return {
            "title": title,
            "summary": summary,
            "root_cause": root_cause,
            "causal_chain": causal_chain,
            "suggested_fix": suggested_fix,
            "test_intentions": [],
            "confidence": confidence,
        }


# =============================================================================
# CLI ENTRY POINT (for PythonBridge)
# =============================================================================


def main():
    """
    Entry point for PythonBridge calls.

    Reads evidence from stdin, generates RCA, writes result to stdout.
    """
    try:
        # Read input from stdin
        input_data = sys.stdin.read()
        evidence = json.loads(input_data)

        # Create orchestrator and generate RCA
        orchestrator = RCAOrchestrator()
        result = orchestrator.generate_rca(evidence)

        # Write result to stdout
        output = result.to_dict()
        print(json.dumps(output))

    except json.JSONDecodeError as e:
        error_result = {
            "success": False,
            "error": f"Invalid JSON input: {e}",
            "rca": None,
            "llm_model": "none",
            "llm_tokens_used": 0,
            "llm_input_tokens": 0,
            "llm_output_tokens": 0,
            "llm_cost_usd": 0,
            "processing_time_ms": 0,
            "validation_passed": False,
            "validation_errors": [f"Invalid JSON: {e}"],
            "used_fallback": False,
        }
        print(json.dumps(error_result))
        sys.exit(1)

    except Exception as e:
        import traceback
        error_result = {
            "success": False,
            "error": f"Orchestrator error: {e}",
            "rca": None,
            "llm_model": "none",
            "llm_tokens_used": 0,
            "llm_input_tokens": 0,
            "llm_output_tokens": 0,
            "llm_cost_usd": 0,
            "processing_time_ms": 0,
            "validation_passed": False,
            "validation_errors": [str(e)],
            "used_fallback": False,
        }
        # Log full error to stderr for debugging
        sys.stderr.write(f"LLM Orchestrator error:\n{traceback.format_exc()}\n")
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
