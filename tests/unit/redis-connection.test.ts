import { describe, it, expect, beforeEach } from "vitest";
import { vi } from "vitest";

const mockConfig = vi.hoisted(() => ({
  REDIS_URL: "redis://localhost:6379" as string,
  REDIS_HOST: undefined as string | undefined,
  REDIS_PORT: undefined as number | undefined,
  REDIS_PASSWORD: undefined as string | undefined,
  REDIS_TLS: false as boolean,
}));

vi.mock("../../src/utils/config.js", () => ({
  config: mockConfig,
}));

import {
  resolveRedisConnection,
  resolveRedisUrl,
} from "../../src/db/redis-connection.js";

describe("redis-connection", () => {
  beforeEach(() => {
    mockConfig.REDIS_URL = "redis://localhost:6379";
    mockConfig.REDIS_HOST = undefined;
    mockConfig.REDIS_PORT = undefined;
    mockConfig.REDIS_PASSWORD = undefined;
    mockConfig.REDIS_TLS = false;
  });

  // ============================================
  // resolveRedisConnection — explicit vars path
  // ============================================
  describe("resolveRedisConnection — explicit vars (REDIS_HOST set)", () => {
    it("returns host/port/password from explicit vars", () => {
      mockConfig.REDIS_HOST = "db.example.com";
      mockConfig.REDIS_PORT = 6380;
      mockConfig.REDIS_PASSWORD = "s3cr3t";

      const opts = resolveRedisConnection();

      expect(opts.host).toBe("db.example.com");
      expect(opts.port).toBe(6380);
      expect(opts.password).toBe("s3cr3t");
      expect(opts.maxRetriesPerRequest).toBeNull();
    });

    it("defaults port to 6379 when REDIS_PORT is not set", () => {
      mockConfig.REDIS_HOST = "db.example.com";

      const opts = resolveRedisConnection();

      expect(opts.port).toBe(6379);
    });

    it("omits password when REDIS_PASSWORD is not set", () => {
      mockConfig.REDIS_HOST = "db.example.com";

      const opts = resolveRedisConnection();

      expect(opts.password).toBeUndefined();
    });

    it("includes TLS options when REDIS_TLS is true", () => {
      mockConfig.REDIS_HOST = "db.example.com";
      mockConfig.REDIS_TLS = true;

      const opts = resolveRedisConnection();

      expect(opts.tls).toEqual({ rejectUnauthorized: false });
    });

    it("omits TLS when REDIS_TLS is false", () => {
      mockConfig.REDIS_HOST = "db.example.com";
      mockConfig.REDIS_TLS = false;

      const opts = resolveRedisConnection();

      expect(opts.tls).toBeUndefined();
    });

    it("ignores REDIS_URL entirely when REDIS_HOST is set", () => {
      mockConfig.REDIS_HOST = "explicit-host.com";
      mockConfig.REDIS_URL = "redis://other-host.com:9999";

      const opts = resolveRedisConnection();

      expect(opts.host).toBe("explicit-host.com");
      expect(opts.port).toBe(6379);
    });
  });

  // ============================================
  // resolveRedisConnection — URL parsing path
  // ============================================
  describe("resolveRedisConnection — URL parsing (REDIS_HOST not set)", () => {
    it("parses host and port from a standard redis:// URL", () => {
      mockConfig.REDIS_URL = "redis://cache.internal:6380";

      const opts = resolveRedisConnection();

      expect(opts.host).toBe("cache.internal");
      expect(opts.port).toBe(6380);
      expect(opts.tls).toBeUndefined();
    });

    it("enables TLS for a rediss:// URL", () => {
      mockConfig.REDIS_URL = "rediss://cache.internal:6380";

      const opts = resolveRedisConnection();

      expect(opts.tls).toEqual({ rejectUnauthorized: false });
    });

    it("enables TLS when REDIS_TLS is true even for a redis:// URL", () => {
      mockConfig.REDIS_URL = "redis://cache.internal:6379";
      mockConfig.REDIS_TLS = true;

      const opts = resolveRedisConnection();

      expect(opts.tls).toEqual({ rejectUnauthorized: false });
    });

    it("extracts password from URL", () => {
      mockConfig.REDIS_URL = "redis://:mypassword@cache.internal:6379";

      const opts = resolveRedisConnection();

      expect(opts.password).toBe("mypassword");
    });

    it("decodes percent-encoded password from URL", () => {
      mockConfig.REDIS_URL = "redis://:p%40ssw0rd@cache.internal:6379";

      const opts = resolveRedisConnection();

      expect(opts.password).toBe("p@ssw0rd");
    });

    it("prefers REDIS_PASSWORD over URL-embedded password", () => {
      mockConfig.REDIS_URL = "redis://:url-password@cache.internal:6379";
      mockConfig.REDIS_PASSWORD = "env-password";

      const opts = resolveRedisConnection();

      expect(opts.password).toBe("env-password");
    });

    it("extracts username from URL", () => {
      mockConfig.REDIS_URL = "redis://alice:secret@cache.internal:6379";

      const opts = resolveRedisConnection();

      expect(opts.username).toBe("alice");
    });

    it("extracts db number from URL path", () => {
      mockConfig.REDIS_URL = "redis://cache.internal:6379/3";

      const opts = resolveRedisConnection();

      expect(opts.db).toBe(3);
    });

    it("defaults db to 0 when URL path is empty", () => {
      mockConfig.REDIS_URL = "redis://cache.internal:6379";

      const opts = resolveRedisConnection();

      expect(opts.db).toBe(0);
    });

    it("guards against empty hostname — falls back to localhost", () => {
      // Some managed-DB bindings produce URLs where hostname is empty
      mockConfig.REDIS_URL = "redis://:6379";

      const opts = resolveRedisConnection();

      expect(opts.host).toBe("localhost");
    });

    it("returns safe defaults for an unparseable URL", () => {
      mockConfig.REDIS_URL = "not-a-valid-url";

      const opts = resolveRedisConnection();

      expect(opts.host).toBe("localhost");
      expect(opts.port).toBe(6379);
      expect(opts.maxRetriesPerRequest).toBeNull();
    });

    it("always sets maxRetriesPerRequest to null (required by BullMQ)", () => {
      mockConfig.REDIS_URL = "redis://cache.internal:6379";

      const opts = resolveRedisConnection();

      expect(opts.maxRetriesPerRequest).toBeNull();
    });
  });

  // ============================================
  // resolveRedisUrl — explicit vars path
  // ============================================
  describe("resolveRedisUrl — explicit vars (REDIS_HOST set)", () => {
    it("builds a redis:// URL without TLS", () => {
      mockConfig.REDIS_HOST = "cache.internal";
      mockConfig.REDIS_PORT = 6379;
      mockConfig.REDIS_TLS = false;

      expect(resolveRedisUrl()).toBe("redis://cache.internal:6379");
    });

    it("builds a rediss:// URL with TLS", () => {
      mockConfig.REDIS_HOST = "cache.internal";
      mockConfig.REDIS_PORT = 6380;
      mockConfig.REDIS_TLS = true;

      expect(resolveRedisUrl()).toBe("rediss://cache.internal:6380");
    });

    it("includes percent-encoded password in URL", () => {
      mockConfig.REDIS_HOST = "cache.internal";
      mockConfig.REDIS_PORT = 6379;
      mockConfig.REDIS_PASSWORD = "p@ssw0rd";
      mockConfig.REDIS_TLS = false;

      const url = resolveRedisUrl();

      expect(url).toBe("redis://:p%40ssw0rd@cache.internal:6379");
    });

    it("omits auth when no password", () => {
      mockConfig.REDIS_HOST = "cache.internal";
      mockConfig.REDIS_PORT = 6379;

      const url = resolveRedisUrl();

      expect(url).not.toContain("@");
    });

    it("defaults port to 6379 when REDIS_PORT is not set", () => {
      mockConfig.REDIS_HOST = "cache.internal";

      expect(resolveRedisUrl()).toBe("redis://cache.internal:6379");
    });
  });

  // ============================================
  // resolveRedisUrl — URL path
  // ============================================
  describe("resolveRedisUrl — URL passthrough (REDIS_HOST not set)", () => {
    it("returns REDIS_URL as-is when no separate password", () => {
      mockConfig.REDIS_URL = "redis://cache.internal:6379";

      expect(resolveRedisUrl()).toBe("redis://cache.internal:6379");
    });

    it("injects REDIS_PASSWORD into URL when URL has no password", () => {
      mockConfig.REDIS_URL = "redis://cache.internal:6379";
      mockConfig.REDIS_PASSWORD = "injected";

      const url = resolveRedisUrl();

      expect(url).toContain("injected");
      expect(url).toContain("cache.internal");
    });

    it("does not inject password if URL already has one", () => {
      mockConfig.REDIS_URL = "redis://:existing@cache.internal:6379";
      mockConfig.REDIS_PASSWORD = "should-not-appear";

      const url = resolveRedisUrl();

      expect(url).not.toContain("should-not-appear");
      expect(url).toContain("existing");
    });

    it("returns raw REDIS_URL when URL is unparseable and password injection fails", () => {
      mockConfig.REDIS_URL = "not-a-url";
      mockConfig.REDIS_PASSWORD = "secret";

      expect(resolveRedisUrl()).toBe("not-a-url");
    });
  });
});
