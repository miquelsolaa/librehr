import * as React from "react";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  XCircle,
  CalendarOff,
  MinusCircle,
} from "lucide-react";
import { cn } from "../lib/cn.js";

export type StatusPillType =
  | "approved"
  | "pending"
  | "rejected"
  | "overdue"
  | "draft"
  | "active"
  /** Temporarily not at work (on leave). Not a warning: nothing is owed. */
  | "away"
  /** No longer current (a past employee, a closed record). Not an error. */
  | "inactive";

export interface StatusPillProps {
  status: StatusPillType;
  label?: string;
  className?: string;
}

export const StatusPill: React.FC<StatusPillProps> = ({
  status,
  label,
  className,
}) => {
  const configs: Record<
    StatusPillType,
    { icon: React.ReactNode; style: string; defaultLabel: string }
  > = {
    approved: {
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />,
      style: "bg-success/15 text-success border-success/30",
      defaultLabel: "Approved",
    },
    active: {
      icon: <CheckCircle2 className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />,
      style: "bg-success/15 text-success border-success/30",
      defaultLabel: "Active",
    },
    pending: {
      icon: <Clock className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />,
      style: "bg-warning/15 text-warning border-warning/30",
      defaultLabel: "Pending",
    },
    rejected: {
      icon: <XCircle className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />,
      style: "bg-danger/15 text-danger border-danger/30",
      defaultLabel: "Rejected",
    },
    overdue: {
      icon: <AlertCircle className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />,
      style: "bg-danger/15 text-danger border-danger/30",
      defaultLabel: "Overdue",
    },
    away: {
      icon: <CalendarOff className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />,
      style: "bg-info/10 text-info border-info/30",
      defaultLabel: "Away",
    },
    inactive: {
      icon: <MinusCircle className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />,
      style: "bg-surface text-muted-foreground border-border",
      defaultLabel: "Inactive",
    },
    draft: {
      icon: <Clock className="h-3.5 w-3.5 shrink-0 stroke-[2.2]" />,
      style: "bg-surface text-muted-foreground border-border",
      defaultLabel: "Draft",
    },
  };

  const config = configs[status];
  const displayLabel = label ?? config.defaultLabel;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        config.style,
        className,
      )}
    >
      {config.icon}
      <span>{displayLabel}</span>
    </span>
  );
};
