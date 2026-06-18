import type { GraphNode, GraphEdge, CommunityInfo } from "./wiki-graph"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SurprisingConnection {
  source: GraphNode
  target: GraphNode
  score: number
  reasons: string[]
  key: string // stable ID for dismiss tracking
}

export interface KnowledgeGap {
  type: "isolated-node" | "sparse-community" | "bridge-node"
  title: string
  description: string
  nodeIds: string[]
  suggestion: string
}

// ---------------------------------------------------------------------------
// Surprising Connections
// ---------------------------------------------------------------------------

/**
 * Find edges that are "surprising" — connecting nodes across communities,
 * across types, or linking peripheral nodes to hubs.
 */
export function findSurprisingConnections(
  nodes: GraphNode[],
  edges: GraphEdge[],
  _communities: CommunityInfo[],
  limit: number = 5,
): SurprisingConnection[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))
  const degreeMap = new Map(nodes.map((n) => [n.id, n.linkCount]))
  const maxDegree = Math.max(...nodes.map((n) => n.linkCount), 1)

  // Structural pages that link to everything — exclude from analysis
  const STRUCTURAL_IDS = new Set(["index", "log", "overview"])

  const scored: SurprisingConnection[] = []

  for (const edge of edges) {
    const source = nodeMap.get(edge.source)
    const target = nodeMap.get(edge.target)
    if (!source || !target) continue
    if (STRUCTURAL_IDS.has(source.id) || STRUCTURAL_IDS.has(target.id)) continue

    let score = 0
    const reasons: string[] = []

    // Signal 1: Cross-community edge (+3)
    if (source.community !== target.community) {
      score += 3
      reasons.push("crosses community boundary")
    }

    // Signal 2: Cross-type edge (+2 for distant types)
    if (source.type !== target.type) {
      const distantPairs = new Set([
        "source-concept", "concept-source",
        "source-synthesis", "synthesis-source",
        "query-entity", "entity-query",
      ])
      const pair = `${source.type}-${target.type}`
      if (distantPairs.has(pair)) {
        score += 2
        reasons.push(`connects ${source.type} to ${target.type}`)
      } else {
        score += 1
        reasons.push("different types")
      }
    }

    // Signal 3: Peripheral-to-hub coupling (+2)
    const sourceDeg = degreeMap.get(source.id) ?? 0
    const targetDeg = degreeMap.get(target.id) ?? 0
    const minDeg = Math.min(sourceDeg, targetDeg)
    const maxDeg = Math.max(sourceDeg, targetDeg)
    if (minDeg <= 2 && maxDeg >= maxDegree * 0.5) {
      score += 2
      reasons.push("peripheral node links to hub")
    }

    // Signal 4: Low-weight edge between connected nodes (+1)
    if (edge.weight < 2 && edge.weight > 0) {
      score += 1
      reasons.push("weak but present connection")
    }

    if (score >= 3 && reasons.length > 0) {
      const key = [source.id, target.id].sort().join(":::")
      scored.push({ source, target, score, reasons, key })
    }
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Knowledge Gaps
// ---------------------------------------------------------------------------

/**
 * Detect knowledge gaps based on graph structure:
 * - Isolated nodes (degree ≤ 1)
 * - Sparse communities (cohesion < 0.15 with ≥ 3 nodes)
 * - Bridge nodes (high betweenness — connected to multiple communities)
 */
export function detectKnowledgeGaps(
  nodes: GraphNode[],
  edges: GraphEdge[],
  communities: CommunityInfo[],
  limit: number = 8,
): KnowledgeGap[] {
  const gaps: KnowledgeGap[] = []
  const nodeMap = new Map(nodes.map((n) => [n.id, n]))

  // 1. Isolated nodes (degree ≤ 1, exclude overview/index)
  const isolatedNodes = nodes.filter(
    (n) => n.linkCount <= 1 && n.type !== "overview" && n.id !== "index" && n.id !== "log",
  )
  if (isolatedNodes.length > 0) {
    const topIsolated = isolatedNodes.slice(0, 5)
    gaps.push({
      type: "isolated-node",
      title: `${isolatedNodes.length} 个孤立页面`,
      description: topIsolated.map((n) => n.label).join(", ") +
        (isolatedNodes.length > 5 ? ` 等${isolatedNodes.length - 5}个更多` : ""),
      nodeIds: isolatedNodes.map((n) => n.id),
      suggestion: "这些页面几乎没有或没有连接。考虑添加 [[wikilinks]] 到相关页面，或进行研究以扩展其内容。",
    })
  }

  // 2. Sparse communities (low cohesion)
  for (const comm of communities) {
    if (comm.cohesion < 0.15 && comm.nodeCount >= 3) {
      gaps.push({
        type: "sparse-community",
        title: `稀疏集群: ${comm.topNodes[0] ?? `社区 ${comm.id}`}`,
        description: `${comm.nodeCount} 个页面，内聚度 ${comm.cohesion.toFixed(2)} — 内部连接较弱。`,
        nodeIds: nodes.filter((n) => n.community === comm.id).map((n) => n.id),
        suggestion: `该知识领域缺乏内部交叉引用。考虑在这些页面之间添加链接或研究以填补空白。`,
      })
    }
  }

  // 3. Bridge nodes (connected to multiple communities)
  const communityNeighbors = new Map<string, Set<number>>()
  for (const node of nodes) {
    communityNeighbors.set(node.id, new Set())
  }
  for (const edge of edges) {
    const sourceNode = nodeMap.get(edge.source)
    const targetNode = nodeMap.get(edge.target)
    if (sourceNode && targetNode) {
      communityNeighbors.get(edge.source)?.add(targetNode.community)
      communityNeighbors.get(edge.target)?.add(sourceNode.community)
    }
  }

  const STRUCTURAL_IDS = new Set(["index", "log", "overview"])

  const bridgeNodes = nodes
    .filter((n) => {
      if (STRUCTURAL_IDS.has(n.id)) return false
      const neighborComms = communityNeighbors.get(n.id)
      return neighborComms && neighborComms.size >= 3
    })
    .sort((a, b) => {
      const aComms = communityNeighbors.get(a.id)?.size ?? 0
      const bComms = communityNeighbors.get(b.id)?.size ?? 0
      return bComms - aComms
    })
    .slice(0, 3)

  for (const bridge of bridgeNodes) {
    const commCount = communityNeighbors.get(bridge.id)?.size ?? 0
    gaps.push({
      type: "bridge-node",
      title: `关键桥梁: ${bridge.label}`,
      description: `连接 ${commCount} 个不同的知识集群。这是您 wiki 中的关键节点。`,
      nodeIds: [bridge.id],
      suggestion: `此页面连接多个知识领域。确保其维护良好——如果内容单薄，扩展它将增强整个 wiki。`,
    })
  }

  return gaps.slice(0, limit)
}
