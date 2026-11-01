import * as React from "react";
import { cn } from "../lib/cn.js";

export interface Column<T> {
  id: string;
  header: string;
  cell: (item: T) => React.ReactNode;
  align?: "left" | "center" | "right";
  isNumeric?: boolean;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  emptyMessage?: string;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  emptyMessage = "No records found.",
  className,
}: DataTableProps<T>) {
  return (
    <div
      className={cn(
        "w-full overflow-auto rounded-card border border-border bg-surface",
        className,
      )}
    >
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border bg-surface-raised text-xs font-semibold uppercase text-muted-foreground">
          <tr>
            {columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                className={cn(
                  "px-4 py-3",
                  col.align === "right" || col.isNumeric
                    ? "text-right"
                    : col.align === "center"
                      ? "text-center"
                      : "text-left",
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((item) => (
              <tr
                key={keyExtractor(item)}
                className="transition-colors hover:bg-accent/40"
              >
                {columns.map((col) => (
                  <td
                    key={col.id}
                    className={cn(
                      "px-4 py-3 text-foreground",
                      col.isNumeric && "font-mono tabular-nums",
                      col.align === "right" || col.isNumeric
                        ? "text-right"
                        : col.align === "center"
                          ? "text-center"
                          : "text-left",
                    )}
                  >
                    {col.cell(item)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
