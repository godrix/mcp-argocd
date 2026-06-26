export interface ResourceTreeNode {
  kind?: string;
  name?: string;
  namespace?: string;
  health?: { status?: string };
  status?: string;
}

export interface ResourceTreeResponse {
  nodes?: ResourceTreeNode[];
}

export interface UnhealthyResource {
  kind: string;
  name: string;
  namespace?: string;
  health?: string;
}

export function findUnhealthyResources(
  tree: ResourceTreeResponse
): UnhealthyResource[] {
  return (tree.nodes ?? [])
    .filter((node) => {
      const health = node.health?.status?.toLowerCase();
      return health && health !== "healthy" && health !== "suspended";
    })
    .map((node) => ({
      kind: node.kind ?? "Unknown",
      name: node.name ?? "unknown",
      namespace: node.namespace,
      health: node.health?.status,
    }));
}
