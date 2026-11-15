import * as React from "react";

/** One kind of pending item (time off, time corrections) with its count. */
export function ApprovalsSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const id = React.useId();
  if (count === 0) return null;
  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-base font-semibold text-foreground">
        {title}{" "}
        <span className="text-muted-foreground tabular-nums">({count})</span>
      </h2>
      <ul className="divide-y divide-border rounded-card border border-border bg-surface-raised">
        {children}
      </ul>
    </section>
  );
}

/** A pending item: who, the details, and the decision buttons. */
export function ApprovalRow({
  title,
  actions,
  children,
}: {
  title: string;
  actions: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-1 text-sm">
        <p className="font-medium text-foreground">{title}</p>
        {children}
      </div>
      {actions}
    </li>
  );
}
