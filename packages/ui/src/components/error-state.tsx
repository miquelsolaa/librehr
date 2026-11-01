import * as React from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";

export interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  supportHint?: string;
  className?: string;
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = "Something went wrong",
  description = "An error occurred while loading this data. Please try again.",
  onRetry,
  retryLabel = "Try again",
  supportHint,
  className,
}) => {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-[260px] flex-col items-center justify-center rounded-card border border-danger/20 bg-danger/5 p-8 text-center",
        className,
      )}
    >
      <div className="mb-4 rounded-full bg-danger/15 p-3 text-danger">
        <AlertCircle className="h-6 w-6 stroke-[1.75]" />
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
        {description}
      </p>
      {supportHint && (
        <p className="mt-1 text-xs text-muted-foreground/80">{supportHint}</p>
      )}
      {onRetry && (
        <div className="mt-6">
          <Button variant="secondary" onClick={onRetry}>
            {retryLabel}
          </Button>
        </div>
      )}
    </div>
  );
};
