import * as React from "react";
import {
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Info,
  X,
} from "lucide-react";
import { cn } from "../lib/cn.js";

export interface ToastProps {
  id?: string;
  variant?: "success" | "warning" | "danger" | "info";
  title?: string;
  description?: string;
  onDismiss?: () => void;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  variant = "info",
  title,
  description,
  onDismiss,
  className,
}) => {
  const icons = {
    success: <CheckCircle2 className="h-5 w-5 text-success shrink-0" />,
    warning: <AlertTriangle className="h-5 w-5 text-warning shrink-0" />,
    danger: <AlertCircle className="h-5 w-5 text-danger shrink-0" />,
    info: <Info className="h-5 w-5 text-info shrink-0" />,
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full max-w-sm items-start gap-3 rounded-card border border-border bg-surface-raised p-4 shadow-md transition-all",
        className,
      )}
    >
      {icons[variant]}
      <div className="flex-1 space-y-1">
        {title && (
          <p className="text-sm font-medium text-foreground">{title}</p>
        )}
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="rounded p-1 text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
};
