/**
 * API response types for Buglens frontend
 */

// Dashboard stats - decision-driven metrics
export interface DashboardStats {
  // Core metrics (displayed prominently)
  criticalUnresolved: number; // PANIC if > 0
  highUnresolved: number; // WARNING if > 3
  rcaAccuracy: number; // % based on feedback (7d)
  avgResolutionTime: number; // seconds to generate RCA

  // Trends
  eventsChange: number; // % change from previous period (spike detection)
  unresolvedTrend: number; // % change in unresolved count
  resolutionTimeChange: number; // % change in resolution time

  // Supporting metrics (for context)
  totalEvents: number;
  resolvedRCAs: number;
  resolvedChange: number;
  pendingAnalysis: number;
}

// Recent event for dashboard widget
export interface RecentEvent {
  id: string;
  message: string;
  severity: "low" | "medium" | "high" | "critical";
  status: "pending" | "processing" | "completed" | "failed";
  createdAt: string;
  rcaId?: string;
  confidence?: number; // RCA confidence score 0-1
}

// Full event object from events list
export interface Event {
  id: string;
  sentry_event_id: string;
  message: string;
  platform: string;
  severity: "low" | "medium" | "high" | "critical";
  environment: string;
  status: "pending" | "processing" | "completed" | "failed";
  created_at: string;
  rca_result_id?: string;
}

// Paginated events response
export interface EventsResponse {
  events: Event[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Events query params
export interface EventsQueryParams {
  page?: number;
  pageSize?: number;
  severity?: string;
  status?: string;
  search?: string;
}

// Event detail (includes raw payload)
export interface EventDetail extends Event {
  sentry_issue_id?: string;
  raw_payload?: Record<string, unknown>;
  updated_at: string;
  rca_job?: {
    id: string;
    status: string;
    rca_result_id?: string;
  };
}

// Stack trace frame
export interface StackFrame {
  file: string;
  line: number;
  function: string;
  column?: number;
}

// Deterministic finding from analyzers
export interface DeterministicFinding {
  rule_id: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  evidence_refs: string[];
}

// Code file context
export interface CodeFile {
  path: string;
  content: string;
  highlighted_lines?: number[];
}

// RCA evidence bundle
export interface RCAEvidence {
  error_info: {
    message: string;
    type: string;
    stack_trace: StackFrame[];
  };
  code_context: {
    files: CodeFile[];
  };
  deterministic_findings: DeterministicFinding[];
  timeline?: {
    events: Array<{
      timestamp: string;
      type: string;
      message: string;
    }>;
  };
}

// Full RCA result
export interface RCAResult {
  id: string;
  event_id: string;
  title: string;
  summary: string;
  root_cause: string;
  fix_suggestion: string;
  confidence: number;
  evidence: RCAEvidence;
  llm_tokens_used: number;
  deterministic_only: boolean;
  created_at: string;
  updated_at?: string;
}

// Integration types
export type IntegrationType = "sentry" | "github" | "slack";
export type IntegrationStatus = "connected" | "disconnected" | "error";

export interface Integration {
  id: string;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  configuredAt?: string;
  metadata?: Record<string, unknown>;
  error?: string;
}

// Cost metrics
export interface CostMetrics {
  date: string;
  llm_tokens_used: number;
  llm_cost_usd: number;
  github_requests: number;
  events_processed: number;
}

export interface CostSummary {
  currentMonth: {
    totalCost: number;
    llmCost: number;
    tokenCount: number;
    eventsProcessed: number;
  };
  previousMonth: {
    totalCost: number;
    llmCost: number;
  };
  dailyMetrics: CostMetrics[];
  projectedMonthlyCost: number;
}

// Settings
export interface OrganizationSettings {
  id: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  limits: {
    eventsPerDay: number;
    llmTokensPerDay: number;
    usersAllowed: number;
  };
  notifications: {
    slack: {
      enabled: boolean;
      channel?: string;
      notifyOnComplete: boolean;
      notifyOnError: boolean;
    };
    email: {
      enabled: boolean;
      addresses: string[];
    };
  };
}

// User feedback on RCA
export interface RCAFeedback {
  rcaId: string;
  rating: 1 | 2 | 3 | 4 | 5;
  wasHelpful: boolean;
  comment?: string;
}

// API error response
export interface APIError {
  error: string;
  message: string;
  statusCode: number;
  details?: Record<string, unknown>;
}
