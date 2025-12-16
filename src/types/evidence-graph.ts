/**
 * Evidence Graph types for RCA visualization
 *
 * The evidence graph is a visual representation of how RCA conclusions
 * were reached. It shows:
 * - Error node (root)
 * - Code location nodes
 * - Commit nodes
 * - Pattern/finding nodes
 * - Timeline event nodes
 *
 * Edges show relationships:
 * - caused_by: Direct causation
 * - introduced_in: When the bug was introduced
 * - triggered_when: What triggered the error
 * - similar_to: Pattern matches
 * - authored_by: Who made changes
 *
 * @module types/evidence-graph
 */

import { z } from "zod";

// =============================================================================
// NODE TYPES
// =============================================================================

/**
 * Types of nodes in the evidence graph
 */
export const evidenceNodeTypeSchema = z.enum([
  "error",
  "code_location",
  "commit",
  "developer",
  "pattern",
  "timeline_event",
]);

export type EvidenceNodeType = z.infer<typeof evidenceNodeTypeSchema>;

/**
 * A node in the evidence graph
 */
export const evidenceNodeSchema = z.object({
  id: z.string(),
  type: evidenceNodeTypeSchema,
  label: z.string(),
  data: z.record(z.unknown()),
  confidence: z.number().min(0).max(1),
});

export type EvidenceNode = z.infer<typeof evidenceNodeSchema>;

// =============================================================================
// EDGE TYPES
// =============================================================================

/**
 * Types of relationships between nodes
 */
export const evidenceEdgeTypeSchema = z.enum([
  "caused_by",
  "introduced_in",
  "triggered_when",
  "similar_to",
  "authored_by",
]);

export type EvidenceEdgeType = z.infer<typeof evidenceEdgeTypeSchema>;

/**
 * An edge connecting two nodes
 */
export const evidenceEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: evidenceEdgeTypeSchema,
  label: z.string(),
  evidence: z.string(), // Reference to actual data supporting this edge
});

export type EvidenceEdge = z.infer<typeof evidenceEdgeSchema>;

// =============================================================================
// GRAPH SCHEMA
// =============================================================================

/**
 * Metadata about the evidence graph
 */
export const evidenceGraphMetadataSchema = z.object({
  created_at: z.string(),
  confidence: z.number().min(0).max(1),
  /** Ratio of deterministic findings to total nodes */
  deterministic_score: z.number().min(0).max(1),
  /** Number of high-confidence edges (>0.8) */
  high_confidence_edges: z.number().int().min(0),
  /** Whether the graph passed validation */
  is_valid: z.boolean(),
});

export type EvidenceGraphMetadata = z.infer<typeof evidenceGraphMetadataSchema>;

/**
 * Complete evidence graph
 */
export const evidenceGraphSchema = z.object({
  nodes: z.array(evidenceNodeSchema),
  edges: z.array(evidenceEdgeSchema),
  metadata: evidenceGraphMetadataSchema,
});

export type EvidenceGraph = z.infer<typeof evidenceGraphSchema>;

// =============================================================================
// INPUT TYPES (for building graph)
// =============================================================================

/**
 * Event data for graph building
 */
export interface GraphBuildEvent {
  message: string;
  exception?: {
    type?: string;
    value?: string;
  };
  count?: number;
}

/**
 * Stack frame from extraction
 */
export interface GraphBuildFrame {
  file_path: string;
  line_number: number | null;
  column_number?: number | null;
  function_name?: string | null;
  context_line?: string | null;
  is_entry_point?: boolean;
}

/**
 * Commit for graph building
 */
export interface GraphBuildCommit {
  sha: string;
  short_sha?: string;
  message: string;
  author: {
    name: string;
    email: string;
    date: string;
    github_username?: string | null;
  };
  files_changed?: number;
  additions?: number;
  deletions?: number;
}

/**
 * Finding from deterministic analysis
 */
export interface GraphBuildFinding {
  rule_id: string;
  title?: string;
  type?: string;
  message: string;
  severity: string;
  confidence: number;
  location?: {
    file?: string;
    line?: number;
    column?: number;
  };
  suggested_fix?: string;
}

/**
 * Timeline step for graph building
 */
export interface GraphBuildTimelineStep {
  timestamp: string;
  type: string;
  message: string;
  level?: string;
  is_anomaly?: boolean;
}
