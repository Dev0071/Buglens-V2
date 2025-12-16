"""
Tests for LLM schema validation.
"""

import json
import pytest
from llm.schemas import (
    validate_rca_response,
    RCA_JSON_SCHEMA,
    RCASchema,
    ValidationResult,
)


class TestValidateRCAResponse:
    """Tests for RCA response validation."""

    def test_valid_response(self):
        """Valid response should pass validation."""
        valid_response = json.dumps({
            "title": "Null pointer exception",
            "summary": "Error occurred when accessing null object",
            "root_cause": "Missing null check after database query",
            "causal_chain": [
                {
                    "step": "Database query timed out",
                    "evidence": "Log entry at 14:32:05",
                    "confidence": 0.85
                },
                {
                    "step": "Function returned null",
                    "evidence": "Code at src/user.js:42",
                    "confidence": 0.95
                }
            ],
            "confidence": 0.9
        })

        result = validate_rca_response(valid_response)

        assert result.is_valid
        assert result.errors == []
        assert result.parsed_data is not None
        assert result.parsed_data["title"] == "Null pointer exception"

    def test_missing_required_field(self):
        """Missing required field should fail validation."""
        invalid_response = json.dumps({
            "title": "Error",
            "summary": "Something happened",
            # Missing root_cause, causal_chain, confidence
        })

        result = validate_rca_response(invalid_response)

        assert not result.is_valid
        assert len(result.errors) > 0
        assert any("root_cause" in e or "causal_chain" in e or "confidence" in e
                   for e in result.errors)

    def test_invalid_json(self):
        """Invalid JSON should fail parsing."""
        result = validate_rca_response("not valid json {")

        assert not result.is_valid
        assert any("Invalid JSON" in e for e in result.errors)
        assert result.parsed_data is None

    def test_confidence_out_of_range(self):
        """Confidence outside 0-1 should fail."""
        invalid_response = json.dumps({
            "title": "Error",
            "summary": "Summary",
            "root_cause": "Cause",
            "causal_chain": [{
                "step": "Step",
                "evidence": "Evidence",
                "confidence": 0.5
            }],
            "confidence": 1.5  # Invalid: > 1
        })

        result = validate_rca_response(invalid_response)

        assert not result.is_valid
        # Check for schema validation error about maximum
        assert any("greater than the maximum" in e or "maximum" in e.lower() for e in result.errors)

    def test_empty_causal_chain(self):
        """Empty causal chain should fail."""
        invalid_response = json.dumps({
            "title": "Error",
            "summary": "Summary",
            "root_cause": "Cause",
            "causal_chain": [],  # Invalid: empty
            "confidence": 0.8
        })

        result = validate_rca_response(invalid_response)

        assert not result.is_valid
        # Check for schema validation error about minimum items
        assert any("too short" in e or "causal_chain" in e for e in result.errors)

    def test_empty_evidence_in_step(self):
        """Empty evidence in causal step should fail business rules."""
        invalid_response = json.dumps({
            "title": "Error",
            "summary": "Summary",
            "root_cause": "Cause",
            "causal_chain": [{
                "step": "Step",
                "evidence": "",  # Empty evidence
                "confidence": 0.8
            }],
            "confidence": 0.8
        })

        result = validate_rca_response(invalid_response)

        assert not result.is_valid
        assert any("evidence cannot be empty" in e for e in result.errors)

    def test_high_confidence_with_vague_evidence(self):
        """High confidence with vague evidence should fail."""
        invalid_response = json.dumps({
            "title": "Error",
            "summary": "Summary",
            "root_cause": "Cause",
            "causal_chain": [{
                "step": "Step",
                "evidence": "This might possibly be the cause",  # Vague
                "confidence": 0.95  # High confidence
            }],
            "confidence": 0.8
        })

        result = validate_rca_response(invalid_response)

        assert not result.is_valid
        assert any("uncertainty language" in e for e in result.errors)

    def test_with_optional_fields(self):
        """Response with optional fields should pass."""
        valid_response = json.dumps({
            "title": "Error",
            "summary": "Summary",
            "root_cause": "Cause",
            "causal_chain": [{
                "step": "Step",
                "evidence": "Log at 14:32:05",
                "confidence": 0.8
            }],
            "suggested_fix": {
                "description": "Add null check",
                "file_path": "src/user.js",
                "patch_description": "Add if (!user) return null"
            },
            "test_intentions": [{
                "description": "Test null user case",
                "rationale": "Prevents NPE"
            }],
            "confidence": 0.85
        })

        result = validate_rca_response(valid_response)

        assert result.is_valid
        assert result.parsed_data["suggested_fix"]["file_path"] == "src/user.js"


class TestRCASchemaClass:
    """Tests for RCASchema class."""

    def test_validate_method(self):
        """Schema.validate should work like validate_rca_response."""
        valid_json = json.dumps({
            "title": "Error",
            "summary": "Summary",
            "root_cause": "Cause",
            "causal_chain": [{
                "step": "Step",
                "evidence": "Evidence at line 42",
                "confidence": 0.8
            }],
            "confidence": 0.8
        })

        result = RCASchema.validate(valid_json)

        assert result.is_valid
        assert isinstance(result, ValidationResult)

    def test_get_example(self):
        """get_example should return a valid example."""
        example = RCASchema.get_example()

        # Convert to JSON and validate
        json_str = json.dumps(example)
        result = RCASchema.validate(json_str)

        assert result.is_valid
        assert result.parsed_data is not None

    def test_json_schema_available(self):
        """JSON_SCHEMA should be accessible."""
        schema = RCASchema.JSON_SCHEMA

        assert schema is not None
        assert schema["type"] == "object"
        assert "title" in schema["properties"]
        assert "confidence" in schema["properties"]
