"""
Timeline Reconstructor for Sentry Breadcrumbs

Parses Sentry breadcrumbs and builds a structured timeline with anomaly detection.
Called from Node.js via stdin/stdout JSON protocol.
"""

import json
import sys
from datetime import datetime
from typing import Any, TypedDict, Optional

# ============================================
# Type Definitions
# ============================================

class TimelineStep(TypedDict):
    timestamp: str
    timestamp_ms: int
    type: str
    category: Optional[str]
    message: str
    data: Optional[dict]
    level: str
    is_anomaly: bool
    anomaly_reason: Optional[str]


class Timeline(TypedDict):
    steps: list[TimelineStep]
    anomalies_count: int
    duration_ms: int
    first_timestamp: Optional[str]
    last_timestamp: Optional[str]
    http_requests: int
    errors_before_crash: int


# ============================================
# Anomaly Detection Configuration
# ============================================

# Time gap in ms that's considered anomalous (5 seconds)
ANOMALY_TIME_GAP_MS = 5000

# Repeated action threshold (same action N times in short period)
REPEATED_ACTION_THRESHOLD = 5
REPEATED_ACTION_WINDOW_MS = 2000

# Error accumulation threshold
ERROR_ACCUMULATION_THRESHOLD = 3


# ============================================
# Helper Functions
# ============================================

def parse_timestamp(ts: Any) -> tuple[str, int]:
    """Parse timestamp to ISO string and milliseconds."""
    if ts is None:
        now = datetime.utcnow()
        return now.isoformat() + "Z", int(now.timestamp() * 1000)

    if isinstance(ts, (int, float)):
        # Unix timestamp (could be seconds or milliseconds)
        if ts > 1e12:  # Already milliseconds
            ms = int(ts)
        else:  # Seconds
            ms = int(ts * 1000)
        dt = datetime.utcfromtimestamp(ms / 1000)
        return dt.isoformat() + "Z", ms

    if isinstance(ts, str):
        try:
            # Try ISO format
            if ts.endswith("Z"):
                dt = datetime.fromisoformat(ts[:-1])
            else:
                dt = datetime.fromisoformat(ts)
            return dt.isoformat() + "Z", int(dt.timestamp() * 1000)
        except ValueError:
            pass

    # Fallback to current time
    now = datetime.utcnow()
    return now.isoformat() + "Z", int(now.timestamp() * 1000)


def map_breadcrumb_type(bc_type: Optional[str]) -> str:
    """Map Sentry breadcrumb type to our type enum."""
    type_map = {
        "navigation": "navigation",
        "http": "http",
        "fetch": "http",
        "xhr": "http",
        "console": "console",
        "ui": "ui",
        "click": "ui",
        "input": "ui",
        "user": "user",
        "error": "error",
        "debug": "debug",
        "query": "query",
        "transaction": "transaction",
        "sentry.event": "default",
        "sentry.transaction": "transaction",
    }
    return type_map.get(bc_type or "", "default")


def map_breadcrumb_level(level: Optional[str]) -> str:
    """Map Sentry breadcrumb level to our level enum."""
    level_map = {
        "debug": "debug",
        "info": "info",
        "warning": "warning",
        "warn": "warning",
        "error": "error",
        "fatal": "fatal",
        "critical": "fatal",
    }
    return level_map.get(level or "", "info")


def extract_message(breadcrumb: dict) -> str:
    """Extract human-readable message from breadcrumb."""
    # Direct message
    if breadcrumb.get("message"):
        return str(breadcrumb["message"])

    # HTTP request
    data = breadcrumb.get("data", {})
    if breadcrumb.get("type") in ("http", "fetch", "xhr"):
        method = data.get("method", "?")
        url = data.get("url", "")
        status = data.get("status_code", "")
        if url:
            # Truncate long URLs
            if len(url) > 80:
                url = url[:77] + "..."
            return f"{method} {url}" + (f" [{status}]" if status else "")

    # Navigation
    if breadcrumb.get("type") == "navigation":
        from_url = data.get("from", "")
        to_url = data.get("to", "")
        if to_url:
            return f"Navigate to {to_url[:60]}"
        if from_url:
            return f"Navigate from {from_url[:60]}"

    # Console log
    if breadcrumb.get("type") == "console":
        return f"[{data.get('logger', 'console')}] {breadcrumb.get('message', '')}"

    # UI interaction
    if breadcrumb.get("type") in ("ui", "click", "input"):
        target = data.get("target", "")
        return f"UI: {breadcrumb.get('category', 'interaction')}" + (f" on {target[:40]}" if target else "")

    # Category as fallback
    if breadcrumb.get("category"):
        return str(breadcrumb["category"])

    return "Unknown action"


# ============================================
# Anomaly Detection
# ============================================

def detect_anomalies(steps: list[TimelineStep]) -> list[TimelineStep]:
    """
    Detect anomalies in the timeline:
    1. Large time gaps (> 5 seconds)
    2. Repeated actions (same action many times quickly)
    3. Error accumulation before crash
    """
    if len(steps) < 2:
        return steps

    # Sort by timestamp
    sorted_steps = sorted(steps, key=lambda s: s["timestamp_ms"])

    # Track for repeated action detection
    action_window: list[TimelineStep] = []
    error_count = 0

    for i, step in enumerate(sorted_steps):
        anomaly_reasons: list[str] = []

        # 1. Time gap detection
        if i > 0:
            prev_step = sorted_steps[i - 1]
            gap_ms = step["timestamp_ms"] - prev_step["timestamp_ms"]
            if gap_ms > ANOMALY_TIME_GAP_MS:
                anomaly_reasons.append(f"Time gap of {gap_ms/1000:.1f}s since previous action")

        # 2. Repeated action detection
        # Clean up action window
        action_window = [
            s for s in action_window
            if step["timestamp_ms"] - s["timestamp_ms"] < REPEATED_ACTION_WINDOW_MS
        ]
        action_window.append(step)

        # Check for repeated similar actions
        similar_count = sum(
            1 for s in action_window
            if s["type"] == step["type"] and s.get("category") == step.get("category")
        )
        if similar_count >= REPEATED_ACTION_THRESHOLD:
            anomaly_reasons.append(f"Rapid repeated action ({similar_count}x in {REPEATED_ACTION_WINDOW_MS}ms)")

        # 3. Error accumulation
        if step["level"] in ("error", "fatal"):
            error_count += 1
            if error_count >= ERROR_ACCUMULATION_THRESHOLD:
                anomaly_reasons.append(f"Error accumulation ({error_count} errors)")

        # Mark anomaly
        if anomaly_reasons:
            step["is_anomaly"] = True
            step["anomaly_reason"] = "; ".join(anomaly_reasons)

    return sorted_steps


# ============================================
# Main Reconstruction Function
# ============================================

def reconstruct_timeline(breadcrumbs: list[dict]) -> Timeline:
    """
    Reconstruct a timeline from Sentry breadcrumbs.

    Args:
        breadcrumbs: List of Sentry breadcrumb objects

    Returns:
        Timeline object with steps and metadata
    """
    if not breadcrumbs:
        return Timeline(
            steps=[],
            anomalies_count=0,
            duration_ms=0,
            first_timestamp=None,
            last_timestamp=None,
            http_requests=0,
            errors_before_crash=0,
        )

    steps: list[TimelineStep] = []
    http_requests = 0
    errors_before_crash = 0

    for bc in breadcrumbs:
        iso_ts, ms_ts = parse_timestamp(bc.get("timestamp"))
        bc_type = map_breadcrumb_type(bc.get("type"))
        level = map_breadcrumb_level(bc.get("level"))
        message = extract_message(bc)

        # Count HTTP requests and errors
        if bc_type == "http":
            http_requests += 1
        if level in ("error", "fatal"):
            errors_before_crash += 1

        step = TimelineStep(
            timestamp=iso_ts,
            timestamp_ms=ms_ts,
            type=bc_type,
            category=bc.get("category"),
            message=message,
            data=bc.get("data") if isinstance(bc.get("data"), dict) else None,
            level=level,
            is_anomaly=False,
            anomaly_reason=None,
        )
        steps.append(step)

    # Run anomaly detection
    steps = detect_anomalies(steps)

    # Calculate metadata
    anomalies_count = sum(1 for s in steps if s["is_anomaly"])

    if steps:
        timestamps = [s["timestamp_ms"] for s in steps]
        first_ts = min(timestamps)
        last_ts = max(timestamps)
        duration_ms = last_ts - first_ts

        # Find first and last step by timestamp
        first_step = min(steps, key=lambda s: s["timestamp_ms"])
        last_step = max(steps, key=lambda s: s["timestamp_ms"])
        first_timestamp = first_step["timestamp"]
        last_timestamp = last_step["timestamp"]
    else:
        duration_ms = 0
        first_timestamp = None
        last_timestamp = None

    return Timeline(
        steps=steps,
        anomalies_count=anomalies_count,
        duration_ms=duration_ms,
        first_timestamp=first_timestamp,
        last_timestamp=last_timestamp,
        http_requests=http_requests,
        errors_before_crash=errors_before_crash,
    )


# ============================================
# CLI Entry Point
# ============================================

def main():
    """
    Main entry point for Node.js integration.
    Reads JSON from stdin, processes, writes JSON to stdout.
    """
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        breadcrumbs = input_data.get("breadcrumbs", [])

        # Reconstruct timeline
        timeline = reconstruct_timeline(breadcrumbs)

        # Write output to stdout
        json.dump(timeline, sys.stdout)

    except json.JSONDecodeError as e:
        # Output error as JSON
        error_response = {
            "error": True,
            "message": f"Invalid JSON input: {str(e)}",
        }
        json.dump(error_response, sys.stdout)
        sys.exit(1)

    except Exception as e:
        error_response = {
            "error": True,
            "message": f"Timeline reconstruction failed: {str(e)}",
        }
        json.dump(error_response, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main()
