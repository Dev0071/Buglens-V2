"""
Analyzer Rules - Pure Functional Rule Engine

Each rule is implemented as a pure function that takes an AnalysisContext
and returns a list of findings. Wrapper classes are provided for backward
compatibility with existing code.

Usage (preferred - functional):
    from .null_access import evaluate_null_access
    findings = evaluate_null_access(context)

Usage (backward compatible - OOP):
    from .null_access import NullAccessRule
    rule = NullAccessRule()
    findings = rule.evaluate(context)
"""
from .null_access import NullAccessRule, evaluate_null_access
from .unawaited_promises import UnawaitedPromiseRule, evaluate_unawaited_promise
from .missing_error_handler import MissingErrorHandlerRule, evaluate_missing_error_handler

# Pure rule functions (preferred)
RULE_FUNCTIONS = [
    evaluate_null_access,
    evaluate_unawaited_promise,
    evaluate_missing_error_handler,
]

# Backward compatible class exports
__all__ = [
    # Pure functions (preferred)
    "evaluate_null_access",
    "evaluate_unawaited_promise",
    "evaluate_missing_error_handler",
    "RULE_FUNCTIONS",
    # Backward compatible classes
    "NullAccessRule",
    "UnawaitedPromiseRule",
    "MissingErrorHandlerRule",
]
