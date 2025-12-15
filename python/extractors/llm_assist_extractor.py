"""
Stage 2: LLM Assist Extractor

Uses GPT-4o-mini to assist with extraction when Stage 1 is incomplete.
RESTRICTED SCOPE: LLM can only clean/classify, NOT invent data.

Capabilities:
- Clean stacktrace noise (polyfills, bundler internals)
- Classify frames (user_code vs vendor)
- Identify root crash frame from 20-100 frames
- Suggest branch when missing (from frame paths)
- Interpret custom Sentry contexts
"""
from __future__ import annotations

import json
import sys
import os
import re
from typing import TypedDict, Optional, Tuple

# Only import openai when actually called - allow module to load for testing
openai_client = None

# API key validation patterns
# OpenAI keys: sk-{48 chars} or sk-proj-{80+ chars for project keys}
# DeepSeek keys: sk-{32+ chars}
OPENAI_KEY_PATTERN = re.compile(r"^sk-[a-zA-Z0-9]{48}$|^sk-proj-[a-zA-Z0-9_-]{80,}$")
DEEPSEEK_KEY_PATTERN = re.compile(r"^sk-[a-zA-Z0-9]{32,}$")

# LLM Provider configuration (read from environment)
# LLM_PROVIDER: "openai" or "deepseek"
# LLM_MODEL: Override model name (e.g., "deepseek-chat", "gpt-4o-mini")
# LLM_BASE_URL: Custom base URL for DeepSeek (https://api.deepseek.com)


class ExtractedFrame(TypedDict, total=False):
    """Frame structure matching TypeScript ExtractedFrame"""
    file_path: str
    abs_path: Optional[str]
    line_number: int
    column_number: Optional[int]
    function_name: Optional[str]
    classification: str  # user_code, third_party, runtime, framework, polyfill, unknown
    is_entry_point: bool
    source_mapped: bool
    context_line: Optional[str]
    in_app: bool


class LLMAssistInput(TypedDict):
    """Input from Node.js"""
    stage_1_output: dict
    tasks: list[str]
    raw_frames: list[dict]
    context: Optional[dict]


class LLMAssistOutput(TypedDict):
    """Output to Node.js"""
    frames: list[ExtractedFrame]
    primary_frame_index: Optional[int]
    suggested_branch: Optional[str]
    cleaned_frames_count: int
    removed_noise_count: int
    model: str
    tokens_used: int
    reasoning: str
    confidence: float


# Frame classification rules (mirrors TypeScript for consistency)
NOISE_PATTERNS = [
    "node_modules/",
    "internal/",
    "node:",
    "timers",
    "events",
    "_http",
    "core-js",
    "regenerator-runtime",
    "@babel/runtime",
    "tslib",
    "__webpack__",
    "__vite__",
    ".hot-update.",
    "react-dom/",
    "react/cjs/",
    "scheduler/",
    "next/dist/",
    ".next/",
    "express/lib/",
]

USER_CODE_INDICATORS = [
    "src/",
    "lib/",
    "app/",
    "pages/",
    "components/",
    "services/",
    "utils/",
    "modules/",
]


def validate_api_key(api_key: str, provider: str = "openai") -> bool:
    """
    Validate API key format without exposing the key.

    Supports OpenAI and DeepSeek key formats.
    This catches common issues like truncated keys or wrong environment variables.
    """
    if not api_key:
        return False

    if provider == "deepseek":
        # DeepSeek uses sk-{32+ chars} format
        return bool(DEEPSEEK_KEY_PATTERN.match(api_key))
    else:
        # OpenAI: sk-{48 chars} or sk-proj-{80+ chars}
        return bool(OPENAI_KEY_PATTERN.match(api_key))


def get_llm_config() -> Tuple[str, str, Optional[str]]:
    """
    Get LLM configuration from environment.

    Returns: (provider, model, base_url)
    """
    provider = os.environ.get("LLM_PROVIDER", "openai").lower()
    base_url = os.environ.get("LLM_BASE_URL")

    # Default models per provider
    if provider == "deepseek":
        default_model = "deepseek-chat"
        if not base_url:
            base_url = "https://api.deepseek.com"
    else:
        default_model = "gpt-4o-mini"

    model = os.environ.get("LLM_MODEL", default_model)
    return provider, model, base_url


def get_api_key() -> Tuple[Optional[str], str]:
    """
    Get API key based on provider configuration.

    Returns: (api_key, provider)

    Checks in order:
    1. DEEPSEEK_API_KEY (if LLM_PROVIDER=deepseek)
    2. OPENAI_API_KEY (fallback, also used for DeepSeek-compatible keys)
    """
    provider = os.environ.get("LLM_PROVIDER", "openai").lower()

    if provider == "deepseek":
        # Prefer DEEPSEEK_API_KEY, fall back to OPENAI_API_KEY
        api_key = os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("OPENAI_API_KEY")
    else:
        api_key = os.environ.get("OPENAI_API_KEY")

    return api_key, provider


def get_openai_client():
    """
    Lazy initialization of OpenAI-compatible client with key validation.

    Supports OpenAI and DeepSeek (via OpenAI-compatible API).
    Validates API key format at initialization time to catch configuration
    errors early rather than at runtime during API calls.
    """
    global openai_client
    if openai_client is None:
        try:
            import openai

            provider, model, base_url = get_llm_config()
            api_key, _ = get_api_key()

            if not api_key:
                raise ValueError(
                    f"No API key found. Set OPENAI_API_KEY or DEEPSEEK_API_KEY "
                    f"(current provider: {provider})"
                )

            # Auto-detect provider from key format if not explicitly set
            # DeepSeek keys are 32 chars, OpenAI keys are 48+ chars
            key_length = len(api_key.replace("sk-", "").replace("proj-", ""))
            is_likely_deepseek = key_length < 40

            # If key looks like DeepSeek but provider is openai, adjust base_url
            if is_likely_deepseek and provider == "openai":
                # Log that we're auto-detecting DeepSeek
                import sys
                print(f"[LLM] Auto-detected DeepSeek key format, using DeepSeek API", file=sys.stderr)
                base_url = "https://api.deepseek.com"


            # Create client with optional custom base URL (for DeepSeek)
            if base_url:
                openai_client = openai.OpenAI(api_key=api_key, base_url=base_url)
            else:
                openai_client = openai.OpenAI(api_key=api_key)

        except ImportError:
            raise ImportError("openai package not installed. Run: pip install openai")
    return openai_client
def classify_frame_deterministic(frame: dict) -> str:
    """Deterministic classification before LLM"""
    path = frame.get("file_path") or frame.get("filename") or ""

    # Explicit vendor indicators
    if frame.get("in_app") is False:
        return "third_party"

    # Check noise patterns
    for pattern in NOISE_PATTERNS:
        if pattern in path:
            if "react" in pattern or "next" in pattern or "express" in pattern:
                return "framework"
            if "core-js" in pattern or "regenerator" in pattern:
                return "polyfill"
            if "node_modules" in pattern:
                return "third_party"
            return "runtime"

    # Check user code indicators
    for indicator in USER_CODE_INDICATORS:
        if path.startswith(indicator):
            return "user_code"

    # Explicit in_app
    if frame.get("in_app") is True:
        return "user_code"

    return "unknown"


def build_llm_prompt(input_data: LLMAssistInput) -> str:
    """Build prompt for frame classification and root cause identification"""

    tasks = input_data.get("tasks", [])
    raw_frames = input_data.get("raw_frames", [])
    stage_1 = input_data.get("stage_1_output", {})

    # Summarize frames for prompt
    frame_summary = []
    for i, frame in enumerate(raw_frames[:50]):  # Limit to 50 frames
        path = frame.get("file_path") or frame.get("filename") or "unknown"
        line = frame.get("line_number") or frame.get("lineno") or "?"
        func = frame.get("function_name") or frame.get("function") or "?"
        in_app = frame.get("in_app")

        frame_summary.append(f"{i}: {path}:{line} in {func} (in_app={in_app})")

    frames_text = "\n".join(frame_summary)

    # Build task list
    task_descriptions = {
        "clean_stacktrace_noise": "Remove vendor/runtime/polyfill frames that obscure the root cause",
        "classify_frames": "Classify each frame as: user_code, third_party, runtime, framework, or polyfill",
        "identify_root_frame": "Identify the SINGLE frame most likely to be the root cause of the error",
        "infer_missing_branch": "Suggest a likely git branch name based on file paths",
    }

    active_tasks = [task_descriptions.get(t, t) for t in tasks if t in task_descriptions]
    tasks_text = "\n".join(f"- {t}" for t in active_tasks)

    error_info = f"Error: {stage_1.get('error_type', 'Unknown')} - {stage_1.get('error_message', 'No message')}"

    prompt = f"""You are analyzing a JavaScript/TypeScript stack trace to identify the root cause frame.

{error_info}

TASKS:
{tasks_text}

STACK FRAMES (index: path:line in function):
{frames_text}

RULES:
1. User code is typically in: src/, lib/, app/, pages/, components/, services/, utils/
2. Vendor code is in: node_modules/, .next/, next/dist/, react-dom/, express/lib/
3. Runtime is: internal/, node:*, timers, events, _http
4. The root cause frame is usually the FIRST user_code frame in the trace
5. Ignore polyfills (core-js, regenerator-runtime, @babel/runtime)

OUTPUT FORMAT (JSON):
{{
  "frame_classifications": [
    {{"index": 0, "classification": "user_code|third_party|runtime|framework|polyfill"}},
    ...
  ],
  "primary_frame_index": <number or null>,
  "suggested_branch": "<string or null>",
  "removed_indices": [<indices of noise frames>],
  "reasoning": "<brief explanation>"
}}

Respond ONLY with valid JSON, no markdown or explanation outside the JSON."""

    return prompt


def call_llm(prompt: str, max_tokens: int = 1500, timeout_seconds: int = 25) -> tuple[dict, int, str]:
    """
    Call LLM and return parsed response + tokens used + model name.

    Args:
        prompt: The prompt to send to the LLM
        max_tokens: Maximum tokens in response
        timeout_seconds: Timeout for the API call (default 25s to leave buffer for Python bridge's 30s timeout)
    """
    client = get_openai_client()
    provider, model, _ = get_llm_config()

    try:
        response = client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": "You are a code analysis expert. Respond only with valid JSON."
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ],
            temperature=0.1,  # Low for consistency
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            timeout=timeout_seconds,  # Add explicit timeout
        )
    except Exception as e:
        # Return empty result on timeout or API error
        error_type = type(e).__name__
        return {"error": f"LLM API error: {error_type}"}, 0, model

    content = response.choices[0].message.content or "{}"
    tokens_used = response.usage.total_tokens if response.usage else 0

    try:
        result = json.loads(content)
    except json.JSONDecodeError:
        result = {"error": "Invalid JSON response", "raw": content}

    return result, tokens_used, model


def process_llm_response(
    llm_response: dict,
    raw_frames: list[dict],
    stage_1_frames: list[dict]
) -> LLMAssistOutput:
    """Process LLM response and build output"""

    frame_classifications = llm_response.get("frame_classifications", [])
    removed_indices = set(llm_response.get("removed_indices", []))
    primary_index = llm_response.get("primary_frame_index")
    suggested_branch = llm_response.get("suggested_branch")
    reasoning = llm_response.get("reasoning", "")

    # Build output frames
    output_frames: list[ExtractedFrame] = []
    new_primary_index = None
    cleaned_count = 0

    # Map classifications by index
    classification_map = {item["index"]: item["classification"] for item in frame_classifications}

    for i, raw_frame in enumerate(raw_frames):
        # Skip removed frames
        if i in removed_indices:
            continue

        # Get classification from LLM or fall back to deterministic
        classification = classification_map.get(i)
        if not classification or classification not in ["user_code", "third_party", "runtime", "framework", "polyfill"]:
            classification = classify_frame_deterministic(raw_frame)

        # Build ExtractedFrame
        is_entry = (i == primary_index)
        if is_entry:
            new_primary_index = len(output_frames)

        frame: ExtractedFrame = {
            "file_path": raw_frame.get("file_path") or raw_frame.get("filename") or "",
            "line_number": raw_frame.get("line_number") or raw_frame.get("lineno") or 0,
            "classification": classification,
            "is_entry_point": is_entry,
            "source_mapped": False,
            "in_app": raw_frame.get("in_app", True),
        }

        # Optional fields
        if raw_frame.get("abs_path"):
            frame["abs_path"] = raw_frame["abs_path"]
        if raw_frame.get("column_number") or raw_frame.get("colno"):
            frame["column_number"] = raw_frame.get("column_number") or raw_frame.get("colno")
        if raw_frame.get("function_name") or raw_frame.get("function"):
            frame["function_name"] = raw_frame.get("function_name") or raw_frame.get("function")
        if raw_frame.get("context_line"):
            frame["context_line"] = raw_frame["context_line"]

        output_frames.append(frame)
        cleaned_count += 1

    _, model, _ = get_llm_config()
    return {
        "frames": output_frames,
        "primary_frame_index": new_primary_index,
        "suggested_branch": suggested_branch,
        "cleaned_frames_count": cleaned_count,
        "removed_noise_count": len(removed_indices),
        "model": model,
        "tokens_used": 0,  # Will be set by caller
        "reasoning": reasoning,
        "confidence": 0.8 if new_primary_index is not None else 0.5,
    }


def process(input_data: LLMAssistInput) -> LLMAssistOutput:
    """Main entry point for LLM assist extraction"""

    tasks = input_data.get("tasks", [])
    raw_frames = input_data.get("raw_frames", [])
    stage_1_output = input_data.get("stage_1_output", {})

    # If no frames, return empty result
    if not raw_frames:
        return {
            "frames": [],
            "primary_frame_index": None,
            "suggested_branch": None,
            "cleaned_frames_count": 0,
            "removed_noise_count": 0,
            "model": "none",
            "tokens_used": 0,
            "reasoning": "No frames to process",
            "confidence": 0.0,
        }

    # If no LLM tasks or API key not set, fall back to deterministic
    api_key, provider = get_api_key()
    if not tasks or not api_key:
        # Deterministic fallback
        output_frames: list[ExtractedFrame] = []
        primary_index = None

        for i, raw_frame in enumerate(raw_frames):
            classification = classify_frame_deterministic(raw_frame)
            is_entry = (primary_index is None and classification == "user_code")
            if is_entry:
                primary_index = len(output_frames)

            frame: ExtractedFrame = {
                "file_path": raw_frame.get("file_path") or raw_frame.get("filename") or "",
                "line_number": raw_frame.get("line_number") or raw_frame.get("lineno") or 0,
                "classification": classification,
                "is_entry_point": is_entry,
                "source_mapped": False,
                "in_app": raw_frame.get("in_app", True),
            }
            output_frames.append(frame)

        fallback_reason = "No LLM tasks specified" if not tasks else f"No API key for {provider}"
        return {
            "frames": output_frames,
            "primary_frame_index": primary_index,
            "suggested_branch": None,
            "cleaned_frames_count": len(output_frames),
            "removed_noise_count": 0,
            "model": "deterministic_fallback",
            "tokens_used": 0,
            "reasoning": f"{fallback_reason} - used deterministic classification",
            "confidence": 0.7,
        }

    # Build prompt and call LLM
    prompt = build_llm_prompt(input_data)
    llm_response, tokens_used, model_used = call_llm(prompt)

    # Process response
    result = process_llm_response(llm_response, raw_frames, stage_1_output.get("frames", []))
    result["tokens_used"] = tokens_used
    result["model"] = model_used

    return result


def sanitize_error_message(error: Exception) -> str:
    """
    Sanitize error message to prevent leaking sensitive information.

    Removes or redacts:
    - API keys
    - Full file paths that might reveal system structure
    - Internal stack traces
    """
    message = str(error)

    # Redact any API key patterns (sk-...)
    message = re.sub(r"sk-[a-zA-Z0-9_-]+", "sk-[REDACTED]", message)

    # Redact Bearer tokens
    message = re.sub(r"Bearer [a-zA-Z0-9_-]+", "Bearer [REDACTED]", message)

    # Keep error type but limit message length to prevent data leakage
    if len(message) > 200:
        message = message[:200] + "...[truncated]"

    return message


def main():
    """Read from stdin, process, write to stdout"""
    try:
        input_text = sys.stdin.read()
        input_data = json.loads(input_text)

        result = process(input_data)

        print(json.dumps(result))
    except Exception as e:
        # Sanitize error message to prevent leaking sensitive info
        safe_error = sanitize_error_message(e)
        error_result = {
            "frames": [],
            "primary_frame_index": None,
            "suggested_branch": None,
            "cleaned_frames_count": 0,
            "removed_noise_count": 0,
            "model": "error",
            "tokens_used": 0,
            "reasoning": f"Error: {safe_error}",
            "confidence": 0.0,
        }
        print(json.dumps(error_result))
        sys.exit(1)


if __name__ == "__main__":
    main()
