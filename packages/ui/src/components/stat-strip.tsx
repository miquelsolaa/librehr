import * as React from "react";
import { cn } from "../lib/cn.js";

export interface StatStripItem {
  label: string;
  value: React.ReactNode;
  /** Context for the figure: what it is measured against, or a count. */
  hint?: React.ReactNode;
  /** For a value that is a name, not a figure: set in text size. */
  text?: boolean;
}

export interface StatStripProps extends React.HTMLAttributes<HTMLDListElement> {
  /** The first item leads: it is set larger and on the accent surface. */
  items: readonly StatStripItem[];
}

/**
 * A period's figures as one strip, led by the figure that matters most
 * (DESIGN.md §4). Use it instead of a row of identical cards: the strip says
 * which number to read first and keeps the others as its context.
 *
 * @example
 * <StatStrip items={[
 *   { label: "Worked", value: "142h 30m", hint: "Expected: 160h" },
 *   { label: "Breaks", value: "11h 05m" },
 * ]} />
 */
export const StatStrip = React.forwardRef<HTMLDListElement, StatStripProps>(
  ({ items, className, ...props }, ref) => (
    <dl
      ref={ref}
      className={cn(
        "grid divide-y divide-border overflow-hidden rounded-card border border-border bg-surface sm:auto-cols-fr sm:grid-flow-col sm:divide-x sm:divide-y-0",
        className,
      )}
      {...props}
    >
      {items.map((item, index) => {
        const lead = index === 0;
        return (
          <div
            key={item.label}
            className={cn(
              "min-w-0 px-5 py-4",
              lead && "bg-accent sm:col-span-2 sm:px-6 sm:py-5",
            )}
          >
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd
              className={cn(
                "mt-1 font-semibold text-foreground",
                item.text
                  ? "truncate text-base"
                  : "font-display tabular-nums tracking-tight",
                !item.text && (lead ? "text-4xl" : "text-2xl"),
              )}
            >
              {item.value}
            </dd>
            {item.hint && (
              <dd className="mt-1 text-xs text-muted-foreground">
                {item.hint}
              </dd>
            )}
          </div>
        );
      })}
    </dl>
  ),
);
StatStrip.displayName = "StatStrip";
