import { describe, it, expect, beforeEach, vi } from "vitest";
import { DeterministicExtractor } from "../../src/services/event-extractor/deterministic-extractor.js";
import type { SentryEventPayload } from "../../src/types/sentry.js";

describe("DeterministicExtractor", () => {
  let extractor: DeterministicExtractor;

  beforeEach(() => {
    extractor = new DeterministicExtractor();
    vi.clearAllMocks();
  });

  describe("extract", () => {
    it("should extract complete data from well-formed Sentry event", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        platform: "javascript",
        environment: "production",
        release: "acme-corp/my-app@a1b2c3d4e5f6",
        exception: {
          values: [
            {
              type: "TypeError",
              value: "Cannot read property 'foo' of undefined",
              stacktrace: {
                frames: [
                  {
                    filename: "src/services/user.ts",
                    lineno: 42,
                    colno: 15,
                    function: "getUser",
                    in_app: true,
                  },
                  {
                    filename: "node_modules/express/lib/router.js",
                    lineno: 100,
                    function: "handle",
                    in_app: false,
                  },
                ],
              },
            },
          ],
        },
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      expect(result.repo).toBe("acme-corp/my-app");
      expect(result.commit_sha).toBe("a1b2c3d4e5f6");
      expect(result.error_type).toBe("TypeError");
      expect(result.error_message).toContain("Cannot read property");
      expect(result.platform).toBe("javascript");
      expect(result.environment).toBe("production");
      expect(result.frames.length).toBeGreaterThan(0);
    });

    it("should classify frames correctly", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        exception: {
          values: [
            {
              type: "Error",
              value: "Test error",
              stacktrace: {
                frames: [
                  { filename: "src/app.ts", lineno: 10, in_app: true },
                  // Don't set in_app:false so classification is based on path patterns
                  { filename: "node_modules/lodash/index.js", lineno: 20 },
                  {
                    filename: "node_modules/react-dom/cjs/react.js",
                    lineno: 30,
                  },
                  {
                    filename: "node_modules/core-js/internals/export.js",
                    lineno: 40,
                  },
                  {
                    filename: "internal/modules/cjs/loader.js",
                    lineno: 50,
                    in_app: false,
                  },
                ],
              },
            },
          ],
        },
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      // Find frames by path
      const srcFrame = result.frames.find((f) =>
        f.file_path.includes("src/app.ts")
      );
      const lodashFrame = result.frames.find((f) =>
        f.file_path.includes("lodash")
      );
      const reactFrame = result.frames.find((f) =>
        f.file_path.includes("react-dom")
      );
      const coreJsFrame = result.frames.find((f) =>
        f.file_path.includes("core-js")
      );

      expect(srcFrame?.classification).toBe("user_code");
      expect(lodashFrame?.classification).toBe("third_party");
      // react-dom in node_modules is correctly classified as framework (React internals)
      expect(reactFrame?.classification).toBe("framework");
      expect(coreJsFrame?.classification).toBe("polyfill");
    });

    it("should identify entry point (root cause candidate)", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        exception: {
          values: [
            {
              type: "Error",
              value: "Test",
              stacktrace: {
                frames: [
                  {
                    filename: "node_modules/express/lib/router.js",
                    lineno: 100,
                    in_app: false,
                  },
                  { filename: "src/routes/users.ts", lineno: 25, in_app: true },
                  {
                    filename: "src/services/auth.ts",
                    lineno: 50,
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      // First user_code frame should be entry point
      const entryPoints = result.frames.filter((f) => f.is_entry_point);
      expect(entryPoints.length).toBe(1);
      expect(entryPoints[0].classification).toBe("user_code");
    });

    it("should extract repo info from tags", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        tags: {
          "github.repo": "my-org/backend",
          commit: "deadbeef12345678",
          branch: "feature/new-api",
        },
        exception: {
          values: [
            {
              type: "Error",
              value: "Test",
              stacktrace: {
                frames: [{ filename: "src/app.ts", lineno: 10, in_app: true }],
              },
            },
          ],
        },
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      expect(result.repo).toBe("my-org/backend");
      expect(result.commit_sha).toBe("deadbeef12345678");
      expect(result.branch).toBe("feature/new-api");
    });

    it("should extract repo info from contexts.github", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        contexts: {
          github: {
            repo: "company/service",
            commit: "abc1234567890",
            branch: "main",
          },
        },
        exception: {
          values: [
            {
              type: "Error",
              value: "Test",
              stacktrace: {
                frames: [{ filename: "src/index.ts", lineno: 1, in_app: true }],
              },
            },
          ],
        },
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      expect(result.repo).toBe("company/service");
      expect(result.commit_sha).toBe("abc1234567890");
      expect(result.branch).toBe("main");
    });

    it("should handle tags as array of tuples", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        tags: [
          ["github.repo", "tuple-org/tuple-repo"],
          ["commit", "abcdef123456789"], // Must be 7-40 hex chars (a-f0-9 only)
        ],
        exception: {
          values: [
            {
              type: "Error",
              value: "Test",
              stacktrace: {
                frames: [{ filename: "src/app.ts", lineno: 10, in_app: true }],
              },
            },
          ],
        },
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      expect(result.repo).toBe("tuple-org/tuple-repo");
      expect(result.commit_sha).toBe("abcdef123456789");
    });

    it("should clean webpack file paths", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        exception: {
          values: [
            {
              type: "Error",
              value: "Test",
              stacktrace: {
                frames: [
                  {
                    filename: "webpack://my-app/./src/components/Button.tsx",
                    lineno: 15,
                    in_app: true,
                  },
                  {
                    filename:
                      "webpack-internal:///./node_modules/react/index.js",
                    lineno: 100,
                    in_app: false,
                  },
                ],
              },
            },
          ],
        },
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      // Should clean webpack prefixes
      const userFrame = result.frames.find(
        (f) => f.classification === "user_code"
      );
      expect(userFrame?.file_path).not.toContain("webpack://");
      expect(userFrame?.file_path).toContain("src/components/Button.tsx");
    });

    it("should filter out noise frames", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        exception: {
          values: [
            {
              type: "Error",
              value: "Test",
              stacktrace: {
                frames: [
                  { filename: "<anonymous>", lineno: 1, in_app: false },
                  { filename: "[native code]", lineno: 1, in_app: false },
                  {
                    filename: "internal/modules/run_main.js",
                    lineno: 1,
                    in_app: false,
                  },
                  { filename: "src/app.ts", lineno: 10, in_app: true },
                ],
              },
            },
          ],
        },
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      // Should only have the user code frame
      expect(result.frames.length).toBe(1);
      expect(result.frames[0].file_path).toContain("src/app.ts");
    });

    it("should mark extraction as incomplete when repo missing", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        exception: {
          values: [
            {
              type: "Error",
              value: "Test",
              stacktrace: {
                frames: [{ filename: "src/app.ts", lineno: 10, in_app: true }],
              },
            },
          ],
        },
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      expect(result.is_complete).toBe(false);
      expect(result.missing_fields).toContain("repo");
    });

    it("should handle empty stacktrace gracefully", async () => {
      const payload: SentryEventPayload = {
        event_id: "abc123",
        timestamp: Date.now(),
        message: "A simple message without stacktrace",
      };

      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: payload,
      });

      expect(result.frames).toHaveLength(0);
      expect(result.is_complete).toBe(false);
    });

    it("should handle malformed payload gracefully", async () => {
      const result = await extractor.extract({
        event_id: "test-event-id",
        org_id: "test-org-id",
        raw_payload: null,
      });

      expect(result.is_complete).toBe(false);
      expect(result.frames).toHaveLength(0);
    });
  });
});
