"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { OrgChartNode } from "@librehr/contracts";

interface OrgChartDottedLinesProps {
  memberships: OrgChartNode["secondaryMemberships"];
  nodeId: string;
  locale: string;
}

/**
 * ORG-007: an org chart node's secondary memberships, drawn as dashed
 * "dotted-line" entries that link to the lead of each department or group.
 */
export function OrgChartDottedLines({
  memberships,
  nodeId,
  locale,
}: OrgChartDottedLinesProps) {
  const t = useTranslations("people");
  if (memberships.length === 0) return null;
  return (
    <ul
      aria-label={t("dottedLines")}
      className="mt-2 space-y-1 text-xs text-muted-foreground"
    >
      {memberships.map((m) => (
        <li
          key={`${m.type}:${m.id}`}
          className="rounded-sm border border-dashed border-border px-1.5 py-0.5"
        >
          <span>
            {m.allocationPercent === null
              ? m.name
              : t("membershipWithAllocation", {
                  name: m.name,
                  percent: m.allocationPercent,
                })}
          </span>
          {m.leadEmployeeId && m.leadName && m.leadEmployeeId !== nodeId && (
            <Link
              href={`/${locale}/people/${m.leadEmployeeId}`}
              className="block underline hover:text-primary"
            >
              {t("dottedLineLead", { name: m.leadName })}
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
