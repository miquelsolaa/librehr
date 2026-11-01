import * as React from "react";
import { cn } from "../lib/cn.js";
import type { NavItem } from "./sidebar.js";

export interface BottomNavProps {
  items: NavItem[];
  currentPath?: string;
  className?: string;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  items,
  currentPath,
  className,
}) => {
  return (
    <nav
      aria-label="Mobile Navigation"
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-border bg-surface-raised px-2 md:hidden",
        className,
      )}
    >
      {items.map((item) => {
        const active =
          item.isActive ?? (currentPath ? currentPath === item.href : false);
        return (
          <a
            key={item.href}
            href={item.href}
            className={cn(
              "flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-1 rounded-input px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
              active
                ? "text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="truncate max-w-[60px] text-[10px]">
              {item.label}
            </span>
          </a>
        );
      })}
    </nav>
  );
};
