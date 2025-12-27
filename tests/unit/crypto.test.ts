/**
 * Crypto Service Tests
 *
 * Tests for:
 * - AES-256-GCM encryption/decryption
 * - Organization-specific key derivation
 * - Platform-level encryption
 * - Error handling for tampered data
 */

import { describe, it, expect, vi } from "vitest";

// Mock config before imports
vi.mock("../../src/utils/config.js", () => ({
  config: {
    JWT_SECRET: "test-jwt-secret-at-least-32-chars-long-for-testing",
    NODE_ENV: "test",
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import {
  encryptForOrg,
  decryptForOrg,
  encryptJsonForOrg,
  decryptJsonForOrg,
} from "../../src/services/crypto.js";

describe("Crypto Service", () => {
  describe("Basic Encryption/Decryption", () => {
    it("should encrypt and decrypt string data", () => {
      const orgId = "test-org-123";
      const plaintext = "Hello, World!";

      const encrypted = encryptForOrg(plaintext, orgId);
      const decrypted = decryptForOrg(encrypted, orgId);

      expect(decrypted).toBe(plaintext);
    });

    it("should encrypt and decrypt object data", () => {
      const orgId = "test-org-456";
      const data = {
        accessToken: "gho_xxxxxxxxxxxx",
        refreshToken: "ghr_xxxxxxxxxxxx",
        expiresAt: "2024-12-31T23:59:59Z",
      };

      const encrypted = encryptJsonForOrg(data, orgId);
      const decrypted = decryptJsonForOrg<typeof data>(encrypted, orgId);

      expect(decrypted).toEqual(data);
    });

    it("should handle empty strings", () => {
      const orgId = "test-org";
      const plaintext = "";

      const encrypted = encryptForOrg(plaintext, orgId);
      const decrypted = decryptForOrg(encrypted, orgId);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle special characters", () => {
      const orgId = "test-org";
      const plaintext = "特殊文字 🔐 emoji & symbols: @#$%^&*()";

      const encrypted = encryptForOrg(plaintext, orgId);
      const decrypted = decryptForOrg(encrypted, orgId);

      expect(decrypted).toBe(plaintext);
    });

    it("should handle large data", () => {
      const orgId = "test-org";
      const plaintext = "x".repeat(100000); // 100KB

      const encrypted = encryptForOrg(plaintext, orgId);
      const decrypted = decryptForOrg(encrypted, orgId);

      expect(decrypted).toBe(plaintext);
    });
  });

  describe("Organization Isolation", () => {
    it("should produce different ciphertexts for same data with different orgs", () => {
      const plaintext = "same-secret-data";

      const encrypted1 = encryptForOrg(plaintext, "org-1");
      const encrypted2 = encryptForOrg(plaintext, "org-2");

      expect(encrypted1.data).not.toBe(encrypted2.data);
    });

    it("should fail to decrypt with wrong org key", () => {
      const plaintext = "secret-data";
      const encrypted = encryptForOrg(plaintext, "org-1");

      // Attempting to decrypt with different org should fail
      expect(() => {
        decryptForOrg(encrypted, "org-2");
      }).toThrow();
    });

    it("should successfully decrypt with correct org key", () => {
      const orgId = "my-org";
      const plaintext = "secret-data";
      const encrypted = encryptForOrg(plaintext, orgId);

      const decrypted = decryptForOrg(encrypted, orgId);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe("Encryption Uniqueness", () => {
    it("should produce different ciphertexts for same data (unique IV)", () => {
      const orgId = "test-org";
      const plaintext = "same-data";

      const encrypted1 = encryptForOrg(plaintext, orgId);
      const encrypted2 = encryptForOrg(plaintext, orgId);

      // Same plaintext should produce different ciphertexts due to random IV
      expect(encrypted1.data).not.toBe(encrypted2.data);
    });

    it("should include version number for key rotation support", () => {
      const orgId = "test-org";
      const encrypted = encryptForOrg("data", orgId);

      expect(encrypted.version).toBeDefined();
      expect(typeof encrypted.version).toBe("number");
      expect(encrypted.version).toBe(1);
    });
  });

  describe("Tamper Detection", () => {
    it("should fail to decrypt tampered ciphertext", () => {
      const orgId = "test-org";
      const encrypted = encryptForOrg("secret", orgId);

      // Tamper with the ciphertext
      const tamperedData = Buffer.from(encrypted.data, "base64");
      tamperedData[tamperedData.length - 1] ^= 0xff;
      encrypted.data = tamperedData.toString("base64");

      expect(() => {
        decryptForOrg(encrypted, orgId);
      }).toThrow();
    });

    it("should fail to decrypt with modified auth tag", () => {
      const orgId = "test-org";
      const encrypted = encryptForOrg("secret", orgId);

      // Tamper with auth tag area (bytes 17-32)
      const tamperedData = Buffer.from(encrypted.data, "base64");
      tamperedData[20] ^= 0xff;
      encrypted.data = tamperedData.toString("base64");

      expect(() => {
        decryptForOrg(encrypted, orgId);
      }).toThrow();
    });

    it("should fail to decrypt with modified IV", () => {
      const orgId = "test-org";
      const encrypted = encryptForOrg("secret", orgId);

      // Tamper with IV area (bytes 1-16)
      const tamperedData = Buffer.from(encrypted.data, "base64");
      tamperedData[5] ^= 0xff;
      encrypted.data = tamperedData.toString("base64");

      expect(() => {
        decryptForOrg(encrypted, orgId);
      }).toThrow();
    });
  });

  describe("JSON Encryption", () => {
    it("should encrypt and decrypt complex nested objects", () => {
      const orgId = "test-org";
      const data = {
        tokens: {
          access: "abc123",
          refresh: "def456",
        },
        metadata: {
          scopes: ["read", "write"],
          expiresAt: new Date().toISOString(),
        },
        nested: {
          deep: {
            value: true,
          },
        },
      };

      const encrypted = encryptJsonForOrg(data, orgId);
      const decrypted = decryptJsonForOrg<typeof data>(encrypted, orgId);

      expect(decrypted).toEqual(data);
    });

    it("should handle arrays", () => {
      const orgId = "test-org";
      const data = [1, 2, 3, "four", { five: 5 }];

      const encrypted = encryptJsonForOrg(data, orgId);
      const decrypted = decryptJsonForOrg<typeof data>(encrypted, orgId);

      expect(decrypted).toEqual(data);
    });

    it("should handle null values", () => {
      const orgId = "test-org";
      const data = { value: null, nested: { also: null } };

      const encrypted = encryptJsonForOrg(data, orgId);
      const decrypted = decryptJsonForOrg<typeof data>(encrypted, orgId);

      expect(decrypted).toEqual(data);
    });
  });

  describe("Error Handling", () => {
    it("should throw on invalid base64 data", () => {
      const orgId = "test-org";
      const invalidEncrypted = {
        version: 1,
        data: "not-valid-base64!!!",
      };

      expect(() => {
        decryptForOrg(invalidEncrypted, orgId);
      }).toThrow();
    });

    it("should throw on truncated data", () => {
      const orgId = "test-org";
      const encrypted = encryptForOrg("secret", orgId);

      // Truncate the data
      const truncated = Buffer.from(encrypted.data, "base64");
      encrypted.data = truncated.subarray(0, 10).toString("base64");

      expect(() => {
        decryptForOrg(encrypted, orgId);
      }).toThrow();
    });

    it("should throw on missing version", () => {
      const orgId = "test-org";
      const encrypted = encryptForOrg("secret", orgId);

      // Remove version byte
      const data = Buffer.from(encrypted.data, "base64");
      encrypted.data = data.subarray(1).toString("base64");

      expect(() => {
        decryptForOrg(encrypted, orgId);
      }).toThrow();
    });
  });
});
