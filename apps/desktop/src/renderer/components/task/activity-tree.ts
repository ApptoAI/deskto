import type { Activity } from "@deskto/protocol"

export type ActivityNode = {
  activity: Activity
  children: ActivityNode[]
}

export type ActivitySummary = {
  agents: ActivityNode[]
  plan: Activity | undefined
  working: number
}

/**
 * Nests every Activity under the one that spawned it. A parent outside the
 * list, a cycle, and a repeated identifier all resolve to a root rather than
 * to a dropped row: the tree is a view of what a Turn did, and losing work
 * from it reads as the agent never having done it.
 */
export function toActivityTree(
  activities: readonly Activity[]
): ActivityNode[] {
  const byId = new Map(activities.map((activity) => [activity.id, activity]))
  const childrenByParent = new Map<string, Activity[]>()
  for (const activity of activities) {
    const parentId = activity.parentActivityId
    if (!parentId || !byId.has(parentId)) continue
    const siblings = childrenByParent.get(parentId) ?? []
    siblings.push(activity)
    childrenByParent.set(parentId, siblings)
  }

  const claimed = new Set<string>()
  const build = (activity: Activity, ancestors: Set<string>): ActivityNode => {
    claimed.add(activity.id)
    const nextAncestors = new Set(ancestors).add(activity.id)
    const children = (childrenByParent.get(activity.id) ?? []).flatMap(
      (child) =>
        nextAncestors.has(child.id) || claimed.has(child.id)
          ? []
          : [build(child, nextAncestors)]
    )
    return { activity, children }
  }

  const roots: ActivityNode[] = []
  for (const activity of activities) {
    const parentId = activity.parentActivityId
    if (parentId && byId.has(parentId)) continue
    if (claimed.has(activity.id)) continue
    roots.push(build(activity, new Set()))
  }
  // A cycle claims nobody, so its members are still unplaced here. They come
  // back as roots in their original order instead of vanishing.
  for (const activity of activities) {
    if (claimed.has(activity.id)) continue
    roots.push(build(activity, new Set()))
  }
  return roots
}

/**
 * The outermost subagents, each with the work it ran. An agent that spawned
 * another is returned once, holding that one: a nested agent is its parent's
 * work, and listing it beside the parent would show the same run twice.
 */
export function subagentNodes(nodes: readonly ActivityNode[]): ActivityNode[] {
  return nodes.flatMap((node) =>
    node.activity.payload?.kind === "subagent"
      ? [node]
      : subagentNodes(node.children)
  )
}

export function isSubagentRunning(node: ActivityNode): boolean {
  return node.activity.status === "running"
}

/**
 * The plan the task itself is working to. Only the newest is shown: a plan is
 * a living document an agent rewrites, so older revisions are noise.
 *
 * Roots only. A subagent can write its own plan — Codex nests one under the
 * agent that made it — and that plan describes the subagent's errand, not the
 * task. It belongs with the agent, which is where the panel already draws it.
 */
export function newestPlan(
  nodes: readonly ActivityNode[]
): Activity | undefined {
  for (let index = nodes.length - 1; index >= 0; index--) {
    const activity = nodes[index]?.activity
    if (activity?.payload?.kind === "plan") return activity
  }
  return undefined
}

/** One derivation shared by the compact column and the full panel. */
export function summarizeActivities(
  activities: readonly Activity[]
): ActivitySummary {
  const tree = toActivityTree(activities)
  const agents = subagentNodes(tree)
  return {
    agents,
    plan: newestPlan(tree),
    working: agents.filter(isSubagentRunning).length,
  }
}

/** The end of an Activity, or the moment it started when it has not finished. */
export function activityEndedAt(activity: Activity): string {
  return activity.finishedAt ?? activity.createdAt
}
