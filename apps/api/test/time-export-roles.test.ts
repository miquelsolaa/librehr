import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS } from "@librehr/contracts";
import {
  ORG_WIDE_EXPORT_ROLES,
  mayExportOrganization,
} from "@librehr/time-export";

// TIM-006 (#38): the worker re-checks the requester's role before building a
// background export. It cannot import contracts, so the role list lives in
// @librehr/time-export and must match the permission map.
describe("ORG_WIDE_EXPORT_ROLES", () => {
  it("lists exactly the roles with organization-wide time.record.read", () => {
    const expected = Object.entries(ROLE_PERMISSIONS)
      .filter(([, permissions]) =>
        permissions.some(
          (p) =>
            p.permission === "time.record.read" && p.scope === "organization",
        ),
      )
      .map(([role]) => role)
      .sort();
    expect([...ORG_WIDE_EXPORT_ROLES].sort()).toEqual(expected);
  });

  it("refuses narrower and unknown roles", () => {
    expect(mayExportOrganization("admin")).toBe(true);
    expect(mayExportOrganization("manager")).toBe(false);
    expect(mayExportOrganization("employee")).toBe(false);
    expect(mayExportOrganization("")).toBe(false);
  });
});
