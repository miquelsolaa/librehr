"use client";

import { useTranslations } from "next-intl";
import type { HeadcountReportResponse } from "@librehr/contracts";

const TYPE_LABELS = {
  department: "typeDepartment",
  project: "typeProject",
  area: "typeArea",
} as const;

interface HeadcountBreakdownProps {
  breakdown: NonNullable<HeadcountReportResponse["breakdown"]>;
}

/** ORG-007: headcount and FTE per department or group on the period end. */
export function HeadcountBreakdown({ breakdown }: HeadcountBreakdownProps) {
  const t = useTranslations("reports");
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-foreground">
        {t("breakdownTitle", { date: breakdown.asOf })}
      </h3>
      {breakdown.totalsOverlap && (
        <p className="text-sm text-muted-foreground">{t("breakdownOverlap")}</p>
      )}
      {breakdown.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("breakdownEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th scope="col" className="p-2 font-medium">
                  {t("breakdownName")}
                </th>
                <th scope="col" className="p-2 font-medium">
                  {t("breakdownType")}
                </th>
                <th scope="col" className="p-2 text-right font-medium">
                  {t("breakdownHeadcount")}
                </th>
                <th scope="col" className="p-2 text-right font-medium">
                  {t("breakdownFte")}
                </th>
              </tr>
            </thead>
            <tbody>
              {breakdown.rows.map((row) => (
                <tr
                  key={`${row.type}:${row.id}`}
                  className="border-t border-border"
                >
                  <td className="p-2">{row.name}</td>
                  <td className="p-2">{t(TYPE_LABELS[row.type])}</td>
                  <td className="p-2 text-right">{row.headcount}</td>
                  <td className="p-2 text-right">{row.fte}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
