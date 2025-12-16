/**
 * Evidence Graph Builder
 *
 * Pure functions for building evidence graphs from RCA data.
 *
 * The evidence graph visually represents the reasoning chain:
 * - Error node at the root
 * - Code locations where the error occurred
 * - Commits that might have introduced the bug
 * - Patterns identified by deterministic analysis
 * - Timeline events leading to the error
 *
 * @module services/evidence-graph-builder
 */

import type {
  EvidenceGraph,
  EvidenceNode,
  EvidenceEdge,
  EvidenceGraphMetadata,
  GraphBuildEvent,
  GraphBuildFrame,
  GraphBuildCommit,
  GraphBuildFinding,
  GraphBuildTimelineStep,
} from "../types/evidence-graph.js";

// =============================================================================
// GRAPH BUILDER (Pure Function)
// =============================================================================

/**
 * Build evidence graph from RCA data
 *
 * @pure - output depends only on input
 */
export function buildEvidenceGraph(params: {
  event: GraphBuildEvent;
  userFrames: GraphBuildFrame[];
  recentCommits: GraphBuildCommit[];
  findings: GraphBuildFinding[];
  timelineSteps?: GraphBuildTimelineStep[];
}): EvidenceGraph {
  const {
    event,
    userFrames,
    recentCommits,
    findings,
    timelineSteps = [],
  } = params;

  const nodes: EvidenceNode[] = [];
  const edges: EvidenceEdge[] = [];

  // 1. Error node (root)
  const errorNode = createErrorNode(event);
  nodes.push(errorNode);

  // 2. Code location nodes from stack frames
  const codeNodes = createCodeLocationNodes(userFrames);
  nodes.push(...codeNodes);

  // 3. Edges from error to code locations
  const errorToCodeEdges = createErrorToCodeEdges(errorNode.id, codeNodes);
  edges.push(...errorToCodeEdges);

  // 4. Commit nodes
  const commitNodes = createCommitNodes(recentCommits);
  nodes.push(...commitNodes);

  // 5. Edges from code to commits (for entry point)
  const entryPoint = codeNodes.find((n) => n.data.is_entry_point);
  if (entryPoint) {
    const codeToCommitEdges = createCodeToCommitEdges(
      entryPoint.id,
      commitNodes,
      recentCommits
    );
    edges.push(...codeToCommitEdges);
  }

  // 6. Pattern nodes from findings
  const patternNodes = createPatternNodes(findings);
  nodes.push(...patternNodes);

  // 7. Edges from code to patterns
  const primaryCode = codeNodes[0];
  if (primaryCode) {
    const codeToPatternEdges = createCodeToPatternEdges(
      primaryCode.id,
      patternNodes
    );
    edges.push(...codeToPatternEdges);
  }

  // 8. Timeline event nodes (only anomalies for now)
  const timelineNodes = createTimelineNodes(timelineSteps);
  nodes.push(...timelineNodes);

  // 9. Edges from timeline to error
  const timelineToErrorEdges = createTimelineToErrorEdges(
    timelineNodes,
    errorNode.id
  );
  edges.push(...timelineToErrorEdges);

  // 10. Developer nodes from commits
  const developerNodes = createDeveloperNodes(recentCommits);
  nodes.push(...developerNodes);

  // 11. Edges from commits to developers
  const commitToDeveloperEdges = createCommitToDeveloperEdges(
    commitNodes,
    developerNodes,
    recentCommits
  );
  edges.push(...commitToDeveloperEdges);

  // Build metadata
  const metadata = calculateMetadata(nodes, edges, findings);

  return {
    nodes,
    edges,
    metadata,
  };
}

// =============================================================================
// NODE CREATORS (Pure Functions)
// =============================================================================

/**
 * Create error node from event
 */
function createErrorNode(event: GraphBuildEvent): EvidenceNode {
  const errorType = event.exception?.type ?? "Error";
  const errorMessage = event.message.substring(0, 100);

  return {
    id: "error",
    type: "error",
    label: `${errorType}: ${errorMessage}`,
    data: {
      type: errorType,
      value: event.exception?.value ?? event.message,
      occurrences: event.count ?? 1,
    },
    confidence: 1.0, // Error occurrence is certain
  };
}

/**
 * Create code location nodes from stack frames
 */
function createCodeLocationNodes(frames: GraphBuildFrame[]): EvidenceNode[] {
  return frames.map((frame, index) => ({
    id: `code_${index}`,
    type: "code_location" as const,
    label: formatCodeLabel(frame),
    data: {
      file_path: frame.file_path,
      line_number: frame.line_number,
      column_number: frame.column_number,
      function_name: frame.function_name,
      context_line: frame.context_line,
      is_entry_point: frame.is_entry_point ?? index === 0,
    },
    confidence: frame.is_entry_point ? 0.95 : 0.7 - index * 0.05,
  }));
}

/**
 * Create commit nodes from recent commits
 */
function createCommitNodes(commits: GraphBuildCommit[]): EvidenceNode[] {
  return commits.map((commit, index) => {
    // Calculate age in days
    const commitDate = new Date(commit.author.date);
    const now = new Date();
    const ageDays = Math.floor(
      (now.getTime() - commitDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    return {
      id: `commit_${index}`,
      type: "commit" as const,
      label: commit.short_sha ?? commit.sha.substring(0, 7),
      data: {
        sha: commit.sha,
        message: commit.message.split("\n")[0], // First line only
        author: commit.author.name,
        date: commit.author.date,
        age_days: ageDays,
        files_changed: commit.files_changed,
        additions: commit.additions,
        deletions: commit.deletions,
      },
      confidence: ageDays < 7 ? 0.8 : ageDays < 14 ? 0.6 : 0.4,
    };
  });
}

/**
 * Create pattern nodes from deterministic findings
 */
function createPatternNodes(findings: GraphBuildFinding[]): EvidenceNode[] {
  return findings.map((finding, index) => ({
    id: `pattern_${index}`,
    type: "pattern" as const,
    label: finding.title ?? finding.rule_id,
    data: {
      rule_id: finding.rule_id,
      message: finding.message,
      severity: finding.severity,
      location: finding.location,
      suggested_fix: finding.suggested_fix,
    },
    confidence: finding.confidence,
  }));
}

/**
 * Create timeline nodes from anomalies
 */
function createTimelineNodes(steps: GraphBuildTimelineStep[]): EvidenceNode[] {
  // Only include anomalies and errors
  const relevantSteps = steps.filter(
    (step) => step.is_anomaly || step.level === "error"
  );

  return relevantSteps.map((step, index) => ({
    id: `timeline_${index}`,
    type: "timeline_event" as const,
    label: step.message.substring(0, 50),
    data: {
      timestamp: step.timestamp,
      type: step.type,
      level: step.level,
      is_anomaly: step.is_anomaly,
    },
    confidence: step.is_anomaly ? 0.7 : 0.5,
  }));
}

/**
 * Create developer nodes from commits (deduplicated by email)
 */
function createDeveloperNodes(commits: GraphBuildCommit[]): EvidenceNode[] {
  const seenEmails = new Set<string>();
  const nodes: EvidenceNode[] = [];

  for (const commit of commits) {
    const email = commit.author.email;
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);

    nodes.push({
      id: `dev_${nodes.length}`,
      type: "developer",
      label: commit.author.name,
      data: {
        email,
        name: commit.author.name,
        github_username: commit.author.github_username,
      },
      confidence: 0.9, // We know who authored the commits
    });
  }

  return nodes;
}

// =============================================================================
// EDGE CREATORS (Pure Functions)
// =============================================================================

/**
 * Create edges from error to code locations
 */
function createErrorToCodeEdges(
  errorId: string,
  codeNodes: EvidenceNode[]
): EvidenceEdge[] {
  return codeNodes.map((codeNode, index) => {
    const isEntryPoint = codeNode.data.is_entry_point as boolean;

    return {
      id: `error_to_code_${index}`,
      source: errorId,
      target: codeNode.id,
      type: isEntryPoint ? "caused_by" : "triggered_when",
      label: isEntryPoint ? "originated at" : "propagated through",
      evidence: `Stack frame ${index}: ${codeNode.label}`,
    };
  });
}

/**
 * Create edges from code to commits
 */
function createCodeToCommitEdges(
  codeId: string,
  commitNodes: EvidenceNode[],
  commits: GraphBuildCommit[]
): EvidenceEdge[] {
  return commitNodes.map((commitNode, index) => {
    const ageDays = (commitNode.data.age_days as number) ?? 0;
    const commit = commits[index];

    return {
      id: `code_to_commit_${index}`,
      source: codeId,
      target: commitNode.id,
      type: "introduced_in",
      label: `changed ${ageDays} days ago`,
      evidence: `Commit ${commit?.sha?.substring(0, 7) ?? commitNode.label}: ${commit?.message?.split("\n")[0] ?? ""}`,
    };
  });
}

/**
 * Create edges from code to patterns
 */
function createCodeToPatternEdges(
  codeId: string,
  patternNodes: EvidenceNode[]
): EvidenceEdge[] {
  return patternNodes.map((patternNode, index) => ({
    id: `code_to_pattern_${index}`,
    source: codeId,
    target: patternNode.id,
    type: "similar_to",
    label: "matches pattern",
    evidence: `AST analysis: ${patternNode.data.rule_id as string}`,
  }));
}

/**
 * Create edges from timeline events to error
 */
function createTimelineToErrorEdges(
  timelineNodes: EvidenceNode[],
  errorId: string
): EvidenceEdge[] {
  return timelineNodes.map((timelineNode, index) => ({
    id: `timeline_to_error_${index}`,
    source: timelineNode.id,
    target: errorId,
    type: "triggered_when",
    label: "preceded error",
    evidence: `Timeline event: ${timelineNode.data.type as string} at ${timelineNode.data.timestamp as string}`,
  }));
}

/**
 * Create edges from commits to developers
 */
function createCommitToDeveloperEdges(
  commitNodes: EvidenceNode[],
  developerNodes: EvidenceNode[],
  commits: GraphBuildCommit[]
): EvidenceEdge[] {
  const edges: EvidenceEdge[] = [];

  for (let i = 0; i < commitNodes.length; i++) {
    const commit = commits[i];
    if (!commit) continue;

    // Find developer node by email
    const devNode = developerNodes.find(
      (n) => (n.data.email as string) === commit.author.email
    );
    if (!devNode) continue;

    edges.push({
      id: `commit_to_dev_${i}`,
      source: commitNodes[i].id,
      target: devNode.id,
      type: "authored_by",
      label: "authored by",
      evidence: `Commit ${commit.sha.substring(0, 7)} by ${commit.author.email}`,
    });
  }

  return edges;
}

// =============================================================================
// METADATA CALCULATION (Pure Functions)
// =============================================================================

/**
 * Calculate graph metadata
 */
function calculateMetadata(
  nodes: EvidenceNode[],
  edges: EvidenceEdge[],
  _findings: GraphBuildFinding[]
): EvidenceGraphMetadata {
  // Calculate overall confidence as weighted average
  const confidence = calculateOverallConfidence(nodes);

  // Calculate deterministic score
  const patternNodes = nodes.filter((n) => n.type === "pattern");
  const deterministicScore = patternNodes.length / Math.max(1, nodes.length);

  // Count high-confidence edges (based on source node confidence)
  const highConfidenceEdges = edges.filter((edge) => {
    const sourceNode = nodes.find((n) => n.id === edge.source);
    return sourceNode && sourceNode.confidence > 0.8;
  }).length;

  // Validate graph
  const isValid = validateGraph(nodes, edges);

  return {
    created_at: new Date().toISOString(),
    confidence,
    deterministic_score: deterministicScore,
    high_confidence_edges: highConfidenceEdges,
    is_valid: isValid,
  };
}

/**
 * Calculate overall confidence from nodes
 */
function calculateOverallConfidence(nodes: EvidenceNode[]): number {
  if (nodes.length === 0) return 0;

  // Weight different node types
  const weights: Record<string, number> = {
    error: 2.0,
    code_location: 1.5,
    pattern: 2.0, // Deterministic findings are high value
    commit: 1.0,
    timeline_event: 0.5,
    developer: 0.5,
  };

  let totalWeight = 0;
  let weightedSum = 0;

  for (const node of nodes) {
    const weight = weights[node.type] ?? 1.0;
    totalWeight += weight;
    weightedSum += node.confidence * weight;
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}

/**
 * Validate graph structure
 */
function validateGraph(nodes: EvidenceNode[], edges: EvidenceEdge[]): boolean {
  // Check for error node
  const hasError = nodes.some((n) => n.type === "error");
  if (!hasError) return false;

  // Check all edge references are valid
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      return false;
    }
  }

  // Check for no self-loops
  for (const edge of edges) {
    if (edge.source === edge.target) {
      return false;
    }
  }

  return true;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Format code location label
 */
function formatCodeLabel(frame: GraphBuildFrame): string {
  const fileName = frame.file_path.split("/").pop() ?? frame.file_path;
  const line = frame.line_number ?? "?";
  const func = frame.function_name ?? "<anonymous>";

  return `${fileName}:${line} in ${func}`;
}

// =============================================================================
// SERIALIZATION
// =============================================================================

/**
 * Convert evidence graph to JSON-serializable format
 */
export function serializeEvidenceGraph(graph: EvidenceGraph): string {
  return JSON.stringify(graph);
}

/**
 * Parse evidence graph from JSON string
 */
export function parseEvidenceGraph(json: string): EvidenceGraph | null {
  try {
    const parsed = JSON.parse(json);
    // Could add schema validation here
    return parsed as EvidenceGraph;
  } catch {
    return null;
  }
}
