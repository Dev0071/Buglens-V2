/**
 * Python Bridge Service Tests
 *
 * Tests for:
 * - Successful execution and JSON parsing
 * - Timeout handling
 * - Output size limits
 * - Process error handling
 * - Non-zero exit codes
 * - Input serialization
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "events";
import { Writable } from "stream";

// Create mock child process
const mockStdin = {
  write: vi.fn(),
  end: vi.fn(),
};

const mockStdout = new EventEmitter();
const mockStderr = new EventEmitter();

const mockChild = Object.assign(new EventEmitter(), {
  stdin: mockStdin as unknown as Writable,
  stdout: mockStdout,
  stderr: mockStderr,
  kill: vi.fn(),
});

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(() => mockChild),
}));

// Mock config
vi.mock("../../src/utils/config.js", () => ({
  config: {
    PYTHON_BIN: "python3",
    PYTHON_ANALYZER_TIMEOUT_MS: 30000,
  },
}));

// Mock logger
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { PythonBridge } from "../../src/services/python-bridge.js";
import { spawn } from "child_process";
import { logger } from "../../src/utils/logger.js";

describe("PythonBridge", () => {
  let bridge: PythonBridge;
  const mockSpawn = spawn as ReturnType<typeof vi.fn>;
  const mockLogger = logger as unknown as {
    [key: string]: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Reset EventEmitter listeners
    mockStdout.removeAllListeners();
    mockStderr.removeAllListeners();
    mockChild.removeAllListeners();

    // Reset mock functions
    mockStdin.write.mockClear();
    mockStdin.end.mockClear();
    mockChild.kill.mockClear();

    // Re-create spawn mock to return fresh mockChild
    mockSpawn.mockReturnValue(mockChild);

    bridge = new PythonBridge({ module: "analyzers.js_analyzer" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("execute", () => {
    it("should execute Python module and return parsed JSON", async () => {
      const executePromise = bridge.execute({ code: "const x = 1;" });

      // Simulate successful execution
      setImmediate(() => {
        const resultJson = JSON.stringify({
          findings: [{ type: "info", message: "test" }],
        });
        mockStdout.emit("data", Buffer.from(resultJson));
        mockChild.emit("close", 0);
      });

      await vi.advanceTimersByTimeAsync(0);
      const result = await executePromise;

      expect(result).toEqual({
        findings: [{ type: "info", message: "test" }],
      });
    });

    it("should serialize input payload to stdin", async () => {
      const payload = { code: "const x = 1;", context: { line: 42 } };
      const executePromise = bridge.execute(payload);

      setImmediate(() => {
        mockStdout.emit("data", Buffer.from("{}"));
        mockChild.emit("close", 0);
      });

      await vi.advanceTimersByTimeAsync(0);
      await executePromise;

      expect(mockStdin.write).toHaveBeenCalledWith(JSON.stringify(payload));
      expect(mockStdin.end).toHaveBeenCalled();
    });

    it("should spawn Python process with correct arguments", async () => {
      const executePromise = bridge.execute({});

      setImmediate(() => {
        mockStdout.emit("data", Buffer.from("{}"));
        mockChild.emit("close", 0);
      });

      await vi.advanceTimersByTimeAsync(0);
      await executePromise;

      expect(mockSpawn).toHaveBeenCalledWith(
        "python3",
        ["-m", "analyzers.js_analyzer"],
        expect.objectContaining({
          stdio: ["pipe", "pipe", "pipe"],
          env: expect.objectContaining({
            PYTHONUNBUFFERED: "1",
          }),
        })
      );
    });
  });

  describe("timeout handling", () => {
    it("should kill process after timeout", async () => {
      const executePromise = bridge.execute({}).catch((e) => e);

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(30001);

      const error = await executePromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "Python module analyzers.js_analyzer timed out"
      );
      expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("should use custom timeout when provided", async () => {
      const customBridge = new PythonBridge({
        module: "test.module",
        timeoutMs: 5000,
      });

      const executePromise = customBridge.execute({}).catch((e) => e);

      // Should not timeout at 4999ms
      await vi.advanceTimersByTimeAsync(4999);
      expect(mockChild.kill).not.toHaveBeenCalled();

      // Should timeout at 5001ms
      await vi.advanceTimersByTimeAsync(2);
      expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");

      const error = await executePromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("timed out");
    });
  });

  describe("output size limits", () => {
    it("should reject when stdout exceeds 10MB", async () => {
      const executePromise = bridge.execute({}).catch((e) => e);

      // Send 11MB of data
      const largeChunk = Buffer.alloc(11 * 1024 * 1024, "x");
      setImmediate(() => {
        mockStdout.emit("data", largeChunk);
      });

      await vi.advanceTimersByTimeAsync(0);

      const error = await executePromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("exceeded size limit");
      expect(mockChild.kill).toHaveBeenCalledWith("SIGKILL");
    });

    it("should reject when stderr exceeds 10MB", async () => {
      const executePromise = bridge.execute({}).catch((e) => e);

      const largeChunk = Buffer.alloc(11 * 1024 * 1024, "e");
      setImmediate(() => {
        mockStderr.emit("data", largeChunk);
      });

      await vi.advanceTimersByTimeAsync(0);

      const error = await executePromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "stderr from module analyzers.js_analyzer exceeded size limit"
      );
    });

    it("should accept output just under 10MB", async () => {
      const executePromise = bridge.execute({});

      // Send exactly 10MB minus 1 byte (just allocating it, not using)
      Buffer.alloc(10 * 1024 * 1024 - 1, "x");
      setImmediate(() => {
        // Send valid JSON at the end
        mockStdout.emit("data", Buffer.from('{"result": "ok"}'));
        mockChild.emit("close", 0);
      });

      await vi.advanceTimersByTimeAsync(0);
      const result = await executePromise;

      expect(result).toEqual({ result: "ok" });
    });
  });

  describe("error handling", () => {
    it("should reject on non-zero exit code", async () => {
      const executePromise = bridge.execute({}).catch((e) => e);

      setImmediate(() => {
        mockStderr.emit(
          "data",
          Buffer.from("ImportError: No module named xyz")
        );
        mockChild.emit("close", 1);
      });

      await vi.advanceTimersByTimeAsync(0);

      const error = await executePromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain(
        "Python module analyzers.js_analyzer failed: ImportError: No module named xyz"
      );

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          module: "analyzers.js_analyzer",
          exitCode: 1,
        }),
        "Python analyzer exited with non-zero code"
      );
    });

    it("should include 'unknown error' when stderr is empty", async () => {
      const executePromise = bridge.execute({}).catch((e) => e);

      setImmediate(() => {
        mockChild.emit("close", 1);
      });

      await vi.advanceTimersByTimeAsync(0);

      const error = await executePromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("unknown error");
    });

    it("should reject on spawn error", async () => {
      const executePromise = bridge.execute({}).catch((e) => e);

      setImmediate(() => {
        mockChild.emit("error", new Error("spawn ENOENT"));
      });

      await vi.advanceTimersByTimeAsync(0);

      const error = await executePromise;
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("spawn ENOENT");
    });

    it("should reject on invalid JSON output", async () => {
      const executePromise = bridge.execute({}).catch((e) => e);

      setImmediate(() => {
        mockStdout.emit("data", Buffer.from("not valid json"));
        mockChild.emit("close", 0);
      });

      await vi.advanceTimersByTimeAsync(0);

      const error = await executePromise;
      expect(error).toBeInstanceOf(Error);
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ module: "analyzers.js_analyzer" }),
        "Failed to parse Python output"
      );
    });

    it("should handle empty stdout as empty object", async () => {
      const executePromise = bridge.execute({});

      setImmediate(() => {
        mockChild.emit("close", 0);
      });

      await vi.advanceTimersByTimeAsync(0);
      const result = await executePromise;

      expect(result).toEqual({});
    });
  });

  describe("input serialization", () => {
    it("should handle complex nested objects", async () => {
      const complexPayload = {
        code: "const x = 1;",
        frames: [
          { file: "test.ts", line: 1, column: 5 },
          { file: "test2.ts", line: 10, column: 1 },
        ],
        metadata: {
          repo: "test/repo",
          commit: "abc123",
          nested: { deep: { value: true } },
        },
      };

      const executePromise = bridge.execute(complexPayload);

      setImmediate(() => {
        mockStdout.emit("data", Buffer.from("{}"));
        mockChild.emit("close", 0);
      });

      await vi.advanceTimersByTimeAsync(0);
      await executePromise;

      expect(mockStdin.write).toHaveBeenCalledWith(
        JSON.stringify(complexPayload)
      );
    });

    it("should handle unicode characters", async () => {
      const unicodePayload = {
        code: "const emoji = '🎉';",
        message: "日本語テスト",
      };

      const executePromise = bridge.execute(unicodePayload);

      setImmediate(() => {
        mockStdout.emit("data", Buffer.from("{}"));
        mockChild.emit("close", 0);
      });

      await vi.advanceTimersByTimeAsync(0);
      await executePromise;

      expect(mockStdin.write).toHaveBeenCalledWith(
        JSON.stringify(unicodePayload)
      );
    });
  });

  describe("multiple executions", () => {
    it("should handle sequential executions", async () => {
      // First execution
      const exec1 = bridge.execute({ id: 1 });
      setImmediate(() => {
        mockStdout.emit("data", Buffer.from('{"result": 1}'));
        mockChild.emit("close", 0);
      });
      await vi.advanceTimersByTimeAsync(0);
      const result1 = await exec1;
      expect(result1).toEqual({ result: 1 });

      // Reset for second execution
      mockStdout.removeAllListeners();
      mockStderr.removeAllListeners();
      mockChild.removeAllListeners();

      // Second execution
      const exec2 = bridge.execute({ id: 2 });
      setImmediate(() => {
        mockStdout.emit("data", Buffer.from('{"result": 2}'));
        mockChild.emit("close", 0);
      });
      await vi.advanceTimersByTimeAsync(0);
      const result2 = await exec2;
      expect(result2).toEqual({ result: 2 });
    });
  });

  describe("chunked output", () => {
    it("should handle output received in multiple chunks", async () => {
      const executePromise = bridge.execute({});

      setImmediate(() => {
        // Send JSON in multiple chunks
        mockStdout.emit("data", Buffer.from('{"find'));
        mockStdout.emit("data", Buffer.from('ings": ['));
        mockStdout.emit("data", Buffer.from('{"id": 1}'));
        mockStdout.emit("data", Buffer.from("]}"));
        mockChild.emit("close", 0);
      });

      await vi.advanceTimersByTimeAsync(0);
      const result = await executePromise;

      expect(result).toEqual({ findings: [{ id: 1 }] });
    });
  });
});
