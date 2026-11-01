import * as React from "react";
import { FolderOpen } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

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
        "flex min-h-[280px] flex-col items-center justify-center rounded-card border border-dashed border-border bg-surface/50 p-8 text-center animate-in fade-in-50",
        className,
      )}
    >
      <div className="mb-4 rounded-full bg-accent p-3 text-primary">
        {icon ?? <FolderOpen className="h-6 w-6 stroke-[1.75]" />}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {actionLabel && onAction && (
        <div className="mt-6">
          <Button onClick={onAction}>{actionLabel}</Button>
        </div>
      )}
    </div>
  );
};
