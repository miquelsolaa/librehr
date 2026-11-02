export interface ReportingNode {
  id: string;
  managerId?: string | null;
}

export interface HierarchyTreeNode<T extends ReportingNode> {
  item: T;
  directReports: HierarchyTreeNode<T>[];
}

/**
 * Checks whether assigning proposedManagerId as the manager of employeeId
 * would create a circular reference in the organizational hierarchy.
 */
export function hasReportingCycle(
  nodes: readonly ReportingNode[],
  employeeId: string,
  proposedManagerId: string | null | undefined,
): boolean {
  if (!proposedManagerId) {
    return false;
  }

  // An employee cannot be their own manager
  if (employeeId === proposedManagerId) {
    return true;
  }

  // Fast lookup by id -> managerId
  const managerMap = new Map<string, string | null | undefined>();
  for (const node of nodes) {
    managerMap.set(node.id, node.managerId);
  }

  // Walk up the management chain starting from the proposed manager
  let currentId: string | null | undefined = proposedManagerId;
  const visited = new Set<string>();

  while (currentId) {
    if (currentId === employeeId) {
      // Reached the employee whose manager we're setting: cycle detected!
      return true;
    }
    if (visited.has(currentId)) {
      // Loop already existed in data
      return true;
    }
    visited.add(currentId);
    currentId = managerMap.get(currentId);
  }

  return false;
}

/**
 * Returns all employee IDs who report to the given managerId.
 * If includeIndirect is true, traverses recursively down all levels.
 */
export function getReportIds(
  nodes: readonly ReportingNode[],
  managerId: string,
  includeIndirect = true,
): string[] {
  // Map managerId -> direct report IDs
  const directReportsMap = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.managerId) {
      const existing = directReportsMap.get(node.managerId);
      if (existing) {
        existing.push(node.id);
      } else {
        directReportsMap.set(node.managerId, [node.id]);
      }
    }
  }

  const direct = directReportsMap.get(managerId) ?? [];
  if (!includeIndirect) {
    return direct;
  }

  const allReports: string[] = [];
  const queue = [...direct];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nextId = queue.shift();
    if (!nextId || visited.has(nextId)) continue;
    visited.add(nextId);
    allReports.push(nextId);

    const subReports = directReportsMap.get(nextId);
    if (subReports) {
      queue.push(...subReports);
    }
  }

  return allReports;
}

/**
 * Builds a hierarchical tree structure from a flat array of reporting nodes.
 */
export function buildHierarchyTree<T extends ReportingNode>(
  items: readonly T[],
): HierarchyTreeNode<T>[] {
  const nodeMap = new Map<string, HierarchyTreeNode<T>>();
  const rootNodes: HierarchyTreeNode<T>[] = [];

  for (const item of items) {
    nodeMap.set(item.id, { item, directReports: [] });
  }

  for (const item of items) {
    const currentTreeNode = nodeMap.get(item.id)!;
    if (item.managerId && nodeMap.has(item.managerId)) {
      const parentNode = nodeMap.get(item.managerId)!;
      parentNode.directReports.push(currentTreeNode);
    } else {
      rootNodes.push(currentTreeNode);
    }
  }

  return rootNodes;
}

export interface FlatEmployeeOrgItem {
  id: string;
  name: string;
  preferredName: string | null;
  email: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  locationName: string | null;
  managerId: string | null;
}

export interface OrgChartNode {
  id: string;
  name: string;
  preferredName: string | null;
  email: string;
  jobTitle: string | null;
  departmentId: string | null;
  departmentName: string | null;
  locationName: string | null;
  managerId: string | null;
  directReportsCount: number;
  totalTeamCount: number;
  directReports: OrgChartNode[];
}

export function buildOrgChart(items: readonly FlatEmployeeOrgItem[]): {
  roots: OrgChartNode[];
  totalEmployees: number;
} {
  const nodeMap = new Map<string, OrgChartNode>();
  const childrenMap = new Map<string, string[]>();

  for (const item of items) {
    nodeMap.set(item.id, {
      ...item,
      directReportsCount: 0,
      totalTeamCount: 0,
      directReports: [],
    });
    if (item.managerId) {
      const arr = childrenMap.get(item.managerId) ?? [];
      arr.push(item.id);
      childrenMap.set(item.managerId, arr);
    }
  }

  const roots: OrgChartNode[] = [];

  for (const item of items) {
    const node = nodeMap.get(item.id)!;
    if (!item.managerId || !nodeMap.has(item.managerId)) {
      roots.push(node);
    }
  }

  function populateNode(node: OrgChartNode, visited: Set<string>): number {
    if (visited.has(node.id)) return 0;
    visited.add(node.id);

    const childIds = childrenMap.get(node.id) ?? [];
    node.directReportsCount = childIds.length;
    let totalDescendants = 0;

    for (const childId of childIds) {
      const childNode = nodeMap.get(childId);
      if (childNode) {
        node.directReports.push(childNode);
        const subCount = populateNode(childNode, visited);
        totalDescendants += 1 + subCount;
      }
    }

    node.totalTeamCount = totalDescendants;
    return totalDescendants;
  }

  const globalVisited = new Set<string>();
  for (const root of roots) {
    populateNode(root, globalVisited);
  }

  return {
    roots,
    totalEmployees: items.length,
  };
}
