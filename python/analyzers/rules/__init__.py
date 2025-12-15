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
from .type_mismatch import TypeMismatchRule, evaluate_type_mismatch
from .array_out_of_bounds import ArrayOutOfBoundsRule, evaluate_array_out_of_bounds
from .undefined_variable import UndefinedVariableRule, evaluate_undefined_variable
from .invalid_function_call import InvalidFunctionCallRule, evaluate_invalid_function_call
from .async_race_condition import AsyncRaceConditionRule, evaluate_async_race_condition
from .memory_leak import MemoryLeakRule, evaluate_memory_leak
from .regex_catastrophic import RegexCatastrophicRule, evaluate_regex_catastrophic

# Pure rule functions (preferred)
RULE_FUNCTIONS = [
    evaluate_null_access,
    evaluate_unawaited_promise,
    evaluate_missing_error_handler,
    evaluate_type_mismatch,
    evaluate_array_out_of_bounds,
    evaluate_undefined_variable,
    evaluate_invalid_function_call,
    evaluate_async_race_condition,
    evaluate_memory_leak,
    evaluate_regex_catastrophic,
]

# Backward compatible class exports
__all__ = [
    # Pure functions (preferred)
    "evaluate_null_access",
    "evaluate_unawaited_promise",
    "evaluate_missing_error_handler",
    "evaluate_type_mismatch",
    "evaluate_array_out_of_bounds",
    "evaluate_undefined_variable",
    "evaluate_invalid_function_call",
    "evaluate_async_race_condition",
    "evaluate_memory_leak",
    "evaluate_regex_catastrophic",
    "RULE_FUNCTIONS",
    # Backward compatible classes
    "NullAccessRule",
    "UnawaitedPromiseRule",
    "MissingErrorHandlerRule",
    "TypeMismatchRule",
    "ArrayOutOfBoundsRule",
    "UndefinedVariableRule",
    "InvalidFunctionCallRule",
    "AsyncRaceConditionRule",
    "MemoryLeakRule",
    "RegexCatastrophicRule",
]
