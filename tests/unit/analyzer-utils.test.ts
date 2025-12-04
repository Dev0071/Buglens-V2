import { describe, it, expect } from "vitest";
import {
  parseReleaseString,
  extractRepoFromPayload,
  extractEventPayload,
} from "../../src/services/analyzer-utils.js";

describe("analyzer utils", () => {
  describe("extractEventPayload", () => {
    it("returns payload when it already looks like a Sentry event", () => {
      const payload = { contexts: { app: {} }, exception: {} };
      expect(extractEventPayload(payload)).toBe(payload);
    });

    it("unwraps envelope payloads under data.error", () => {
      const payload = {
        action: "created",
        data: {
          error: {
            contexts: { github: { repository: "owner/repo" } },
            exception: {},
          },
        },
      };

      expect(extractEventPayload(payload)).toEqual(payload.data.error);
    });

    it("returns null for non-event payloads", () => {
      expect(extractEventPayload({ foo: "bar" })).toBeNull();
      expect(extractEventPayload(null)).toBeNull();
    });
  });

  describe("parseReleaseString", () => {
    it("parses owner/repo@sha format", () => {
      const result = parseReleaseString("acme/api@abcdef1");
      expect(result).toEqual({
        repoFullName: "acme/api",
        commitSha: "abcdef1",
      });
    });

    it("returns null for invalid release", () => {
      expect(parseReleaseString("acme/api#main")).toBeNull();
    });
  });

  describe("extractRepoFromPayload", () => {
    it("reads repository and commit from contexts", () => {
      const payload = {
        contexts: {
          github: {
            repository: "acme/api",
            commit: "deadbeef",
          },
        },
      };

      const result = extractRepoFromPayload(payload);
      expect(result).toEqual({
        repoFullName: "acme/api",
        commitSha: "deadbeef",
      });
    });

    it("falls back to tags when contexts missing", () => {
      const payload = {
        tags: {
          repo: "acme/web",
          git_sha: "1234567",
        },
      };

      const result = extractRepoFromPayload(payload);
      expect(result).toEqual({
        repoFullName: "acme/web",
        commitSha: "1234567",
      });
    });

    it("supports array-based tags inside envelopes", () => {
      const payload = {
        data: {
          error: {
            tags: [
              ["repo", "envelope/repo"],
              ["git_sha", "ffffffff"],
            ],
            exception: {},
          },
        },
      };

      const result = extractRepoFromPayload(payload);
      expect(result).toEqual({
        repoFullName: "envelope/repo",
        commitSha: "ffffffff",
      });
    });

    it("returns null when repository not present", () => {
      expect(extractRepoFromPayload({ contexts: {} })).toBeNull();
    });
  });
});
