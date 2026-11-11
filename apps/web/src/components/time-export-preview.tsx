"use client";

import { useTranslations } from "next-intl";
import type { OfficialExportResponse } from "@librehr/contracts";
import { Badge } from "@librehr/ui";

/** Index of the date cell, where a day outside employment is badged. */
const DATE_CELL = 1;

/**
 * TIM-006: on-screen preview of the official export. The header lines and
 * cells come from the API already in the document's language, so the
 * preview shows exactly what the CSV and PDF contain. A day outside the
 * employee's employment (TIM-006) is dimmed and badged next to its date,
 * so it is not read as an absence. The badge repeats the document's own
 * "Employed" header and cell (the last column), so it is in the document's
 * language like everything else in the table.
 */
export function TimeExportPreview({ doc }: { doc: OfficialExportResponse }) {
  const t = useTranslations("timeTracking");
  const employedColumn = doc.columns.length - 1;
  const employedLabel = doc.columns[employedColumn] ?? "";
  return (
    <section
      aria-labelledby="export-preview-title"
      className="space-y-4 rounded-lg border border-border p-4"
    >
      <h2
        id="export-preview-title"
        className="text-base font-semibold text-foreground"
      >
        {doc.organizationName}
      </h2>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {doc.metadataLines.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      {doc.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("exportNoRows")}</p>
      ) : (
        // Focusable so keyboard users can scroll the wide table on phones.
        <div
          className="overflow-x-auto"
          tabIndex={0}
          role="region"
          aria-label={t("exportTableLabel")}
        >
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{t("exportTableLabel")}</caption>
            <thead>
              <tr className="border-b border-border font-semibold text-muted-foreground">
                {doc.columns.map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="whitespace-nowrap py-2 pr-3"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {doc.rows.map((cells, rowIndex) => {
                const notEmployed = doc.rowsEmployed[rowIndex] === false;
                return (
                  <tr
                    key={rowIndex}
                    className={
                      notEmployed ? "text-muted-foreground" : undefined
                    }
                  >
                    {cells.map((cell, cellIndex) => (
                      <td
                        key={cellIndex}
                        className="whitespace-nowrap py-2 pr-3"
                      >
                        {cell}
                        {notEmployed && cellIndex === DATE_CELL ? (
                          <Badge variant="secondary" className="ml-2">
                            {`${employedLabel}: ${cells[employedColumn] ?? ""}`}
                          </Badge>
                        ) : null}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
