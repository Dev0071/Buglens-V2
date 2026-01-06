/**
 * Notification Service Unit Tests
 *
 * Tests for NotificationService covering:
 * - Pure formatter functions (Slack and Teams)
 * - Slack API integration
 * - Teams API integration
 * - Notification preferences
 * - Error handling and retries
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock dependencies before imports
vi.mock("../../src/services/integration-tokens.js", () => ({
  getSlackWorkspace: vi.fn(),
  getIntegrationTokensByType: vi.fn(),
}));

vi.mock("../../src/db/client.js", () => ({
  query: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

import {
  NotificationService,
  formatSlackEventMessage,
  formatSlackRCAMessage,
  formatTeamsEventCard,
  formatTeamsRCACard,
  type EventNotificationData,
  type RCANotificationData,
} from "../../src/services/notification-service.js";
import {
  getSlackWorkspace,
  getIntegrationTokensByType,
} from "../../src/services/integration-tokens.js";
import { query } from "../../src/db/client.js";

// =============================================================================
// TEST FIXTURES
// =============================================================================

const createEventData = (
  overrides: Partial<EventNotificationData> = {}
): EventNotificationData => ({
  eventId: "event-123",
  eventTitle: "TypeError in getUser",
  eventMessage: "Cannot read property 'name' of undefined",
  severity: "error",
  errorType: "TypeError",
  timestamp: "2024-01-15T10:30:00Z",
  projectName: "backend-api",
  environment: "production",
  url: "https://app.buglens.com/events/event-123",
  ...overrides,
});

const createRCAData = (
  overrides: Partial<RCANotificationData> = {}
): RCANotificationData => ({
  rcaId: "rca-456",
  eventId: "event-123",
  eventTitle: "TypeError in getUser",
  rootCause: "Missing null check before accessing user.name property",
  confidence: 0.85,
  severity: "high",
  suggestedFix: "Add null check: if (!user) return null;",
  affectedFile: "src/services/user.ts",
  affectedLine: 42,
  timestamp: "2024-01-15T10:35:00Z",
  analysisTimeMs: 2500,
  url: "https://app.buglens.com/rca/rca-456",
  ...overrides,
});

const mockSlackWorkspace = {
  workspace: {
    accessToken: "xoxb-mock-token",
    incomingWebhook: {
      channelId: "#alerts",
    },
  },
};

const mockTeamsIntegration = {
  tokens: {
    accessToken: "teams-mock-token",
  },
};

// =============================================================================
// PURE FUNCTION TESTS - SLACK FORMATTERS
// =============================================================================

describe("formatSlackEventMessage", () => {
  it("should create properly formatted Slack message", () => {
    const data = createEventData();
    const message = formatSlackEventMessage(data);

    expect(message.text).toContain("error");
    expect(message.text).toContain("TypeError in getUser");
    expect(message.blocks).toBeDefined();
    expect(message.blocks.length).toBeGreaterThan(0);
  });

  it("should include correct emoji for each severity", () => {
    const errorMessage = formatSlackEventMessage(
      createEventData({ severity: "error" })
    );
    const warningMessage = formatSlackEventMessage(
      createEventData({ severity: "warning" })
    );
    const infoMessage = formatSlackEventMessage(
      createEventData({ severity: "info" })
    );

    expect(errorMessage.text).toContain("🔴");
    expect(warningMessage.text).toContain("🟡");
    expect(infoMessage.text).toContain("🔵");
  });

  it("should include header block", () => {
    const data = createEventData();
    const message = formatSlackEventMessage(data);

    const headerBlock = message.blocks.find((b) => b.type === "header");
    expect(headerBlock).toBeDefined();
    expect(headerBlock?.text?.text).toContain("New Error Detected");
  });

  it("should include fields for error type, severity, project, environment", () => {
    const data = createEventData({
      errorType: "ReferenceError",
      severity: "warning",
      projectName: "frontend",
      environment: "staging",
    });
    const message = formatSlackEventMessage(data);

    const sectionWithFields = message.blocks.find((b) => b.fields);
    expect(sectionWithFields).toBeDefined();
    expect(sectionWithFields?.fields?.length).toBe(4);

    const fieldTexts = sectionWithFields?.fields?.map((f) => f.text).join(" ");
    expect(fieldTexts).toContain("ReferenceError");
    expect(fieldTexts).toContain("Warning");
    expect(fieldTexts).toContain("frontend");
    expect(fieldTexts).toContain("staging");
  });

  it("should include action button when URL is provided", () => {
    const data = createEventData({ url: "https://app.buglens.com/events/123" });
    const message = formatSlackEventMessage(data);

    const actionsBlock = message.blocks.find((b) => b.type === "actions");
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock?.elements?.[0].url).toBe(
      "https://app.buglens.com/events/123"
    );
  });

  it("should NOT include action button when URL is missing", () => {
    const data = createEventData({ url: undefined });
    const message = formatSlackEventMessage(data);

    const actionsBlock = message.blocks.find((b) => b.type === "actions");
    expect(actionsBlock).toBeUndefined();
  });

  it("should escape Slack special characters", () => {
    const data = createEventData({
      eventTitle: "Error: <script>alert('xss')</script>",
      eventMessage: "Value & reference < comparison >",
    });
    const message = formatSlackEventMessage(data);

    const sectionBlock = message.blocks.find(
      (b) => b.type === "section" && b.text?.type === "mrkdwn"
    );
    expect(sectionBlock?.text?.text).toContain("&lt;script&gt;");
    expect(sectionBlock?.text?.text).toContain("&amp;");
  });

  it("should handle missing optional fields gracefully", () => {
    const data = createEventData({
      errorType: undefined,
      projectName: undefined,
      environment: undefined,
      url: undefined,
    });
    const message = formatSlackEventMessage(data);

    expect(message.blocks.length).toBeGreaterThan(0);
    const sectionWithFields = message.blocks.find((b) => b.fields);
    const fieldTexts = sectionWithFields?.fields?.map((f) => f.text).join(" ");
    expect(fieldTexts).toContain("Unknown");
    expect(fieldTexts).toContain("N/A");
  });
});

describe("formatSlackRCAMessage", () => {
  it("should create properly formatted RCA message", () => {
    const data = createRCAData();
    const message = formatSlackRCAMessage(data);

    expect(message.text).toContain("RCA Complete");
    expect(message.text).toContain("TypeError in getUser");
    expect(message.blocks.length).toBeGreaterThan(0);
  });

  it("should include root cause section", () => {
    const data = createRCAData({ rootCause: "Database connection timeout" });
    const message = formatSlackRCAMessage(data);

    const rootCauseBlock = message.blocks.find(
      (b) => b.type === "section" && b.text?.text?.includes("Root Cause")
    );
    expect(rootCauseBlock).toBeDefined();
    expect(rootCauseBlock?.text?.text).toContain("Database connection timeout");
  });

  it("should include suggested fix when provided", () => {
    const data = createRCAData({ suggestedFix: "Add retry logic" });
    const message = formatSlackRCAMessage(data);

    const fixBlock = message.blocks.find(
      (b) => b.type === "section" && b.text?.text?.includes("Suggested Fix")
    );
    expect(fixBlock).toBeDefined();
    expect(fixBlock?.text?.text).toContain("Add retry logic");
  });

  it("should NOT include suggested fix when missing", () => {
    const data = createRCAData({ suggestedFix: undefined });
    const message = formatSlackRCAMessage(data);

    const fixBlock = message.blocks.find(
      (b) => b.type === "section" && b.text?.text?.includes("Suggested Fix")
    );
    expect(fixBlock).toBeUndefined();
  });

  it("should include file location when provided", () => {
    const data = createRCAData({
      affectedFile: "src/utils/db.ts",
      affectedLine: 156,
    });
    const message = formatSlackRCAMessage(data);

    const locationBlock = message.blocks.find(
      (b) => b.type === "section" && b.text?.text?.includes("Location")
    );
    expect(locationBlock).toBeDefined();
    expect(locationBlock?.text?.text).toContain("src/utils/db.ts:156");
  });

  it("should display confidence as percentage", () => {
    const data = createRCAData({ confidence: 0.927 });
    const message = formatSlackRCAMessage(data);

    const metadataBlock = message.blocks.find((b) => b.fields);
    const confidenceField = metadataBlock?.fields?.find((f) =>
      f.text.includes("Confidence")
    );
    expect(confidenceField?.text).toContain("93%");
  });

  it("should include analysis time in context", () => {
    const data = createRCAData({ analysisTimeMs: 3500 });
    const message = formatSlackRCAMessage(data);

    const contextBlock = message.blocks.find((b) => b.type === "context");
    const hasAnalysisTime = contextBlock?.elements?.some(
      (e) => typeof e.text === "string" && e.text.includes("3500ms")
    );
    expect(hasAnalysisTime).toBe(true);
  });

  it("should use correct severity emoji", () => {
    const criticalMessage = formatSlackRCAMessage(
      createRCAData({ severity: "critical" })
    );
    const lowMessage = formatSlackRCAMessage(
      createRCAData({ severity: "low" })
    );

    expect(criticalMessage.text).toContain("🔴");
    expect(lowMessage.text).toContain("🟢");
  });
});

// =============================================================================
// PURE FUNCTION TESTS - TEAMS FORMATTERS
// =============================================================================

describe("formatTeamsEventCard", () => {
  it("should create properly formatted Teams card", () => {
    const data = createEventData();
    const card = formatTeamsEventCard(data);

    expect(card["@type"]).toBe("MessageCard");
    expect(card["@context"]).toBe("http://schema.org/extensions");
    expect(card.summary).toContain("error");
  });

  it("should include theme color based on severity", () => {
    const errorCard = formatTeamsEventCard(
      createEventData({ severity: "error" })
    );
    const warningCard = formatTeamsEventCard(
      createEventData({ severity: "warning" })
    );
    const infoCard = formatTeamsEventCard(
      createEventData({ severity: "info" })
    );

    expect(errorCard.themeColor).toBe("#dc2626"); // Red
    expect(warningCard.themeColor).toBe("#ca8a04"); // Yellow
    expect(infoCard.themeColor).toBe("#2563eb"); // Blue
  });

  it("should include all facts in section", () => {
    const data = createEventData();
    const card = formatTeamsEventCard(data);

    const facts = card.sections[0].facts;
    expect(facts?.length).toBe(5);

    const factNames = facts?.map((f) => f.name);
    expect(factNames).toContain("Error Type");
    expect(factNames).toContain("Severity");
    expect(factNames).toContain("Project");
    expect(factNames).toContain("Environment");
    expect(factNames).toContain("Time");
  });

  it("should include potential action when URL provided", () => {
    const data = createEventData({ url: "https://example.com/event/123" });
    const card = formatTeamsEventCard(data);

    expect(card.potentialAction).toBeDefined();
    expect(card.potentialAction?.[0].name).toBe("View in Buglens");
    expect(card.potentialAction?.[0].targets[0].uri).toBe(
      "https://example.com/event/123"
    );
  });
});

describe("formatTeamsRCACard", () => {
  it("should create properly formatted RCA card", () => {
    const data = createRCAData();
    const card = formatTeamsRCACard(data);

    expect(card["@type"]).toBe("MessageCard");
    expect(card.summary).toContain("RCA Complete");
    expect(card.title).toContain("Root Cause Analysis Complete");
  });

  it("should include root cause in facts", () => {
    const data = createRCAData({ rootCause: "Memory leak in event handler" });
    const card = formatTeamsRCACard(data);

    const rootCauseFact = card.sections[0].facts?.find(
      (f) => f.name === "Root Cause"
    );
    expect(rootCauseFact?.value).toBe("Memory leak in event handler");
  });

  it("should include confidence percentage", () => {
    const data = createRCAData({ confidence: 0.72 });
    const card = formatTeamsRCACard(data);

    const confidenceFact = card.sections[0].facts?.find(
      (f) => f.name === "Confidence"
    );
    expect(confidenceFact?.value).toBe("72%");
  });

  it("should conditionally include suggested fix", () => {
    const withFix = formatTeamsRCACard(
      createRCAData({ suggestedFix: "Add null check" })
    );
    const withoutFix = formatTeamsRCACard(
      createRCAData({ suggestedFix: undefined })
    );

    const hasFix = withFix.sections[0].facts?.some(
      (f) => f.name === "Suggested Fix"
    );
    const noFix = withoutFix.sections[0].facts?.some(
      (f) => f.name === "Suggested Fix"
    );

    expect(hasFix).toBe(true);
    expect(noFix).toBe(false);
  });

  it("should include file location with line number", () => {
    const data = createRCAData({
      affectedFile: "src/api/routes.ts",
      affectedLine: 89,
    });
    const card = formatTeamsRCACard(data);

    const locationFact = card.sections[0].facts?.find(
      (f) => f.name === "Location"
    );
    expect(locationFact?.value).toBe("src/api/routes.ts:89");
  });
});

// =============================================================================
// NOTIFICATION SERVICE CLASS TESTS
// =============================================================================

describe("NotificationService", () => {
  let service: NotificationService;
  const mockGetSlackWorkspace = getSlackWorkspace as ReturnType<typeof vi.fn>;
  const mockGetTeamsIntegration = getIntegrationTokensByType as ReturnType<
    typeof vi.fn
  >;
  const mockQuery = query as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();

    service = new NotificationService({
      baseUrl: "https://test.buglens.com",
      defaultChannel: "#test-alerts",
    });

    // Default: allow all notifications
    mockQuery.mockResolvedValue({
      rows: [{ settings: { notification_level: "all" } }],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ===========================================================================
  // SLACK NOTIFICATION TESTS
  // ===========================================================================

  describe("sendSlackEventNotification", () => {
    it("should send notification when Slack is connected", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createEventData();
      const result = await service.sendSlackEventNotification("org-123", data);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://slack.com/api/chat.postMessage",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer xoxb-mock-token",
          }),
        })
      );
    });

    it("should return error when Slack is not connected", async () => {
      mockGetSlackWorkspace.mockResolvedValue(null);

      const data = createEventData();
      const result = await service.sendSlackEventNotification("org-123", data);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Slack workspace not connected");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should handle Slack API errors", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: false, error: "channel_not_found" }),
      });

      const data = createEventData();
      const result = await service.sendSlackEventNotification("org-123", data);

      expect(result.success).toBe(false);
      expect(result.error).toBe("channel_not_found");
    });

    it("should use incoming webhook channel when available", async () => {
      mockGetSlackWorkspace.mockResolvedValue({
        workspace: {
          accessToken: "xoxb-token",
          incomingWebhook: { channelId: "#production-alerts" },
        },
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createEventData();
      await service.sendSlackEventNotification("org-123", data);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.channel).toBe("#production-alerts");
    });

    it("should fall back to default channel when no webhook channel", async () => {
      mockGetSlackWorkspace.mockResolvedValue({
        workspace: {
          accessToken: "xoxb-token",
          incomingWebhook: {},
        },
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createEventData();
      await service.sendSlackEventNotification("org-123", data);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.channel).toBe("#test-alerts");
    });

    it("should add default URL when not provided", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createEventData({ url: undefined });
      await service.sendSlackEventNotification("org-123", data);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      const actionsBlock = body.blocks.find((b: any) => b.type === "actions");
      expect(actionsBlock.elements[0].url).toBe(
        "https://test.buglens.com/events/event-123"
      );
    });

    it("should handle network errors gracefully", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockFetch.mockRejectedValue(new Error("Network error"));

      const data = createEventData();
      const result = await service.sendSlackEventNotification("org-123", data);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network error");
    });
  });

  describe("sendSlackRCANotification", () => {
    it("should send RCA notification successfully", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createRCAData();
      const result = await service.sendSlackRCANotification("org-123", data);

      expect(result.success).toBe(true);
    });

    it("should generate correct RCA URL", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createRCAData({ url: undefined, rcaId: "rca-789" });
      await service.sendSlackRCANotification("org-123", data);

      const fetchCall = mockFetch.mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      const actionsBlock = body.blocks.find((b: any) => b.type === "actions");
      expect(actionsBlock.elements[0].url).toBe(
        "https://test.buglens.com/rca/rca-789"
      );
    });
  });

  // ===========================================================================
  // NOTIFICATION PREFERENCES TESTS
  // ===========================================================================

  describe("notification preferences", () => {
    it("should skip notification when level is 'none'", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockQuery.mockResolvedValue({
        rows: [{ settings: { notification_level: "none" } }],
      });

      const data = createEventData();
      const result = await service.sendSlackEventNotification("org-123", data);

      expect(result.success).toBe(true); // Success but skipped
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should allow critical errors when level is 'critical'", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockQuery.mockResolvedValue({
        rows: [{ settings: { notification_level: "critical" } }],
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const criticalData = createEventData({ severity: "error" });
      const warningData = createEventData({ severity: "warning" });

      const criticalResult = await service.sendSlackEventNotification(
        "org-123",
        criticalData
      );
      const warningResult = await service.sendSlackEventNotification(
        "org-123",
        warningData
      );

      expect(criticalResult.success).toBe(true);
      expect(warningResult.success).toBe(true); // Skipped, not error
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only critical
    });

    it("should allow high and critical when level is 'high'", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockQuery.mockResolvedValue({
        rows: [{ settings: { notification_level: "high" } }],
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      await service.sendSlackRCANotification(
        "org-123",
        createRCAData({ severity: "critical" })
      );
      await service.sendSlackRCANotification(
        "org-123",
        createRCAData({ severity: "high" })
      );
      await service.sendSlackRCANotification(
        "org-123",
        createRCAData({ severity: "low" })
      );

      expect(mockFetch).toHaveBeenCalledTimes(2); // critical + high
    });

    it("should default to 'all' when settings missing", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockQuery.mockResolvedValue({ rows: [{ settings: {} }] });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createEventData({ severity: "info" });
      const result = await service.sendSlackEventNotification("org-123", data);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should default to sending when org not found", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockQuery.mockResolvedValue({ rows: [] });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createEventData();
      const result = await service.sendSlackEventNotification("org-123", data);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });

    it("should default to sending when preference check fails", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockQuery.mockRejectedValue(new Error("DB error"));
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createEventData();
      const result = await service.sendSlackEventNotification("org-123", data);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // TEAMS NOTIFICATION TESTS
  // ===========================================================================

  describe("sendTeamsEventNotification", () => {
    it("should send notification when Teams is connected", async () => {
      mockGetTeamsIntegration.mockResolvedValue(mockTeamsIntegration);
      mockFetch.mockResolvedValue({ ok: true });

      const data = createEventData();
      const result = await service.sendTeamsEventNotification("org-123", data);

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "https://graph.microsoft.com/v1.0/me/teamwork/sendActivityNotification",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer teams-mock-token",
          }),
        })
      );
    });

    it("should return error when Teams is not connected", async () => {
      mockGetTeamsIntegration.mockResolvedValue(null);

      const data = createEventData();
      const result = await service.sendTeamsEventNotification("org-123", data);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Teams not connected");
    });

    it("should handle Teams API errors", async () => {
      mockGetTeamsIntegration.mockResolvedValue(mockTeamsIntegration);
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve("Access denied"),
      });

      const data = createEventData();
      const result = await service.sendTeamsEventNotification("org-123", data);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Access denied");
    });
  });

  describe("sendTeamsRCANotification", () => {
    it("should send RCA notification successfully", async () => {
      mockGetTeamsIntegration.mockResolvedValue(mockTeamsIntegration);
      mockFetch.mockResolvedValue({ ok: true });

      const data = createRCAData();
      const result = await service.sendTeamsRCANotification("org-123", data);

      expect(result.success).toBe(true);
    });
  });

  // ===========================================================================
  // BATCH NOTIFICATION TESTS
  // ===========================================================================

  describe("sendEventNotification (batch)", () => {
    it("should send to both Slack and Teams", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockGetTeamsIntegration.mockResolvedValue(mockTeamsIntegration);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        .mockResolvedValueOnce({ ok: true });

      const data = createEventData();
      const result = await service.sendEventNotification("org-123", data);

      expect(result.slack?.success).toBe(true);
      expect(result.teams?.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should handle partial failures", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockGetTeamsIntegration.mockResolvedValue(null);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      });

      const data = createEventData();
      const result = await service.sendEventNotification("org-123", data);

      expect(result.slack?.success).toBe(true);
      expect(result.teams?.success).toBe(false);
      expect(result.teams?.error).toBe("Teams not connected");
    });
  });

  describe("sendRCANotification (batch)", () => {
    it("should send to both channels", async () => {
      mockGetSlackWorkspace.mockResolvedValue(mockSlackWorkspace);
      mockGetTeamsIntegration.mockResolvedValue(mockTeamsIntegration);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ ok: true }),
        })
        .mockResolvedValueOnce({ ok: true });

      const data = createRCAData();
      const result = await service.sendRCANotification("org-123", data);

      expect(result.slack?.success).toBe(true);
      expect(result.teams?.success).toBe(true);
    });
  });

  // ===========================================================================
  // CONFIGURATION TESTS
  // ===========================================================================

  describe("configuration", () => {
    it("should use provided baseUrl", () => {
      const customService = new NotificationService({
        baseUrl: "https://custom.example.com",
      });

      expect(customService).toBeInstanceOf(NotificationService);
    });

    it("should use default config when not provided", () => {
      const defaultService = new NotificationService();

      expect(defaultService).toBeInstanceOf(NotificationService);
    });
  });
});

// =============================================================================
// EDGE CASE TESTS
// =============================================================================

describe("Edge Cases", () => {
  it("should handle very long root cause text in Slack", () => {
    const longRootCause = "A".repeat(500);
    const data = createRCAData({ rootCause: longRootCause });
    const message = formatSlackRCAMessage(data);

    // Should truncate in text field but show full in blocks
    expect(message.text.length).toBeLessThan(600);
    expect(message.text).toContain("...");
  });

  it("should handle special Unicode characters in event title", () => {
    const data = createEventData({
      eventTitle: "Error: 💥 Connection failed with émoji",
    });
    const message = formatSlackEventMessage(data);

    expect(message.blocks.length).toBeGreaterThan(0);
  });

  it("should handle zero confidence", () => {
    const data = createRCAData({ confidence: 0 });
    const message = formatSlackRCAMessage(data);

    const metadataBlock = message.blocks.find((b) => b.fields);
    const confidenceField = metadataBlock?.fields?.find((f) =>
      f.text.includes("Confidence")
    );
    expect(confidenceField?.text).toContain("0%");
  });

  it("should handle file path without line number", () => {
    const data = createRCAData({
      affectedFile: "src/index.ts",
      affectedLine: undefined,
    });
    const message = formatSlackRCAMessage(data);

    const locationBlock = message.blocks.find(
      (b) => b.type === "section" && b.text?.text?.includes("Location")
    );
    expect(locationBlock?.text?.text).toContain("src/index.ts");
    // The backtick wrapping adds a colon in the markdown, but there's no line number
    expect(locationBlock?.text?.text).not.toMatch(/:\d+/); // No colon followed by digits
  });
});
