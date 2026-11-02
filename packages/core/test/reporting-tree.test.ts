import { describe, it, expect } from "vitest";
import {
  hasReportingCycle,
  getReportIds,
  buildHierarchyTree,
  buildOrgChart,
  type ReportingNode,
  type FlatEmployeeOrgItem,
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

  it("builds an org chart with counts and recursive descendants", () => {
    const flatItems: FlatEmployeeOrgItem[] = [
      {
        id: "emp-1",
        name: "Director General",
        preferredName: null,
        email: "ceo@librehr.test",
        jobTitle: "CEO",
        departmentId: "d1",
        departmentName: "Exec",
        locationName: "Barcelona",
        managerId: null,
      },
      {
        id: "emp-2",
        name: "Cap d'Enginyeria",
        preferredName: null,
        email: "vp@librehr.test",
        jobTitle: "VP Eng",
        departmentId: "d2",
        departmentName: "Tech",
        locationName: "Barcelona",
        managerId: "emp-1",
      },
      {
        id: "emp-3",
        name: "Desenvolupadora Senior",
        preferredName: "Laia",
        email: "laia@librehr.test",
        jobTitle: "Senior Dev",
        departmentId: "d2",
        departmentName: "Tech",
        locationName: "Barcelona",
        managerId: "emp-2",
      },
    ];

    const chart = buildOrgChart(flatItems);
    expect(chart.totalEmployees).toBe(3);
    expect(chart.roots.length).toBe(1);

    const root = chart.roots[0]!;
    expect(root.id).toBe("emp-1");
    expect(root.directReportsCount).toBe(1);
    expect(root.totalTeamCount).toBe(2);

    const vp = root.directReports[0]!;
    expect(vp.id).toBe("emp-2");
    expect(vp.directReportsCount).toBe(1);
    expect(vp.totalTeamCount).toBe(1);

    const dev = vp.directReports[0]!;
    expect(dev.id).toBe("emp-3");
    expect(dev.directReportsCount).toBe(0);
    expect(dev.totalTeamCount).toBe(0);
  });
});
