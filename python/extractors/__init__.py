"""
Extractors Module

Hybrid LLM-Assisted Event Extraction for Buglens.
Stage 2 uses LLM only when deterministic extraction (Stage 1) is incomplete.

Note: Imports are deferred to avoid circular import issues when running
modules directly with python -m
"""


def __getattr__(name: str):
    """Lazy import to avoid circular import when running as __main__"""
    if name in (
        "process",
        "classify_frame_deterministic",
        "LLMAssistInput",
        "LLMAssistOutput",
        "ExtractedFrame",
    ):
        from .llm_assist_extractor import (
            process,
            classify_frame_deterministic,
            LLMAssistInput,
            LLMAssistOutput,
            ExtractedFrame,
        )

        return {
            "process": process,
            "classify_frame_deterministic": classify_frame_deterministic,
            "LLMAssistInput": LLMAssistInput,
            "LLMAssistOutput": LLMAssistOutput,
            "ExtractedFrame": ExtractedFrame,
        }[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "process",
    "classify_frame_deterministic",
    "LLMAssistInput",
    "LLMAssistOutput",
    "ExtractedFrame",
]
