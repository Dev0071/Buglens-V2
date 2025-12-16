/**
 * Tests for evidence graph builder.
 */

import { describe, it, expect } from "vitest";
import {
  buildEvidenceGraph,
  serializeEvidenceGraph,
  parseEvidenceGraph,
} from "../../src/services/evidence-graph-builder.js";
import type {
  GraphBuildEvent,
  GraphBuildFrame,
  GraphBuildCommit,
  GraphBuildFinding,
  GraphBuildTimelineStep,
} from "../../src/types/evidence-graph.js";

describe("buildEvidenceGraph", () => {
  // Sample data for tests
  const sampleEvent: GraphBuildEvent = {
    message: "Cannot read property 'name' of undefined",
    exception: {
      type: "TypeError",
      value: "Cannot read property 'name' of undefined",
    },
    count: 5,
  };

  const sampleFrames: GraphBuildFrame[] = [
    {
      file_path: "src/services/user.js",
      line_number: 42,
      column_number: 10,
      function_name: "getUserName",
      context_line: "return user.name;",
      is_entry_point: true,
    },
    {
      file_path: "src/routes/profile.js",
      line_number: 15,
      function_name: "handleProfile",
      is_entry_point: false,
    },
  ];

  const sampleCommits: GraphBuildCommit[] = [
    {
      sha: "abc123def456789",
      short_sha: "abc123d",
      message: "Refactor user service",
      author: {
        name: "John Developer",
        email: "john@example.com",
        date: new Date().toISOString(),
        github_username: "johndev",
      },
      files_changed: 3,
      additions: 50,
      deletions: 20,
    },
  ];

  const sampleFindings: GraphBuildFinding[] = [
    {
      rule_id: "null-access",
      title: "Potential null access",
      message: "Accessing property 'name' without null check",
      severity: "high",
      confidence: 0.92,
      location: {
        file: "src/services/user.js",
        line: 42,
        column: 10,
      },
      suggested_fix: "Add null check before accessing property",
    },
  ];

  const sampleTimeline: GraphBuildTimelineStep[] = [
    {
      timestamp: "2024-01-15T14:30:00Z",
      type: "http",
      message: "GET /api/profile",
      level: "info",
      is_anomaly: false,
    },
    {
      timestamp: "2024-01-15T14:30:02Z",
      type: "error",
      message: "TypeError: Cannot read property",
      level: "error",
      is_anomaly: true,
    },
  ];

  it("should create error node at root", () => {
    const graph = buildEvidenceGraph({
      event: sampleEvent,
      userFrames: [],
      recentCommits: [],
      findings: [],
    });

    const errorNode = graph.nodes.find((n) => n.id === "error");
    expect(errorNode).toBeDefined();
    expect(errorNode?.type).toBe("error");
    expect(errorNode?.confidence).toBe(1.0);
    expect(errorNode?.label).toContain("TypeError");
  });

  it("should create code location nodes from frames", () => {
    const graph = buildEvidenceGraph({
      event: sampleEvent,
      userFrames: sampleFrames,
      recentCommits: [],
      findings: [],
    });

    const codeNodes = graph.nodes.filter((n) => n.type === "code_location");
    expect(codeNodes).toHaveLength(2);

    const entryPoint = codeNodes.find((n) => n.data.is_entry_point);
    expect(entryPoint).toBeDefined();
    expect(entryPoint?.confidence).toBeGreaterThan(0.9);
  });

  it("should create edges from error to code locations", () => {
    const graph = buildEvidenceGraph({
      event: sampleEvent,
      userFrames: sampleFrames,
      recentCommits: [],
      findings: [],
    });

    const errorToCodeEdges = graph.edges.filter((e) => e.source === "error");
    expect(errorToCodeEdges).toHaveLength(2);

    const causedByEdge = errorToCodeEdges.find((e) => e.type === "caused_by");
    expect(causedByEdge).toBeDefined();
    expect(causedByEdge?.target).toBe("code_0");
  });

  it("should create commit nodes", () => {
    const graph = buildEvidenceGraph({
      event: sampleEvent,
      userFrames: sampleFrames,
      recentCommits: sampleCommits,
      findings: [],
    });

    const commitNodes = graph.nodes.filter((n) => n.type === "commit");
    expect(commitNodes).toHaveLength(1);
    expect(commitNodes[0].label).toBe("abc123d");
    expect(commitNodes[0].data.author).toBe("John Developer");
  });

  it("should create pattern nodes from findings", () => {
    const graph = buildEvidenceGraph({
      event: sampleEvent,
      userFrames: sampleFrames,
      recentCommits: [],
      findings: sampleFindings,
    });

    const patternNodes = graph.nodes.filter((n) => n.type === "pattern");
    expect(patternNodes).toHaveLength(1);
    expect(patternNodes[0].label).toBe("Potential null access");
    expect(patternNodes[0].confidence).toBe(0.92);
  });

  it("should create timeline nodes only for anomalies", () => {
    const graph = buildEvidenceGraph({
      event: sampleEvent,
      userFrames: [],
      recentCommits: [],
      findings: [],
      timelineSteps: sampleTimeline,
    });

    const timelineNodes = graph.nodes.filter(
      (n) => n.type === "timeline_event"
    );
    // Only the anomaly should be included
    expect(timelineNodes).toHaveLength(1);
    expect(timelineNodes[0].data.is_anomaly).toBe(true);
  });

  it("should create developer nodes deduplicated by email", () => {
    const commitsWithSameAuthor: GraphBuildCommit[] = [
      ...sampleCommits,
      {
        ...sampleCommits[0],
        sha: "def456",
        short_sha: "def456",
        message: "Another commit",
      },
    ];

    const graph = buildEvidenceGraph({
      event: sampleEvent,
      userFrames: [],
      recentCommits: commitsWithSameAuthor,
      findings: [],
    });

    const devNodes = graph.nodes.filter((n) => n.type === "developer");
    expect(devNodes).toHaveLength(1); // Same email, deduplicated
  });

  it("should calculate metadata correctly", () => {
    const graph = buildEvidenceGraph({
      event: sampleEvent,
      userFrames: sampleFrames,
      recentCommits: sampleCommits,
      findings: sampleFindings,
    });

    expect(graph.metadata.is_valid).toBe(true);
    expect(graph.metadata.confidence).toBeGreaterThan(0);
    expect(graph.metadata.confidence).toBeLessThanOrEqual(1);
    expect(graph.metadata.deterministic_score).toBeGreaterThan(0);
    expect(graph.metadata.created_at).toBeDefined();
  });

  it("should validate graph structure", () => {
    const graph = buildEvidenceGraph({
      event: sampleEvent,
      userFrames: sampleFrames,
      recentCommits: sampleCommits,
      findings: sampleFindings,
    });

    // All edge references should be valid
    const nodeIds = new Set(graph.nodes.map((n) => n.id));
    for (const edge of graph.edges) {
      expect(nodeIds.has(edge.source)).toBe(true);
      expect(nodeIds.has(edge.target)).toBe(true);
      expect(edge.source).not.toBe(edge.target); // No self-loops
    }
  });
});

describe("serializeEvidenceGraph", () => {
  it("should serialize graph to JSON string", () => {
    const graph = buildEvidenceGraph({
      event: { message: "Test error" },
      userFrames: [],
      recentCommits: [],
      findings: [],
    });

    const json = serializeEvidenceGraph(graph);
    expect(typeof json).toBe("string");
    expect(json).toContain("nodes");
    expect(json).toContain("edges");
  });
});

describe("parseEvidenceGraph", () => {
  it("should parse valid JSON to graph", () => {
    const graph = buildEvidenceGraph({
      event: { message: "Test error" },
      userFrames: [],
      recentCommits: [],
      findings: [],
    });

    const json = serializeEvidenceGraph(graph);
    const parsed = parseEvidenceGraph(json);

    expect(parsed).not.toBeNull();
    expect(parsed?.nodes).toHaveLength(graph.nodes.length);
    expect(parsed?.metadata.is_valid).toBe(true);
  });

  it("should return null for invalid JSON", () => {
    const result = parseEvidenceGraph("not valid json {");
    expect(result).toBeNull();
  });
});
