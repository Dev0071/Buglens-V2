/**
 * Jira Ticket Service
 *
 * Creates Jira tickets with event details and RCA findings.
 *
 * Architecture:
 * - Pure functions for ticket content formatting (functional pattern)
 * - Service class for Jira API interactions (OOP pattern)
 *
 * Ticket creation triggers:
 * 1. Manual trigger from UI
 * 2. Auto-create on high severity errors (if enabled)
 * 3. Auto-create when RCA confidence is high
 */

import { logger } from "../utils/logger.js";
import { getIntegrationTokensByType } from "./integration-tokens.js";
import { query } from "../db/client.js";
import { getAppBaseUrl } from "../utils/url-helpers.js";

// ============================================
// Types
// ============================================

export interface EventTicketData {
  eventId: string;
  eventTitle: string;
  eventMessage: string;
  severity:
    | "critical"
    | "high"
    | "medium"
    | "low"
    | "error"
    | "warning"
    | "info";
  errorType?: string;
  stackTrace?: string;
  timestamp: string;
  projectName?: string;
  environment?: string;
  occurrences?: number;
  affectedUsers?: number;
  url?: string;
}

export interface RCATicketData {
  rcaId: string;
  eventId: string;
  eventTitle: string;
  eventMessage: string;
  rootCause: string;
  confidence: number;
  severity: "critical" | "high" | "medium" | "low";
  suggestedFix?: string;
  affectedFile?: string;
  affectedLine?: number;
  relatedFiles?: string[];
  codeSnippet?: string;
  analysisDetails?: string;
  timestamp: string;
  url?: string;
}

export interface JiraTicketRequest {
  projectKey: string;
  issueType?: string;
  summary: string;
  description: string;
  priority?: "Highest" | "High" | "Medium" | "Low" | "Lowest";
  labels?: string[];
  components?: string[];
  customFields?: Record<string, unknown>;
}

export interface JiraTicketResponse {
  id: string;
  key: string;
  self: string;
}

export interface JiraProject {
  id: string;
  key: string;
  name: string;
}

export interface JiraIssueType {
  id: string;
  name: string;
  subtask: boolean;
}

// ============================================
// Severity Mapping (Pure)
// ============================================

const SEVERITY_TO_JIRA_PRIORITY: Record<string, string> = {
  critical: "Highest",
  high: "High",
  medium: "Medium",
  low: "Low",
  error: "High",
  warning: "Medium",
  info: "Low",
};

// ============================================
// Ticket Content Formatters (Pure Functions)
// ============================================

/**
 * Format event data into Jira ticket request
 * @pure
 */
export function formatEventTicket(
  data: EventTicketData,
  projectKey: string,
  issueType: string = "Bug"
): JiraTicketRequest {
  const summary = `[Buglens] ${data.errorType || "Error"}: ${truncate(data.eventTitle, 200)}`;

  const description = buildEventDescription(data);

  return {
    projectKey,
    issueType,
    summary,
    description,
    priority:
      (SEVERITY_TO_JIRA_PRIORITY[
        data.severity
      ] as JiraTicketRequest["priority"]) || "Medium",
    labels: ["buglens", "auto-created", data.severity],
    customFields: {
      // Custom field for Buglens event ID (if configured)
      buglensEventId: data.eventId,
    },
  };
}

/**
 * Build event description in Jira wiki format
 * @pure
 */
function buildEventDescription(data: EventTicketData): string {
  const sections: string[] = [];

  // Header with error info
  sections.push(`h2. Error Details`);
  sections.push(`*Error Type:* ${data.errorType || "Unknown"}`);
  sections.push(`*Severity:* ${capitalize(data.severity)}`);
  sections.push(`*Environment:* ${data.environment || "N/A"}`);
  sections.push(`*Project:* ${data.projectName || "N/A"}`);
  sections.push(`*First Seen:* ${new Date(data.timestamp).toISOString()}`);

  if (data.occurrences) {
    sections.push(`*Occurrences:* ${data.occurrences}`);
  }

  if (data.affectedUsers) {
    sections.push(`*Affected Users:* ${data.affectedUsers}`);
  }

  // Error message
  sections.push(``);
  sections.push(`h2. Error Message`);
  sections.push(`{quote}${escapeJiraText(data.eventMessage)}{quote}`);

  // Stack trace
  if (data.stackTrace) {
    sections.push(``);
    sections.push(`h2. Stack Trace`);
    sections.push(`{code:java}`);
    sections.push(truncate(data.stackTrace, 10000));
    sections.push(`{code}`);
  }

  // Link back to Buglens
  if (data.url) {
    sections.push(``);
    sections.push(`h2. Links`);
    sections.push(`[View in Buglens|${data.url}]`);
  }

  // Auto-created notice
  sections.push(``);
  sections.push(`----`);
  sections.push(
    `_This ticket was automatically created by [Buglens|https://buglens.com]_`
  );

  return sections.join("\n");
}

/**
 * Format RCA data into Jira ticket request
 * @pure
 */
export function formatRCATicket(
  data: RCATicketData,
  projectKey: string,
  issueType: string = "Bug"
): JiraTicketRequest {
  const summary = `[Buglens RCA] ${truncate(data.eventTitle, 180)}: ${truncate(data.rootCause, 50)}`;

  const description = buildRCADescription(data);

  return {
    projectKey,
    issueType,
    summary,
    description,
    priority:
      (SEVERITY_TO_JIRA_PRIORITY[
        data.severity
      ] as JiraTicketRequest["priority"]) || "Medium",
    labels: ["buglens", "rca", "auto-created", data.severity],
    customFields: {
      buglensRcaId: data.rcaId,
      buglensEventId: data.eventId,
    },
  };
}

/**
 * Build RCA description in Jira wiki format
 * @pure
 */
function buildRCADescription(data: RCATicketData): string {
  const sections: string[] = [];
  const confidencePercent = Math.round(data.confidence * 100);

  // Header
  sections.push(`h2. Root Cause Analysis`);
  sections.push(`*Confidence:* ${confidencePercent}%`);
  sections.push(`*Severity:* ${capitalize(data.severity)}`);
  sections.push(`*Analysis Time:* ${new Date(data.timestamp).toISOString()}`);

  // Error context
  sections.push(``);
  sections.push(`h2. Error Context`);
  sections.push(`*Event:* ${escapeJiraText(data.eventTitle)}`);
  sections.push(`{quote}${escapeJiraText(data.eventMessage)}{quote}`);

  // Root cause
  sections.push(``);
  sections.push(`h2. Root Cause`);
  sections.push(
    `{panel:title=Analysis Result|borderStyle=solid|borderColor=#cccccc}`
  );
  sections.push(escapeJiraText(data.rootCause));
  sections.push(`{panel}`);

  // Suggested fix
  if (data.suggestedFix) {
    sections.push(``);
    sections.push(`h2. Suggested Fix`);
    sections.push(
      `{panel:title=Recommendation|borderStyle=solid|borderColor=#36B37E|bgColor=#E3FCEF}`
    );
    sections.push(escapeJiraText(data.suggestedFix));
    sections.push(`{panel}`);
  }

  // Affected location
  if (data.affectedFile) {
    sections.push(``);
    sections.push(`h2. Affected Location`);
    const location = data.affectedLine
      ? `${data.affectedFile}:${data.affectedLine}`
      : data.affectedFile;
    sections.push(`*File:* {{${escapeJiraText(location)}}}`);

    if (data.codeSnippet) {
      sections.push(``);
      sections.push(`*Code Context:*`);
      sections.push(`{code:javascript}`);
      sections.push(truncate(data.codeSnippet, 2000));
      sections.push(`{code}`);
    }
  }

  // Related files
  if (data.relatedFiles && data.relatedFiles.length > 0) {
    sections.push(``);
    sections.push(`h2. Related Files`);
    data.relatedFiles.slice(0, 10).forEach((file) => {
      sections.push(`* {{${escapeJiraText(file)}}}`);
    });
  }

  // Additional details
  if (data.analysisDetails) {
    sections.push(``);
    sections.push(`h2. Analysis Details`);
    sections.push(escapeJiraText(data.analysisDetails));
  }

  // Links
  if (data.url) {
    sections.push(``);
    sections.push(`h2. Links`);
    sections.push(`[View Full Analysis in Buglens|${data.url}]`);
  }

  // Auto-created notice
  sections.push(``);
  sections.push(`----`);
  sections.push(
    `_This ticket was automatically created by [Buglens RCA|https://buglens.com]_`
  );

  return sections.join("\n");
}

// ============================================
// Helper Functions (Pure)
// ============================================

/**
 * Escape special Jira wiki characters
 * @pure
 */
function escapeJiraText(text: string): string {
  return text
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\|/g, "\\|")
    .replace(/\*/g, "\\*")
    .replace(/_/g, "\\_")
    .replace(/-/g, "\\-")
    .replace(/\+/g, "\\+")
    .replace(/\^/g, "\\^")
    .replace(/~/g, "\\~");
}

/**
 * Truncate string to max length
 * @pure
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + "...";
}

/**
 * Capitalize first letter
 * @pure
 */
function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ============================================
// Jira Ticket Service Class (OOP)
// ============================================

export interface JiraServiceConfig {
  baseUrl?: string;
  defaultProjectKey?: string;
  defaultIssueType?: string;
  autoCreateOnHighSeverity?: boolean;
  autoCreateConfidenceThreshold?: number;
}

const DEFAULT_CONFIG: JiraServiceConfig = {
  baseUrl: getAppBaseUrl(),
  defaultIssueType: "Bug",
  autoCreateOnHighSeverity: false,
  autoCreateConfidenceThreshold: 0.8,
};

/**
 * JiraTicketService - Handles creating Jira tickets
 *
 * Uses OOP pattern because:
 * - Manages external I/O (Jira API)
 * - Needs configuration injection
 * - Interacts with integrations database
 */
export class JiraTicketService {
  private readonly config: JiraServiceConfig;

  constructor(config: Partial<JiraServiceConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================
  // Jira API Methods
  // ==========================================

  /**
   * Create a Jira ticket from event data
   */
  async createEventTicket(
    orgId: string,
    data: EventTicketData,
    options: { projectKey?: string; issueType?: string } = {}
  ): Promise<{
    success: boolean;
    ticket?: JiraTicketResponse;
    error?: string;
  }> {
    try {
      const jiraIntegration = await getIntegrationTokensByType(orgId, "jira");
      if (!jiraIntegration) {
        return { success: false, error: "Jira not connected" };
      }

      // Get project configuration
      const projectKey =
        options.projectKey || (await this.getDefaultProjectKey(orgId));
      if (!projectKey) {
        return { success: false, error: "No Jira project configured" };
      }

      // Add URL to data
      const dataWithUrl = {
        ...data,
        url: data.url || `${this.config.baseUrl}/events/${data.eventId}`,
      };

      // Format ticket
      const ticketRequest = formatEventTicket(
        dataWithUrl,
        projectKey,
        options.issueType || this.config.defaultIssueType
      );

      // Create ticket
      const ticket = await this.createTicket(
        jiraIntegration.tokens.accessToken,
        ticketRequest,
        orgId
      );

      // Store link between event and ticket
      await this.storeTicketLink(orgId, "event", data.eventId, ticket.key);

      logger.info(
        { orgId, eventId: data.eventId, ticketKey: ticket.key },
        "Jira ticket created for event"
      );

      return { success: true, ticket };
    } catch (error) {
      logger.error({ error, orgId }, "Failed to create Jira event ticket");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Create a Jira ticket from RCA data
   */
  async createRCATicket(
    orgId: string,
    data: RCATicketData,
    options: { projectKey?: string; issueType?: string } = {}
  ): Promise<{
    success: boolean;
    ticket?: JiraTicketResponse;
    error?: string;
  }> {
    try {
      const jiraIntegration = await getIntegrationTokensByType(orgId, "jira");
      if (!jiraIntegration) {
        return { success: false, error: "Jira not connected" };
      }

      // Get project configuration
      const projectKey =
        options.projectKey || (await this.getDefaultProjectKey(orgId));
      if (!projectKey) {
        return { success: false, error: "No Jira project configured" };
      }

      // Add URL to data
      const dataWithUrl = {
        ...data,
        url: data.url || `${this.config.baseUrl}/rca/${data.rcaId}`,
      };

      // Format ticket
      const ticketRequest = formatRCATicket(
        dataWithUrl,
        projectKey,
        options.issueType || this.config.defaultIssueType
      );

      // Create ticket
      const ticket = await this.createTicket(
        jiraIntegration.tokens.accessToken,
        ticketRequest,
        orgId
      );

      // Store link between RCA and ticket
      await this.storeTicketLink(orgId, "rca", data.rcaId, ticket.key);

      logger.info(
        { orgId, rcaId: data.rcaId, ticketKey: ticket.key },
        "Jira ticket created for RCA"
      );

      return { success: true, ticket };
    } catch (error) {
      logger.error({ error, orgId }, "Failed to create Jira RCA ticket");
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Get available Jira projects for the organization
   */
  async getProjects(orgId: string): Promise<JiraProject[]> {
    try {
      const jiraIntegration = await getIntegrationTokensByType(orgId, "jira");
      if (!jiraIntegration) {
        return [];
      }

      // Get accessible resources (cloud IDs)
      const cloudId = await this.getJiraCloudId(
        jiraIntegration.tokens.accessToken
      );
      if (!cloudId) {
        return [];
      }

      const response = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project`,
        {
          headers: {
            Authorization: `Bearer ${jiraIntegration.tokens.accessToken}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get projects: ${response.status}`);
      }

      const projects = (await response.json()) as JiraProject[];
      return projects;
    } catch (error) {
      logger.error({ error, orgId }, "Failed to get Jira projects");
      return [];
    }
  }

  /**
   * Get available issue types for a project
   */
  async getIssueTypes(
    orgId: string,
    projectKey: string
  ): Promise<JiraIssueType[]> {
    try {
      const jiraIntegration = await getIntegrationTokensByType(orgId, "jira");
      if (!jiraIntegration) {
        return [];
      }

      const cloudId = await this.getJiraCloudId(
        jiraIntegration.tokens.accessToken
      );
      if (!cloudId) {
        return [];
      }

      const response = await fetch(
        `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/project/${projectKey}`,
        {
          headers: {
            Authorization: `Bearer ${jiraIntegration.tokens.accessToken}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get project: ${response.status}`);
      }

      const project = (await response.json()) as {
        issueTypes: JiraIssueType[];
      };
      return project.issueTypes || [];
    } catch (error) {
      logger.error(
        { error, orgId, projectKey },
        "Failed to get Jira issue types"
      );
      return [];
    }
  }

  // ==========================================
  // Private Helper Methods
  // ==========================================

  /**
   * Create a ticket via Jira API
   */
  private async createTicket(
    accessToken: string,
    request: JiraTicketRequest,
    _orgId: string
  ): Promise<JiraTicketResponse> {
    const cloudId = await this.getJiraCloudId(accessToken);
    if (!cloudId) {
      throw new Error("Could not get Jira Cloud ID");
    }

    const issueData = {
      fields: {
        project: {
          key: request.projectKey,
        },
        summary: request.summary,
        description: {
          type: "doc",
          version: 1,
          content: [
            {
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: request.description,
                },
              ],
            },
          ],
        },
        issuetype: {
          name: request.issueType || "Bug",
        },
        priority: request.priority
          ? {
              name: request.priority,
            }
          : undefined,
        labels: request.labels,
      },
    };

    const response = await fetch(
      `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/issue`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(issueData),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      logger.error({ status: response.status, error }, "Jira API error");
      throw new Error(`Failed to create ticket: ${response.status} - ${error}`);
    }

    const result = (await response.json()) as JiraTicketResponse;
    return result;
  }

  /**
   * Get Jira Cloud ID from accessible resources
   */
  private async getJiraCloudId(accessToken: string): Promise<string | null> {
    try {
      const response = await fetch(
        "https://api.atlassian.com/oauth/token/accessible-resources",
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
        }
      );

      if (!response.ok) {
        return null;
      }

      const resources = (await response.json()) as Array<{ id: string }>;
      return resources[0]?.id || null;
    } catch {
      return null;
    }
  }

  /**
   * Get default project key from org settings
   */
  private async getDefaultProjectKey(orgId: string): Promise<string | null> {
    try {
      // First check org settings
      const settingsResult = await query<{ settings: Record<string, unknown> }>(
        `SELECT settings FROM organizations WHERE id = $1`,
        [orgId]
      );

      if (settingsResult.rows.length > 0) {
        const settings = settingsResult.rows[0].settings || {};
        if (settings.jira_default_project) {
          return settings.jira_default_project as string;
        }
      }

      // Fall back to first project
      const projects = await this.getProjects(orgId);
      return projects[0]?.key || null;
    } catch {
      return null;
    }
  }

  /**
   * Store link between entity and Jira ticket
   */
  private async storeTicketLink(
    orgId: string,
    entityType: "event" | "rca",
    entityId: string,
    ticketKey: string
  ): Promise<void> {
    try {
      // Store in a simple way - could be a separate table in production
      if (entityType === "event") {
        await query(
          `UPDATE events SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2 AND org_id = $3`,
          [JSON.stringify({ jira_ticket: ticketKey }), entityId, orgId]
        );
      } else {
        await query(
          `UPDATE rca_results SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb WHERE id = $2 AND org_id = $3`,
          [JSON.stringify({ jira_ticket: ticketKey }), entityId, orgId]
        );
      }
    } catch (error) {
      logger.warn(
        { error, entityType, entityId },
        "Failed to store ticket link"
      );
    }
  }

  // ==========================================
  // Auto-Create Logic
  // ==========================================

  /**
   * Check if auto-create is enabled and severity warrants a ticket
   */
  async shouldAutoCreateTicket(
    orgId: string,
    severity: string,
    confidence?: number
  ): Promise<boolean> {
    if (!this.config.autoCreateOnHighSeverity) {
      return false;
    }

    // Check org-level settings
    const result = await query<{ settings: Record<string, unknown> }>(
      `SELECT settings FROM organizations WHERE id = $1`,
      [orgId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    const settings = result.rows[0].settings || {};
    const autoCreate = settings.jira_auto_create === true;

    if (!autoCreate) {
      return false;
    }

    // Check severity threshold
    const highSeverities = ["critical", "high", "error"];
    if (!highSeverities.includes(severity)) {
      return false;
    }

    // If confidence provided, check threshold
    if (
      confidence !== undefined &&
      confidence < (this.config.autoCreateConfidenceThreshold || 0.8)
    ) {
      return false;
    }

    return true;
  }
}

// ============================================
// Singleton Export
// ============================================

export const jiraTicketService = new JiraTicketService();
