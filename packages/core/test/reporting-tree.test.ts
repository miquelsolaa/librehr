import { describe, it, expect } from "vitest";
import {
  hasReportingCycle,
  getReportIds,
  buildHierarchyTree,
  type ReportingNode,
} from "../src/org/reporting-tree.js";

describe("Reporting Hierarchy Tree", () => {
  const orgHierarchy: ReportingNode[] = [
    { id: "ceo", managerId: null },
    { id: "vp_eng", managerId: "ceo" },
    { id: "vp_ops", managerId: "ceo" },
    { id: "lead_dev", managerId: "vp_eng" },
    { id: "dev_1", managerId: "lead_dev" },
    { id: "dev_2", managerId: "lead_dev" },
  ];

  it("detects cycle when employee is assigned to themselves", () => {
    expect(hasReportingCycle(orgHierarchy, "dev_1", "dev_1")).toBe(true);
  });

  it("detects direct cycle (A -> B -> A)", () => {
    // If we try to make vp_eng report to lead_dev:
    // vp_eng -> lead_dev -> vp_eng (cycle!)
    expect(hasReportingCycle(orgHierarchy, "vp_eng", "lead_dev")).toBe(true);
  });

  it("detects deep transitive cycle (A -> B -> C -> D -> A)", () => {
    // If ceo reports to dev_1:
    // ceo -> dev_1 -> lead_dev -> vp_eng -> ceo (cycle!)
    expect(hasReportingCycle(orgHierarchy, "ceo", "dev_1")).toBe(true);
  });

  it("allows valid hierarchy changes without cycles", () => {
    // Moving dev_1 to report directly to vp_eng is valid
    expect(hasReportingCycle(orgHierarchy, "dev_1", "vp_eng")).toBe(false);
    // Setting manager to null (top level) is always valid
    expect(hasReportingCycle(orgHierarchy, "vp_eng", null)).toBe(false);
  });

  it("retrieves direct reports", () => {
    const directToLead = getReportIds(orgHierarchy, "lead_dev", false);
    expect(directToLead).toEqual(["dev_1", "dev_2"]);

    const directToCeo = getReportIds(orgHierarchy, "ceo", false);
    expect(directToCeo).toEqual(["vp_eng", "vp_ops"]);
  });

  it("retrieves all recursive nested reports", () => {
    const allUnderVp = getReportIds(orgHierarchy, "vp_eng", true);
    expect(allUnderVp.sort()).toEqual(["dev_1", "dev_2", "lead_dev"].sort());

    const allUnderCeo = getReportIds(orgHierarchy, "ceo", true);
    expect(allUnderCeo.sort()).toEqual(
      ["vp_eng", "vp_ops", "lead_dev", "dev_1", "dev_2"].sort(),
    );
  });

  it("builds a hierarchical tree from flat nodes", () => {
    const tree = buildHierarchyTree(orgHierarchy);
    expect(tree.length).toBe(1);
    expect(tree[0]?.item.id).toBe("ceo");
    expect(tree[0]?.directReports.length).toBe(2);
  });
});
