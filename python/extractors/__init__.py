"""
Extractors Module

Hybrid LLM-Assisted Event Extraction for Buglens.
Stage 2 uses LLM only when deterministic extraction (Stage 1) is incomplete.
"""

from .llm_assist_extractor import (
    process,
    classify_frame_deterministic,
    LLMAssistInput,
    LLMAssistOutput,
    ExtractedFrame,
)

__all__ = [
    "process",
    "classify_frame_deterministic",
    "LLMAssistInput",
    "LLMAssistOutput",
    "ExtractedFrame",
]
