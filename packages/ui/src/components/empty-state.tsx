import * as React from "react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import { DayRing } from "./day-ring.js";

export interface EmptyStateProps {
  /** Replaces the empty ring. Keep it to one plain icon. */
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

/**
 * Nothing here yet (DESIGN.md §4). Reads like the rest of the page, set to
 * the left under the brand ring with no arc: say what will appear and offer
 * the one action that starts it.
 */
export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-4 rounded-card border border-border bg-surface p-6 sm:flex-row sm:items-center sm:gap-6 sm:p-8",
        className,
      )}
    >
      <div aria-hidden="true" className="shrink-0 text-muted-foreground">
        {icon ?? <DayRing size={56} />}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      </div>
      {actionLabel && onAction && (
        <Button onClick={onAction} className="shrink-0">
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
