/**
 * Evidence Graph View Component
 *
 * Interactive visualization of the evidence graph using React Flow.
 * Shows how different pieces of evidence (errors, code, commits, findings)
 * connect to form the root cause analysis.
 *
 * Usage:
 *   <EvidenceGraphView rcaId="rca-123" orgId="org-456" />
 *
 * Installation required:
 *   npm install reactflow dagre
 */

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ChartBarIcon,
  ArrowsPointingOutIcon,
  ArrowPathIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../lib/utils";

// ============================================================================
// Types
// ============================================================================

/**
 * Evidence node types from backend
 */
type EvidenceNodeType =
  | "error"
  | "code_location"
  | "commit"
  | "developer"
  | "pattern"
  | "timeline_event";

/**
 * Edge relationship types
 */
type EvidenceEdgeType =
  | "caused_by"
  | "introduced_in"
  | "triggered_when"
  | "similar_to"
  | "authored_by";

/**
 * Backend evidence node structure
 */
interface EvidenceNode {
  id: string;
  type: EvidenceNodeType;
  label: string;
  confidence: number;
  data: Record<string, unknown>;
}

/**
 * Backend evidence edge structure
 */
interface EvidenceEdge {
  id: string;
  source: string;
  target: string;
  type: EvidenceEdgeType;
  confidence: number;
  label?: string;
}

/**
 * Full evidence graph from backend
 */
interface EvidenceGraph {
  nodes: EvidenceNode[];
  edges: EvidenceEdge[];
  metadata: {
    node_count: number;
    edge_count: number;
    max_depth: number;
    graph_density: number;
  };
}

/**
 * Component props
 */
interface EvidenceGraphViewProps {
  rcaId: string;
  orgId: string;
  className?: string;
}

// ============================================================================
// Node Style Configuration
// ============================================================================

const NODE_STYLES: Record<
  EvidenceNodeType,
  {
    bgColor: string;
    borderColor: string;
    textColor: string;
    iconBgColor: string;
    icon: string;
  }
> = {
  error: {
    bgColor: "bg-red-50 dark:bg-red-900/30",
    borderColor: "border-red-300 dark:border-red-700",
    textColor: "text-red-700 dark:text-red-300",
    iconBgColor: "bg-red-100 dark:bg-red-800/50",
    icon: "🔴",
  },
  code_location: {
    bgColor: "bg-blue-50 dark:bg-blue-900/30",
    borderColor: "border-blue-300 dark:border-blue-700",
    textColor: "text-blue-700 dark:text-blue-300",
    iconBgColor: "bg-blue-100 dark:bg-blue-800/50",
    icon: "📄",
  },
  commit: {
    bgColor: "bg-purple-50 dark:bg-purple-900/30",
    borderColor: "border-purple-300 dark:border-purple-700",
    textColor: "text-purple-700 dark:text-purple-300",
    iconBgColor: "bg-purple-100 dark:bg-purple-800/50",
    icon: "📝",
  },
  developer: {
    bgColor: "bg-green-50 dark:bg-green-900/30",
    borderColor: "border-green-300 dark:border-green-700",
    textColor: "text-green-700 dark:text-green-300",
    iconBgColor: "bg-green-100 dark:bg-green-800/50",
    icon: "👤",
  },
  pattern: {
    bgColor: "bg-yellow-50 dark:bg-yellow-900/30",
    borderColor: "border-yellow-300 dark:border-yellow-700",
    textColor: "text-yellow-700 dark:text-yellow-300",
    iconBgColor: "bg-yellow-100 dark:bg-yellow-800/50",
    icon: "🔍",
  },
  timeline_event: {
    bgColor: "bg-gray-50 dark:bg-gray-800/50",
    borderColor: "border-gray-300 dark:border-gray-700",
    textColor: "text-gray-700 dark:text-gray-300",
    iconBgColor: "bg-gray-100 dark:bg-gray-800",
    icon: "📅",
  },
};

const EDGE_STYLES: Record<
  EvidenceEdgeType,
  { color: string; dashed: boolean }
> = {
  caused_by: { color: "#ef4444", dashed: false },
  introduced_in: { color: "#f59e0b", dashed: true },
  triggered_when: { color: "#8b5cf6", dashed: false },
  similar_to: { color: "#3b82f6", dashed: true },
  authored_by: { color: "#10b981", dashed: true },
};

// ============================================================================
// Custom Node Component
// ============================================================================

interface GraphNodeProps {
  node: EvidenceNode;
  selected: boolean;
  onSelect: (id: string) => void;
}

function GraphNode({ node, selected, onSelect }: GraphNodeProps) {
  const style = NODE_STYLES[node.type];
  const confidencePercent = Math.round(node.confidence * 100);

  return (
    <div
      onClick={() => onSelect(node.id)}
      className={cn(
        "relative p-3 rounded-lg border-2 cursor-pointer transition-all duration-200",
        "min-w-[180px] max-w-[220px]",
        style.bgColor,
        style.borderColor,
        selected &&
          "ring-2 ring-offset-2 ring-blue-500 dark:ring-offset-gray-900",
        "hover:shadow-lg hover:-translate-y-0.5"
      )}
    >
      {/* Node Header */}
      <div className="flex items-center gap-2 mb-2">
        <span
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded-md text-lg",
            style.iconBgColor
          )}
        >
          {style.icon}
        </span>
        <div className="flex-1 min-w-0">
          <span
            className={cn(
              "text-xs font-medium uppercase tracking-wider",
              style.textColor
            )}
          >
            {node.type.replace("_", " ")}
          </span>
        </div>
      </div>

      {/* Node Label */}
      <p
        className="text-sm font-medium text-gray-900 dark:text-white truncate"
        title={node.label}
      >
        {node.label}
      </p>

      {/* Confidence Badge */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
          <div
            className={cn(
              "h-1.5 rounded-full transition-all duration-500",
              confidencePercent >= 80
                ? "bg-green-500"
                : confidencePercent >= 50
                  ? "bg-yellow-500"
                  : "bg-red-500"
            )}
            style={{ width: `${confidencePercent}%` }}
          />
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
          {confidencePercent}%
        </span>
      </div>
    </div>
  );
}

// ============================================================================
// Simple Graph Layout (CSS Grid fallback)
// ============================================================================

interface SimpleGraphLayoutProps {
  graph: EvidenceGraph;
  selectedNode: string | null;
  onSelectNode: (id: string) => void;
}

function SimpleGraphLayout({
  graph,
  selectedNode,
  onSelectNode,
}: SimpleGraphLayoutProps) {
  // Group nodes by type for hierarchical display
  const groupedNodes = useMemo(() => {
    const groups: Record<string, EvidenceNode[]> = {
      error: [],
      code_location: [],
      commit: [],
      pattern: [],
      developer: [],
      timeline_event: [],
    };

    graph.nodes.forEach((node) => {
      if (groups[node.type]) {
        groups[node.type].push(node);
      }
    });

    return groups;
  }, [graph.nodes]);

  // Display order for hierarchy
  const displayOrder: EvidenceNodeType[] = [
    "error",
    "pattern",
    "code_location",
    "commit",
    "developer",
    "timeline_event",
  ];

  return (
    <div className="space-y-8">
      {displayOrder.map((nodeType) => {
        const nodes = groupedNodes[nodeType];
        if (nodes.length === 0) return null;

        return (
          <div key={nodeType}>
            <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3 capitalize">
              {nodeType.replace("_", " ")}s ({nodes.length})
            </h3>
            <div className="flex flex-wrap gap-4">
              {nodes.map((node) => (
                <GraphNode
                  key={node.id}
                  node={node}
                  selected={selectedNode === node.id}
                  onSelect={onSelectNode}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Edge Legend */}
      <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          Relationship Types
        </h3>
        <div className="flex flex-wrap gap-4">
          {Object.entries(EDGE_STYLES).map(([type, style]) => (
            <div key={type} className="flex items-center gap-2">
              <div
                className="w-8 h-0.5"
                style={{
                  backgroundColor: style.color,
                  borderStyle: style.dashed ? "dashed" : "solid",
                }}
              />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {type.replace("_", " ")}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Node Detail Panel
// ============================================================================

interface NodeDetailPanelProps {
  node: EvidenceNode | null;
  edges: EvidenceEdge[];
  allNodes: EvidenceNode[];
  onClose: () => void;
}

function NodeDetailPanel({
  node,
  edges,
  allNodes,
  onClose,
}: NodeDetailPanelProps) {
  if (!node) return null;

  const style = NODE_STYLES[node.type];
  const relatedEdges = edges.filter(
    (e) => e.source === node.id || e.target === node.id
  );

  return (
    <div className="absolute right-4 top-4 w-80 bg-white dark:bg-gray-900 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 z-10">
      {/* Header */}
      <div className={cn("p-4 rounded-t-lg", style.bgColor)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className={cn("text-2xl", style.iconBgColor, "p-2 rounded-lg")}
            >
              {style.icon}
            </span>
            <div>
              <span
                className={cn("text-xs font-medium uppercase", style.textColor)}
              >
                {node.type.replace("_", " ")}
              </span>
              <p className="text-sm font-semibold text-gray-900 dark:text-white">
                {node.label}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-4">
        {/* Confidence */}
        <div>
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
            Confidence
          </label>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div
                className={cn(
                  "h-2 rounded-full",
                  node.confidence >= 0.8
                    ? "bg-green-500"
                    : node.confidence >= 0.5
                      ? "bg-yellow-500"
                      : "bg-red-500"
                )}
                style={{ width: `${node.confidence * 100}%` }}
              />
            </div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {Math.round(node.confidence * 100)}%
            </span>
          </div>
        </div>

        {/* Relationships */}
        {relatedEdges.length > 0 && (
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Relationships ({relatedEdges.length})
            </label>
            <div className="mt-2 space-y-2">
              {relatedEdges.map((edge) => {
                const isSource = edge.source === node.id;
                const relatedNodeId = isSource ? edge.target : edge.source;
                const relatedNode = allNodes.find(
                  (n) => n.id === relatedNodeId
                );
                const edgeStyle = EDGE_STYLES[edge.type];

                return (
                  <div
                    key={edge.id}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <div
                      className="w-3 h-0.5"
                      style={{
                        backgroundColor: edgeStyle.color,
                        borderStyle: edgeStyle.dashed ? "dashed" : "solid",
                      }}
                    />
                    <span className="text-gray-500 dark:text-gray-400">
                      {isSource ? "→" : "←"} {edge.type.replace("_", " ")}
                    </span>
                    <span className="font-medium truncate">
                      {relatedNode?.label || relatedNodeId}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Additional Data */}
        {Object.keys(node.data).length > 0 && (
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Details
            </label>
            <div className="mt-2 bg-gray-50 dark:bg-gray-800 rounded p-2 text-xs font-mono overflow-auto max-h-32">
              <pre>{JSON.stringify(node.data, null, 2)}</pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * Evidence Graph View Component
 *
 * Displays an interactive visualization of the evidence graph.
 * Uses a simple CSS-based layout as fallback when React Flow is not installed.
 */
export function EvidenceGraphView({
  rcaId,
  orgId,
  className,
}: EvidenceGraphViewProps) {
  const [graph, setGraph] = useState<EvidenceGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Fetch evidence graph from API
  useEffect(() => {
    async function fetchGraph() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/v1/rca/${rcaId}/evidence-graph`, {
          headers: {
            "x-org-id": orgId,
            "Content-Type": "application/json",
          },
          credentials: "include",
        });

        if (!response.ok) {
          if (response.status === 404) {
            // No graph data yet - show empty state
            setGraph(null);
            return;
          }
          throw new Error(`Failed to fetch evidence graph: ${response.status}`);
        }

        const data = await response.json();
        setGraph(data.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    }

    fetchGraph();
  }, [rcaId, orgId]);

  // Handle node selection
  const handleSelectNode = useCallback((id: string) => {
    setSelectedNode((prev) => (prev === id ? null : id));
  }, []);

  // Get selected node details
  const selectedNodeData = useMemo(() => {
    if (!graph || !selectedNode) return null;
    return graph.nodes.find((n) => n.id === selectedNode) || null;
  }, [graph, selectedNode]);

  // Loading state
  if (loading) {
    return (
      <div
        className={cn("bg-gray-50 dark:bg-gray-800 rounded-lg p-8", className)}
      >
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <ArrowPathIcon className="w-12 h-12 text-gray-400 dark:text-gray-500 animate-spin mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400">
              Loading evidence graph...
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={cn("bg-gray-50 dark:bg-gray-800 rounded-lg p-8", className)}
      >
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <div className="text-red-500 dark:text-red-400 text-4xl mb-4">
              ⚠️
            </div>
            <p className="text-red-600 dark:text-red-400 font-medium mb-2">
              Failed to load evidence graph
            </p>
            <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!graph || graph.nodes.length === 0) {
    return (
      <div
        className={cn("bg-gray-50 dark:bg-gray-800 rounded-lg p-8", className)}
      >
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <ChartBarIcon className="w-16 h-16 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
            <p className="text-gray-500 dark:text-gray-400 mb-2">
              No evidence graph available
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500">
              The RCA analysis did not generate a visual evidence graph.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Main graph view
  return (
    <div className={cn("relative", className)}>
      {/* Header with stats */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {graph.metadata.node_count} nodes • {graph.metadata.edge_count}{" "}
            edges
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            Depth: {graph.metadata.max_depth}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSelectedNode(null)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-md transition-colors",
              "bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700",
              "text-gray-700 dark:text-gray-300"
            )}
          >
            <ArrowsPointingOutIcon className="w-4 h-4 inline-block mr-1" />
            Reset View
          </button>
        </div>
      </div>

      {/* Graph Container */}
      <div className="relative bg-gray-50 dark:bg-gray-800/50 rounded-lg p-6 min-h-[500px] overflow-auto">
        <SimpleGraphLayout
          graph={graph}
          selectedNode={selectedNode}
          onSelectNode={handleSelectNode}
        />

        {/* Node Detail Panel */}
        <NodeDetailPanel
          node={selectedNodeData}
          edges={graph.edges}
          allNodes={graph.nodes}
          onClose={() => setSelectedNode(null)}
        />
      </div>
    </div>
  );
}

export default EvidenceGraphView;
