import * as React from "react";
import { cn } from "../lib/cn.js";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?:
    | "default"
    | "secondary"
    | "outline"
    | "success"
    | "warning"
    | "danger"
    | "info";
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  variant = "default",
  ...props
}) => {
  const variantStyles = {
    default: "bg-primary text-primary-foreground",
    secondary: "bg-surface text-muted-foreground border border-border",
    outline: "text-foreground border border-border",
    success: "bg-success/15 text-success border border-success/30",
    warning: "bg-warning/15 text-warning border border-warning/30",
    danger: "bg-danger/15 text-danger border border-danger/30",
    info: "bg-info/15 text-info border border-info/30",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-focus-ring",
        variantStyles[variant],
        className,
      )}
      {...props}
    />
  );
};
