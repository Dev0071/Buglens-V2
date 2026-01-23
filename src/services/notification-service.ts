/**
 * Notification Service
 *
 * Sends notifications about events and RCA findings to Slack and Microsoft Teams.
 *
 * Architecture:
 * - Pure functions for message formatting (functional pattern)
 * - Service class for I/O operations (OOP pattern)
 *
 * Notification triggers:
 * 1. New Sentry event received
 * 2. RCA analysis completed
 * 3. High severity error detected
 */

import { logger } from "../utils/logger.js";
import {
  getSlackWorkspace,
  getIntegrationTokensByType,
} from "./integration-tokens.js";
import { getAppBaseUrl } from "../utils/url-helpers.js";
import { query } from "../db/client.js";

// ============================================
// Types
// ============================================

export interface EventNotificationData {
  eventId: string;
  eventTitle: string;
  eventMessage: string;
  severity: "error" | "warning" | "info";
  errorType?: string;
  timestamp: string;
  projectName?: string;
  environment?: string;
  url?: string;
}

export interface RCANotificationData {
  rcaId: string;
  eventId: string;
  eventTitle: string;
  rootCause: string;
  confidence: number;
  severity: "critical" | "high" | "medium" | "low";
  suggestedFix?: string;
  affectedFile?: string;
  affectedLine?: number;
  timestamp: string;
  analysisTimeMs?: number;
  url?: string;
}

interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
    emoji?: boolean;
  };
  elements?: Array<{
    type: string;
    text?: string | { type: string; text: string };
    url?: string;
    action_id?: string;
    value?: string;
  }>;
  fields?: Array<{
    type: string;
    text: string;
  }>;
}

interface SlackMessage {
  channel?: string;
  text: string;
  blocks: SlackBlock[];
}

interface TeamsCard {
  "@type": string;
  "@context": string;
  summary: string;
  themeColor: string;
  title: string;
  sections: Array<{
    activityTitle?: string;
    activitySubtitle?: string;
    facts?: Array<{ name: string; value: string }>;
    text?: string;
  }>;
  potentialAction?: Array<{
    "@type": string;
    name: string;
    targets: Array<{ os: string; uri: string }>;
  }>;
}

// ============================================
// Slack Message Formatters (Pure Functions)
// ============================================

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high: "🟠",
  medium: "🟡",
  low: "🟢",
  error: "🔴",
  warning: "🟡",
  info: "🔵",
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#ca8a04",
  low: "#16a34a",
  error: "#dc2626",
  warning: "#ca8a04",
  info: "#2563eb",
};

/**
 * Format event notification for Slack
 * @pure
 */
export function formatSlackEventMessage(
  data: EventNotificationData
): SlackMessage {
  const emoji = SEVERITY_EMOJI[data.severity] || "⚠️";

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} New Error Detected`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${escapeSlackText(data.eventTitle)}*\n${escapeSlackText(data.eventMessage)}`,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*Error Type:*\n${escapeSlackText(data.errorType || "Unknown")}`,
        },
        {
          type: "mrkdwn",
          text: `*Severity:*\n${capitalize(data.severity)}`,
        },
        {
          type: "mrkdwn",
          text: `*Project:*\n${escapeSlackText(data.projectName || "N/A")}`,
        },
        {
          type: "mrkdwn",
          text: `*Environment:*\n${escapeSlackText(data.environment || "N/A")}`,
        },
      ],
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `📅 ${new Date(data.timestamp).toLocaleString()}`,
        },
      ],
    },
  ];

  // Add action button if URL is provided
  if (data.url) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View in Buglens",
          },
          url: data.url,
          action_id: "view_event",
        },
      ],
    });
  }

  return {
    text: `${emoji} New ${data.severity} error: ${data.eventTitle}`,
    blocks,
  };
}

/**
 * Format RCA notification for Slack
 * @pure
 */
export function formatSlackRCAMessage(data: RCANotificationData): SlackMessage {
  const emoji = SEVERITY_EMOJI[data.severity] || "🔍";
  const confidencePercent = Math.round(data.confidence * 100);

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: `${emoji} Root Cause Analysis Complete`,
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Event:* ${escapeSlackText(data.eventTitle)}`,
      },
    },
    {
      type: "divider",
    } as SlackBlock,
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*🔍 Root Cause:*\n${escapeSlackText(data.rootCause)}`,
      },
    },
  ];

  // Add suggested fix if available
  if (data.suggestedFix) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*💡 Suggested Fix:*\n${escapeSlackText(data.suggestedFix)}`,
      },
    });
  }

  // Add file location if available
  if (data.affectedFile) {
    const location = data.affectedLine
      ? `${data.affectedFile}:${data.affectedLine}`
      : data.affectedFile;
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📁 Location:*\n\`${escapeSlackText(location)}\``,
      },
    });
  }

  // Add metadata section
  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*Confidence:*\n${confidencePercent}%`,
      },
      {
        type: "mrkdwn",
        text: `*Severity:*\n${capitalize(data.severity)}`,
      },
    ],
  });

  // Add context with timing
  const contextElements: Array<{ type: string; text: string }> = [
    {
      type: "mrkdwn",
      text: `📅 ${new Date(data.timestamp).toLocaleString()}`,
    },
  ];

  if (data.analysisTimeMs) {
    contextElements.push({
      type: "mrkdwn",
      text: `⏱️ Analysis: ${data.analysisTimeMs}ms`,
    });
  }

  blocks.push({
    type: "context",
    elements: contextElements,
  });

  // Add action button if URL is provided
  if (data.url) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Full Analysis",
          },
          url: data.url,
          action_id: "view_rca",
        },
      ],
    });
  }

  return {
    text: `${emoji} RCA Complete for "${data.eventTitle}" - Root Cause: ${data.rootCause.substring(0, 100)}...`,
    blocks,
  };
}

// ============================================
// Teams Message Formatters (Pure Functions)
// ============================================

/**
 * Format event notification for Microsoft Teams
 * @pure
 */
export function formatTeamsEventCard(data: EventNotificationData): TeamsCard {
  const themeColor = SEVERITY_COLORS[data.severity] || "#6b7280";

  const card: TeamsCard = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    summary: `New ${data.severity} error: ${data.eventTitle}`,
    themeColor,
    title: `${SEVERITY_EMOJI[data.severity]} New Error Detected`,
    sections: [
      {
        activityTitle: data.eventTitle,
        activitySubtitle: data.eventMessage,
        facts: [
          { name: "Error Type", value: data.errorType || "Unknown" },
          { name: "Severity", value: capitalize(data.severity) },
          { name: "Project", value: data.projectName || "N/A" },
          { name: "Environment", value: data.environment || "N/A" },
          { name: "Time", value: new Date(data.timestamp).toLocaleString() },
        ],
      },
    ],
  };

  if (data.url) {
    card.potentialAction = [
      {
        "@type": "OpenUri",
        name: "View in Buglens",
        targets: [{ os: "default", uri: data.url }],
      },
    ];
  }

  return card;
}

/**
 * Format RCA notification for Microsoft Teams
 * @pure
 */
export function formatTeamsRCACard(data: RCANotificationData): TeamsCard {
  const themeColor = SEVERITY_COLORS[data.severity] || "#6b7280";
  const confidencePercent = Math.round(data.confidence * 100);

  const facts: Array<{ name: string; value: string }> = [
    { name: "Root Cause", value: data.rootCause },
    { name: "Confidence", value: `${confidencePercent}%` },
    { name: "Severity", value: capitalize(data.severity) },
  ];

  if (data.suggestedFix) {
    facts.push({ name: "Suggested Fix", value: data.suggestedFix });
  }

  if (data.affectedFile) {
    const location = data.affectedLine
      ? `${data.affectedFile}:${data.affectedLine}`
      : data.affectedFile;
    facts.push({ name: "Location", value: location });
  }

  if (data.analysisTimeMs) {
    facts.push({ name: "Analysis Time", value: `${data.analysisTimeMs}ms` });
  }

  facts.push({
    name: "Time",
    value: new Date(data.timestamp).toLocaleString(),
  });

  const card: TeamsCard = {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    summary: `RCA Complete: ${data.eventTitle}`,
    themeColor,
    title: `${SEVERITY_EMOJI[data.severity]} Root Cause Analysis Complete`,
    sections: [
      {
        activityTitle: data.eventTitle,
        facts,
      },
    ],
  };

  if (data.url) {
    card.potentialAction = [
      {
        "@type": "OpenUri",
        name: "View Full Analysis",
        targets: [{ os: "default", uri: data.url }],
      },
    ];
  }

  return card;
}

// ============================================
// Helper Functions (Pure)
// ============================================

/**
 * Escape special Slack characters
 * @pure
 */
function escapeSlackText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Capitalize first letter
 * @pure
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================
// Notification Service Class (OOP)
// ============================================

export interface NotificationServiceConfig {
  baseUrl?: string;
  defaultChannel?: string;
}

const DEFAULT_CONFIG: NotificationServiceConfig = {
  baseUrl: getAppBaseUrl(),
};

/**
 * NotificationService - Handles sending notifications to Slack and Teams
 *
 * Uses OOP pattern because:
 * - Manages external I/O (HTTP requests)
 * - Needs configuration injection
 * - Interacts with integrations database
 */
export class NotificationService {
  private readonly config: NotificationServiceConfig;

  constructor(config: Partial<NotificationServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================
  // Slack Notifications
  // ==========================================

  /**
   * Send event notification to Slack
   */
  async sendSlackEventNotification(
    orgId: string,
    data: EventNotificationData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const workspace = await getSlackWorkspace(orgId);
      if (!workspace) {
        return { success: false, error: "Slack workspace not connected" };
      }

      // Check notification preferences
      const shouldNotify = await this.shouldSendNotification(
        orgId,
        data.severity
      );
      if (!shouldNotify) {
        logger.debug(
          { orgId, severity: data.severity },
          "Notification skipped due to preferences"
        );
        return { success: true }; // Not an error, just skipped
      }

      // Add URL to notification data
      const dataWithUrl = {
        ...data,
        url: data.url || `${this.config.baseUrl}/events/${data.eventId}`,
      };

      const message = formatSlackEventMessage(dataWithUrl);
      return await this.sendSlackMessage(
        workspace.workspace.accessToken,
        workspace.workspace.incomingWebhook?.channelId ||
          this.config.defaultChannel ||
          "#general",
        message
      );
    } catch (error) {
      logger.error({ error, orgId }, "Failed to send Slack event notification");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send RCA notification to Slack
   */
  async sendSlackRCANotification(
    orgId: string,
    data: RCANotificationData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const workspace = await getSlackWorkspace(orgId);
      if (!workspace) {
        return { success: false, error: "Slack workspace not connected" };
      }

      // Check notification preferences
      const shouldNotify = await this.shouldSendNotification(
        orgId,
        data.severity
      );
      if (!shouldNotify) {
        logger.debug(
          { orgId, severity: data.severity },
          "RCA notification skipped due to preferences"
        );
        return { success: true };
      }

      // Add URL to notification data
      const dataWithUrl = {
        ...data,
        url: data.url || `${this.config.baseUrl}/rca/${data.rcaId}`,
      };

      const message = formatSlackRCAMessage(dataWithUrl);
      return await this.sendSlackMessage(
        workspace.workspace.accessToken,
        workspace.workspace.incomingWebhook?.channelId ||
          this.config.defaultChannel ||
          "#general",
        message
      );
    } catch (error) {
      logger.error({ error, orgId }, "Failed to send Slack RCA notification");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send a Slack message via API
   */
  private async sendSlackMessage(
    accessToken: string,
    channel: string,
    message: SlackMessage
  ): Promise<{ success: boolean; error?: string }> {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel,
        text: message.text,
        blocks: message.blocks,
      }),
    });

    const result = (await response.json()) as {
      ok: boolean;
      error?: string;
    };

    if (!result.ok) {
      logger.warn({ error: result.error }, "Slack API error");
      return { success: false, error: result.error };
    }

    logger.info({ channel }, "Slack notification sent");
    return { success: true };
  }

  // ==========================================
  // Microsoft Teams Notifications
  // ==========================================

  /**
   * Send event notification to Microsoft Teams
   */
  async sendTeamsEventNotification(
    orgId: string,
    data: EventNotificationData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const teamsIntegration = await getIntegrationTokensByType(orgId, "teams");
      if (!teamsIntegration) {
        return { success: false, error: "Teams not connected" };
      }

      // Check notification preferences
      const shouldNotify = await this.shouldSendNotification(
        orgId,
        data.severity
      );
      if (!shouldNotify) {
        return { success: true };
      }

      // Add URL to notification data
      const dataWithUrl = {
        ...data,
        url: data.url || `${this.config.baseUrl}/events/${data.eventId}`,
      };

      const card = formatTeamsEventCard(dataWithUrl);
      return await this.sendTeamsCard(
        teamsIntegration.tokens.accessToken,
        card
      );
    } catch (error) {
      logger.error({ error, orgId }, "Failed to send Teams event notification");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send RCA notification to Microsoft Teams
   */
  async sendTeamsRCANotification(
    orgId: string,
    data: RCANotificationData
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const teamsIntegration = await getIntegrationTokensByType(orgId, "teams");
      if (!teamsIntegration) {
        return { success: false, error: "Teams not connected" };
      }

      // Check notification preferences
      const shouldNotify = await this.shouldSendNotification(
        orgId,
        data.severity
      );
      if (!shouldNotify) {
        return { success: true };
      }

      // Add URL to notification data
      const dataWithUrl = {
        ...data,
        url: data.url || `${this.config.baseUrl}/rca/${data.rcaId}`,
      };

      const card = formatTeamsRCACard(dataWithUrl);
      return await this.sendTeamsCard(
        teamsIntegration.tokens.accessToken,
        card
      );
    } catch (error) {
      logger.error({ error, orgId }, "Failed to send Teams RCA notification");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send a Teams card via webhook
   * Note: For incoming webhooks, we POST directly to the webhook URL
   * For bot-based integrations, we'd use the Graph API
   */
  private async sendTeamsCard(
    accessToken: string,
    card: TeamsCard
  ): Promise<{ success: boolean; error?: string }> {
    // Teams typically uses webhook URLs stored in integration config
    // For this implementation, we'll use the activity feed API
    // In production, you'd want to store the webhook URL in integration metadata
    try {
      const response = await fetch(
        "https://graph.microsoft.com/v1.0/me/teamwork/sendActivityNotification",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            topic: {
              source: "text",
              value: "Buglens Alert",
            },
            activityType: "systemDefault",
            previewText: {
              content: card.summary,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        logger.warn({ error, status: response.status }, "Teams API error");
        return { success: false, error };
      }

      logger.info("Teams notification sent");
      return { success: true };
    } catch (error) {
      logger.error({ error }, "Teams notification failed");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  // ==========================================
  // Notification Preferences
  // ==========================================

  /**
   * Check if notification should be sent based on org preferences
   */
  private async shouldSendNotification(
    orgId: string,
    severity: string
  ): Promise<boolean> {
    try {
      const result = await query<{ settings: Record<string, unknown> }>(
        `SELECT settings FROM organizations WHERE id = $1`,
        [orgId]
      );

      if (result.rows.length === 0) {
        return true; // Default to sending
      }

      const settings = result.rows[0].settings || {};
      const notificationLevel =
        (settings.notification_level as string) || "all";

      switch (notificationLevel) {
        case "none":
          return false;
        case "critical":
          return severity === "critical" || severity === "error";
        case "high":
          return (
            severity === "critical" ||
            severity === "high" ||
            severity === "error"
          );
        case "all":
        default:
          return true;
      }
    } catch (error) {
      logger.warn({ error, orgId }, "Failed to check notification preferences");
      return true; // Default to sending on error
    }
  }

  // ==========================================
  // Batch Notifications
  // ==========================================

  /**
   * Send notifications to all configured channels (Slack + Teams)
   */
  async sendEventNotification(
    orgId: string,
    data: EventNotificationData
  ): Promise<{
    slack?: { success: boolean; error?: string };
    teams?: { success: boolean; error?: string };
  }> {
    const results: {
      slack?: { success: boolean; error?: string };
      teams?: { success: boolean; error?: string };
    } = {};

    // Send to Slack
    results.slack = await this.sendSlackEventNotification(orgId, data);

    // Send to Teams
    results.teams = await this.sendTeamsEventNotification(orgId, data);

    return results;
  }

  /**
   * Send RCA notifications to all configured channels
   */
  async sendRCANotification(
    orgId: string,
    data: RCANotificationData
  ): Promise<{
    slack?: { success: boolean; error?: string };
    teams?: { success: boolean; error?: string };
  }> {
    const results: {
      slack?: { success: boolean; error?: string };
      teams?: { success: boolean; error?: string };
    } = {};

    // Send to Slack
    results.slack = await this.sendSlackRCANotification(orgId, data);

    // Send to Teams
    results.teams = await this.sendTeamsRCANotification(orgId, data);

    return results;
  }
}

// ============================================
// Singleton Export
// ============================================

export const notificationService = new NotificationService();
