"""
RCA response schema and validation.

Enforces strict schema validation on LLM responses to ensure:
1. Consistent output format
2. Every claim references evidence
3. Confidence scores are bounded
4. Required fields are present

Schema follows the deterministic-first principle:
- LLM output MUST reference deterministic findings
- Unsupported claims result in lower confidence
"""

from typing import TypedDict, List, Optional, Any
import json
from dataclasses import dataclass


# =============================================================================
# TYPE DEFINITIONS
# =============================================================================


class CausalStep(TypedDict):
    """A single step in the causal chain with evidence reference."""
    step: str  # What happened
    evidence: str  # Specific reference (line number, log entry, commit hash)
    confidence: float  # 0.0 to 1.0


class SuggestedFix(TypedDict, total=False):
    """Suggested code fix with justification."""
    description: str  # What to fix and why
    file_path: Optional[str]  # Path to the file to modify
    patch_description: str  # Human-readable description of the change


class TestIntention(TypedDict):
    """Test case to prevent recurrence."""
    description: str  # What the test should verify
    rationale: str  # Why this test prevents the issue


class RCAResponse(TypedDict, total=False):
    """Complete RCA response from LLM."""
    title: str  # Brief error title (max 100 chars)
    summary: str  # 2-3 sentence overview
    root_cause: str  # Specific root cause based on evidence
    causal_chain: List[CausalStep]  # Chain of events leading to error
    suggested_fix: Optional[SuggestedFix]  # How to fix the issue
    test_intentions: Optional[List[TestIntention]]  # Tests to add
    confidence: float  # Overall confidence (0.0 to 1.0)
    # Metadata added by orchestrator
    llm_model: Optional[str]
    llm_tokens_used: Optional[int]
    llm_input_tokens: Optional[int]
    llm_output_tokens: Optional[int]
    llm_cost_usd: Optional[float]


# =============================================================================
# JSON SCHEMA FOR VALIDATION
# =============================================================================


RCA_JSON_SCHEMA = {
    "type": "object",
    "required": ["title", "summary", "root_cause", "causal_chain", "confidence"],
    "properties": {
        "title": {
            "type": "string",
            "maxLength": 200,
            "description": "Brief error title"
        },
        "summary": {
            "type": "string",
            "maxLength": 1000,
            "description": "2-3 sentence overview of the error"
        },
        "root_cause": {
            "type": "string",
            "maxLength": 2000,
            "description": "Specific root cause based on evidence"
        },
        "causal_chain": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["step", "evidence", "confidence"],
                "properties": {
                    "step": {
                        "type": "string",
                        "description": "What happened at this step"
                    },
                    "evidence": {
                        "type": "string",
                        "description": "Specific evidence reference (line number, log, commit)"
                    },
                    "confidence": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                        "description": "Confidence in this step (0.0 to 1.0)"
                    }
                }
            },
            "minItems": 1,
            "maxItems": 10,
            "description": "Chain of events leading to the error"
        },
        "suggested_fix": {
            "type": "object",
            "required": ["description"],
            "properties": {
                "description": {
                    "type": "string",
                    "description": "What to fix and why"
                },
                "file_path": {
                    "type": ["string", "null"],
                    "description": "Path to the file to modify"
                },
                "patch_description": {
                    "type": "string",
                    "description": "Human-readable description of the change"
                }
            }
        },
        "test_intentions": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["description", "rationale"],
                "properties": {
                    "description": {
                        "type": "string",
                        "description": "What the test should verify"
                    },
                    "rationale": {
                        "type": "string",
                        "description": "Why this test prevents recurrence"
                    }
                }
            },
            "maxItems": 5,
            "description": "Tests to add to prevent recurrence"
        },
        "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Overall confidence in the analysis (0.0 to 1.0)"
        }
    },
    "additionalProperties": False
}


# =============================================================================
# SCHEMA VALIDATION
# =============================================================================


@dataclass
class ValidationResult:
    """Result of schema validation."""
    is_valid: bool
    errors: List[str]
    parsed_data: Optional[RCAResponse]


def validate_rca_response(response_text: str) -> ValidationResult:
    """
    Validate LLM response against RCA schema.

    Uses jsonschema for validation with detailed error messages.

    Args:
        response_text: Raw JSON string from LLM

    Returns:
        ValidationResult with parsed data if valid, errors otherwise
    """
    try:
        import jsonschema
    except ImportError:
        # Fallback validation without jsonschema
        return _validate_without_jsonschema(response_text)

    errors: List[str] = []

    # Step 1: Parse JSON
    try:
        data = json.loads(response_text)
    except json.JSONDecodeError as e:
        return ValidationResult(
            is_valid=False,
            errors=[f"Invalid JSON: {e}"],
            parsed_data=None
        )

    # Step 2: Schema validation
    try:
        jsonschema.validate(instance=data, schema=RCA_JSON_SCHEMA)
    except jsonschema.ValidationError as e:
        errors.append(f"Schema validation failed: {e.message}")
        # Continue to collect more errors
    except jsonschema.SchemaError as e:
        errors.append(f"Schema error (internal): {e.message}")
        return ValidationResult(is_valid=False, errors=errors, parsed_data=None)

    # Step 3: Business rule validation
    business_errors = _validate_business_rules(data)
    errors.extend(business_errors)

    if errors:
        return ValidationResult(
            is_valid=False,
            errors=errors,
            parsed_data=data  # Return partial data for debugging
        )

    return ValidationResult(
        is_valid=True,
        errors=[],
        parsed_data=data
    )


def _validate_without_jsonschema(response_text: str) -> ValidationResult:
    """Fallback validation when jsonschema is not available."""
    errors: List[str] = []

    try:
        data = json.loads(response_text)
    except json.JSONDecodeError as e:
        return ValidationResult(
            is_valid=False,
            errors=[f"Invalid JSON: {e}"],
            parsed_data=None
        )

    # Check required fields
    required = ["title", "summary", "root_cause", "causal_chain", "confidence"]
    for field in required:
        if field not in data:
            errors.append(f"Missing required field: {field}")

    # Validate confidence range
    if "confidence" in data:
        conf = data["confidence"]
        if not isinstance(conf, (int, float)) or conf < 0 or conf > 1:
            errors.append(f"confidence must be between 0 and 1, got: {conf}")

    # Validate causal_chain structure
    if "causal_chain" in data:
        chain = data["causal_chain"]
        if not isinstance(chain, list) or len(chain) == 0:
            errors.append("causal_chain must be a non-empty array")
        else:
            for i, step in enumerate(chain):
                if not isinstance(step, dict):
                    errors.append(f"causal_chain[{i}] must be an object")
                    continue
                for field in ["step", "evidence", "confidence"]:
                    if field not in step:
                        errors.append(f"causal_chain[{i}] missing required field: {field}")

    # Business rules
    business_errors = _validate_business_rules(data) if not errors else []
    errors.extend(business_errors)

    return ValidationResult(
        is_valid=len(errors) == 0,
        errors=errors,
        parsed_data=data if len(errors) == 0 else None
    )


def _validate_business_rules(data: dict) -> List[str]:
    """
    Validate business rules that go beyond JSON schema.

    Rules:
    1. Every causal step must have non-empty evidence
    2. High-confidence steps (>0.8) must have specific evidence
    3. Overall confidence should align with causal chain confidence
    """
    errors: List[str] = []

    # Rule 1: Non-empty evidence
    causal_chain = data.get("causal_chain", [])
    for i, step in enumerate(causal_chain):
        evidence = step.get("evidence", "")
        if not evidence or evidence.strip() == "":
            errors.append(f"causal_chain[{i}]: evidence cannot be empty")

        # Rule 2: High confidence requires specific evidence
        step_conf = step.get("confidence", 0)
        if step_conf > 0.8:
            # Check for vague evidence
            vague_indicators = ["possibly", "maybe", "might", "could be", "unclear"]
            if any(v in evidence.lower() for v in vague_indicators):
                errors.append(
                    f"causal_chain[{i}]: high confidence ({step_conf}) "
                    "but evidence contains uncertainty language"
                )

    # Rule 3: Confidence alignment (soft check - just warn)
    if causal_chain:
        avg_step_conf = sum(s.get("confidence", 0) for s in causal_chain) / len(causal_chain)
        overall_conf = data.get("confidence", 0)

        # If overall confidence is much higher than step average, flag it
        if overall_conf > avg_step_conf + 0.3:
            # Not an error, but we could log this
            pass

    return errors


# =============================================================================
# SCHEMA CLASS FOR EXPORT
# =============================================================================


class RCASchema:
    """Schema class for RCA response validation."""

    JSON_SCHEMA = RCA_JSON_SCHEMA

    @staticmethod
    def validate(response_text: str) -> ValidationResult:
        """Validate a response string against the schema."""
        return validate_rca_response(response_text)

    @staticmethod
    def get_example() -> dict:
        """Return an example valid RCA response."""
        return {
            "title": "Null pointer exception in user authentication",
            "summary": "The error occurred when accessing the `name` property of a null user object. The user lookup returned null because the database query failed silently due to a connection timeout.",
            "root_cause": "Missing null check after database query. The `findUserById` function returns null when the database connection times out, but the calling code assumes it always returns a valid user object.",
            "causal_chain": [
                {
                    "step": "Database connection timed out due to high load",
                    "evidence": "Log entry at 14:32:05: 'Connection pool exhausted, query timeout after 30s'",
                    "confidence": 0.85
                },
                {
                    "step": "findUserById returned null instead of throwing",
                    "evidence": "Code at src/services/user.js:42 catches timeout and returns null",
                    "confidence": 0.95
                },
                {
                    "step": "Calling code accessed .name without null check",
                    "evidence": "Stack trace line 15: user.name in src/routes/profile.js:28",
                    "confidence": 0.99
                }
            ],
            "suggested_fix": {
                "description": "Add null check after findUserById call and handle the error case explicitly",
                "file_path": "src/routes/profile.js",
                "patch_description": "Add `if (!user) throw new NotFoundError('User not found')` after line 27"
            },
            "test_intentions": [
                {
                    "description": "Test profile route when user is not found",
                    "rationale": "Ensures the null case is handled gracefully instead of crashing"
                },
                {
                    "description": "Test findUserById behavior on connection timeout",
                    "rationale": "Verifies the function throws instead of returning null on timeout"
                }
            ],
            "confidence": 0.92
        }
