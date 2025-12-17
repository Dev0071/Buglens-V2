import { describe, it, expect } from "vitest";
import {
  cn,
  formatRelativeTime,
  formatDateTime,
  formatNumber,
  formatPercentage,
  formatConfidence,
  truncate,
  extractFilename,
  getSeverityClass,
  getStatusClass,
  debounce,
  copyToClipboard,
  generateId,
} from "@/lib/utils";

describe("cn (class name merge)", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("base", true && "conditional")).toBe("base conditional");
    expect(cn("base", false && "conditional")).toBe("base");
  });

  it("deduplicates tailwind classes", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
    expect(cn("text-red-500", "text-blue-500")).toBe("text-blue-500");
  });

  it("handles undefined and null values", () => {
    expect(cn("base", undefined, null, "end")).toBe("base end");
  });
});

describe("formatRelativeTime", () => {
  it('formats recent time as "just now"', () => {
    const now = new Date();
    expect(formatRelativeTime(now)).toBe("just now");
  });

  it("formats minutes ago", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(formatRelativeTime(fiveMinutesAgo)).toBe("5m ago");
  });

  it("formats hours ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
    expect(formatRelativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("formats days ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    expect(formatRelativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("handles string dates", () => {
    const isoString = new Date(Date.now() - 60000).toISOString();
    expect(formatRelativeTime(isoString)).toBe("1m ago");
  });
});

describe("formatDateTime", () => {
  it("formats date and time correctly", () => {
    const date = new Date("2024-01-15T14:30:00Z");
    const formatted = formatDateTime(date);

    // Check that it includes expected components (locale-specific)
    expect(formatted).toMatch(/Jan/);
    expect(formatted).toMatch(/15/);
    expect(formatted).toMatch(/2024/);
  });
});

describe("formatNumber", () => {
  it("formats numbers with separators", () => {
    expect(formatNumber(1000)).toBe("1,000");
    expect(formatNumber(1000000)).toBe("1,000,000");
    expect(formatNumber(123)).toBe("123");
  });

  it("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });
});

describe("formatPercentage", () => {
  it("formats percentages with decimals", () => {
    expect(formatPercentage(85.5)).toBe("85.5%");
    expect(formatPercentage(100)).toBe("100.0%");
  });

  it("respects decimal places argument", () => {
    expect(formatPercentage(85.555, 2)).toBe("85.56%");
    expect(formatPercentage(85.555, 0)).toBe("86%");
  });
});

describe("formatConfidence", () => {
  it("returns high confidence class for >= 0.8", () => {
    const result = formatConfidence(0.85);
    expect(result.value).toBe("85%");
    expect(result.colorClass).toBe("confidence-high");
  });

  it("returns medium confidence class for >= 0.6", () => {
    const result = formatConfidence(0.65);
    expect(result.value).toBe("65%");
    expect(result.colorClass).toBe("confidence-medium");
  });

  it("returns low confidence class for < 0.6", () => {
    const result = formatConfidence(0.45);
    expect(result.value).toBe("45%");
    expect(result.colorClass).toBe("confidence-low");
  });

  it("handles edge cases", () => {
    expect(formatConfidence(0.8).colorClass).toBe("confidence-high");
    expect(formatConfidence(0.6).colorClass).toBe("confidence-medium");
    expect(formatConfidence(0).value).toBe("0%");
    expect(formatConfidence(1).value).toBe("100%");
  });
});

describe("truncate", () => {
  it("truncates long strings", () => {
    expect(truncate("This is a very long string", 15)).toBe("This is a ve...");
  });

  it("returns original string if shorter than max", () => {
    expect(truncate("Short", 10)).toBe("Short");
  });

  it("handles exact length", () => {
    expect(truncate("Exact", 5)).toBe("Exact");
  });
});

describe("extractFilename", () => {
  it("extracts filename from path", () => {
    expect(extractFilename("/path/to/file.ts")).toBe("file.ts");
    expect(extractFilename("src/components/Button.tsx")).toBe("Button.tsx");
  });

  it("handles filename only", () => {
    expect(extractFilename("file.js")).toBe("file.js");
  });

  it("handles empty string", () => {
    expect(extractFilename("")).toBe("");
  });
});

describe("getSeverityClass", () => {
  it("returns correct class for each severity", () => {
    expect(getSeverityClass("critical")).toBe("severity-critical");
    expect(getSeverityClass("high")).toBe("severity-high");
    expect(getSeverityClass("medium")).toBe("severity-medium");
    expect(getSeverityClass("low")).toBe("severity-low");
    expect(getSeverityClass("info")).toBe("badge-info");
  });

  it("handles case insensitivity", () => {
    expect(getSeverityClass("CRITICAL")).toBe("severity-critical");
    expect(getSeverityClass("High")).toBe("severity-high");
  });

  it("returns default for unknown severity", () => {
    expect(getSeverityClass("unknown")).toBe("badge-info");
  });
});

describe("getStatusClass", () => {
  it("returns correct class for each status", () => {
    expect(getStatusClass("completed")).toBe("badge-success");
    expect(getStatusClass("pending")).toBe("badge-warning");
    expect(getStatusClass("processing")).toBe("badge-info");
    expect(getStatusClass("failed")).toBe("badge-error");
    expect(getStatusClass("queued")).toBe("badge-info");
  });

  it("handles case insensitivity", () => {
    expect(getStatusClass("COMPLETED")).toBe("badge-success");
    expect(getStatusClass("Failed")).toBe("badge-error");
  });

  it("returns default for unknown status", () => {
    expect(getStatusClass("unknown")).toBe("badge-info");
  });
});

describe("debounce", () => {
  it("debounces function calls", async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced("a");
    debounced("b");
    debounced("c");

    // Should not have been called yet
    expect(fn).not.toHaveBeenCalled();

    // Wait for debounce
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should have been called once with last argument
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("c");
  });
});

describe("copyToClipboard", () => {
  it("copies text to clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const result = await copyToClipboard("test text");

    expect(writeText).toHaveBeenCalledWith("test text");
    expect(result).toBe(true);
  });

  it("returns false on failure", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("Failed"));
    Object.assign(navigator, {
      clipboard: { writeText },
    });

    const result = await copyToClipboard("test text");

    expect(result).toBe(false);
  });
});

describe("generateId", () => {
  it("generates unique IDs", () => {
    const id1 = generateId();
    const id2 = generateId();

    expect(id1).not.toBe(id2);
    expect(id1.length).toBeGreaterThan(5);
  });

  it("generates alphanumeric IDs", () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

// Import vi for debounce test
import { vi } from "vitest";
