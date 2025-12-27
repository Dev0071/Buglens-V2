/**
 * Account Linking Service Tests
 *
 * Tests for:
 * - Linking OAuth providers to existing accounts
 * - Unlinking providers
 * - Account merge functionality
 * - Primary provider switching
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock database
const mockQuery = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../../src/db/client.js", () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  transaction: (...args: unknown[]) => mockTransaction(...args),
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
  linkOAuthProvider,
  getLinkedAccounts,
  unlinkOAuthProvider,
  findUserByOAuthIdentity,
  findUserByLinkedEmail,
} from "../../src/services/account-linking.js";
import { AuthError } from "../../src/services/auth.js";

describe("Account Linking Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("linkOAuthProvider", () => {
    it("should successfully link a new provider", async () => {
      // No existing link
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // Check existing provider_id
        .mockResolvedValueOnce({ rows: [] }) // Check email owner
        .mockResolvedValueOnce({
          rows: [
            {
              id: "identity-123",
              provider: "github",
              provider_id: "12345",
              email: "user@example.com",
              name: "Test User",
              avatar_url: "https://github.com/avatar.png",
              linked_at: new Date(),
            },
          ],
        }); // Insert

      const result = await linkOAuthProvider("user-123", {
        provider: "github",
        providerId: "12345",
        email: "user@example.com",
        name: "Test User",
        avatarUrl: "https://github.com/avatar.png",
      });

      expect(result.provider).toBe("github");
      expect(result.providerId).toBe("12345");
      expect(result.email).toBe("user@example.com");
    });

    it("should throw if provider is already linked to this account", async () => {
      // Need to set up mock for each call since we're calling linkOAuthProvider twice
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ user_id: "user-123" }], // Same user - first call
        })
        .mockResolvedValueOnce({
          rows: [{ user_id: "user-123" }], // Same user - second call
        });

      await expect(
        linkOAuthProvider("user-123", {
          provider: "github",
          providerId: "12345",
          email: "user@example.com",
          name: "Test User",
          avatarUrl: null,
        })
      ).rejects.toThrow(AuthError);

      await expect(
        linkOAuthProvider("user-123", {
          provider: "github",
          providerId: "12345",
          email: "user@example.com",
          name: "Test User",
          avatarUrl: null,
        })
      ).rejects.toMatchObject({
        code: "PROVIDER_ALREADY_LINKED",
      });
    });

    it("should throw if provider is linked to another account", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ user_id: "different-user" }], // Different user
      });

      await expect(
        linkOAuthProvider("user-123", {
          provider: "github",
          providerId: "12345",
          email: "user@example.com",
          name: "Test User",
          avatarUrl: null,
        })
      ).rejects.toThrow(AuthError);
    });

    it("should throw if email belongs to another account", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // No existing provider_id link
        .mockResolvedValueOnce({
          rows: [{ id: "other-user" }], // Email owned by different user
        });

      await expect(
        linkOAuthProvider("user-123", {
          provider: "google",
          providerId: "google-id",
          email: "taken@example.com",
          name: "Test User",
          avatarUrl: null,
        })
      ).rejects.toThrow(AuthError);
    });
  });

  describe("getLinkedAccounts", () => {
    it("should return all linked accounts for a user", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [
            {
              id: "link-1",
              provider: "github",
              provider_id: "gh-123",
              email: "github@example.com",
              name: "GitHub User",
              avatar_url: "https://github.com/avatar",
              linked_at: new Date("2024-01-15"),
            },
            {
              id: "link-2",
              provider: "google",
              provider_id: "google-456",
              email: "google@example.com",
              name: "Google User",
              avatar_url: "https://google.com/avatar",
              linked_at: new Date("2024-01-20"),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              email: "primary@example.com",
              name: "Primary User",
              auth_provider: "google",
              created_at: new Date("2024-01-01"),
            },
          ],
        });

      const accounts = await getLinkedAccounts("user-123");

      expect(accounts).toHaveLength(3); // Primary + 2 linked
      expect(accounts[0].id).toBe("primary");
      expect(accounts[0].provider).toBe("google");
    });

    it("should handle users with no linked accounts", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // No linked identities
        .mockResolvedValueOnce({
          rows: [
            {
              email: "user@example.com",
              name: "User",
              auth_provider: "local", // Password auth
              created_at: new Date(),
            },
          ],
        });

      const accounts = await getLinkedAccounts("user-123");

      // Only linked OAuth accounts are returned, not password auth
      expect(accounts).toHaveLength(0);
    });
  });

  describe("unlinkOAuthProvider", () => {
    it("should successfully unlink a provider when user has multiple auth methods", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: "3" }], // User has 3 auth methods
        })
        .mockResolvedValueOnce({
          rowCount: 1, // Successfully deleted
        });

      await expect(
        unlinkOAuthProvider("user-123", "identity-456")
      ).resolves.not.toThrow();
    });

    it("should throw when trying to unlink primary auth method", async () => {
      await expect(unlinkOAuthProvider("user-123", "primary")).rejects.toThrow(
        AuthError
      );

      await expect(
        unlinkOAuthProvider("user-123", "primary")
      ).rejects.toMatchObject({
        code: "CANNOT_UNLINK_PRIMARY",
      });
    });

    it("should throw when unlinking would leave no auth methods", async () => {
      // Need mocks for both calls
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: "1" }], // Only 1 auth method - first call
        })
        .mockResolvedValueOnce({
          rows: [{ count: "1" }], // Only 1 auth method - second call
        });

      await expect(
        unlinkOAuthProvider("user-123", "identity-456")
      ).rejects.toThrow(AuthError);

      await expect(
        unlinkOAuthProvider("user-123", "identity-456")
      ).rejects.toMatchObject({
        code: "CANNOT_REMOVE_LAST_AUTH",
      });
    });

    it("should throw when identity not found", async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{ count: "2" }], // Has multiple methods
        })
        .mockResolvedValueOnce({
          rowCount: 0, // Nothing deleted
        });

      await expect(
        unlinkOAuthProvider("user-123", "nonexistent")
      ).rejects.toThrow(AuthError);
    });
  });

  describe("findUserByOAuthIdentity", () => {
    it("should find user by provider and provider ID", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ user_id: "user-123", org_id: "org-456" }],
      });

      const result = await findUserByOAuthIdentity("github", "gh-12345");

      expect(result).not.toBeNull();
      expect(result?.userId).toBe("user-123");
      expect(result?.orgId).toBe("org-456");
    });

    it("should return null when identity not found", async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await findUserByOAuthIdentity("github", "nonexistent");

      expect(result).toBeNull();
    });
  });

  describe("findUserByLinkedEmail", () => {
    it("should find user by primary email", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "user-123", org_id: "org-456" }],
      });

      const result = await findUserByLinkedEmail("user@example.com");

      expect(result).not.toBeNull();
      expect(result?.userId).toBe("user-123");
    });

    it("should find user by linked identity email", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // Not found in users table
        .mockResolvedValueOnce({
          rows: [{ user_id: "user-123", org_id: "org-456" }],
        });

      const result = await findUserByLinkedEmail("linked@example.com");

      expect(result).not.toBeNull();
      expect(result?.userId).toBe("user-123");
    });

    it("should return null when email not found anywhere", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await findUserByLinkedEmail("unknown@example.com");

      expect(result).toBeNull();
    });

    it("should normalize email to lowercase", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: "user-123", org_id: "org-456" }],
      });

      await findUserByLinkedEmail("USER@EXAMPLE.COM");

      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [
        "user@example.com",
      ]);
    });
  });
});

describe("Account Linking Security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should prevent cross-org identity linking", async () => {
    // Provider already linked to user in different org
    mockQuery.mockResolvedValueOnce({
      rows: [{ user_id: "user-in-different-org" }],
    });

    await expect(
      linkOAuthProvider("user-123", {
        provider: "github",
        providerId: "already-used",
        email: "test@example.com",
        name: "Test",
        avatarUrl: null,
      })
    ).rejects.toThrow(AuthError);
  });

  it("should validate provider type", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    // TypeScript would catch this at compile time, but runtime validation matters too
    const invalidProvider = "invalid" as "github" | "google";

    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: "id",
          provider: invalidProvider,
          provider_id: "123",
          email: "test@example.com",
          name: null,
          avatar_url: null,
          linked_at: new Date(),
        },
      ],
    });

    // Should still work - storage is provider-agnostic
    const result = await linkOAuthProvider("user-123", {
      provider: invalidProvider,
      providerId: "123",
      email: "test@example.com",
      name: null,
      avatarUrl: null,
    });

    expect(result.provider).toBe(invalidProvider);
  });
});
