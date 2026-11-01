import * as React from "react";
import { cn } from "../lib/cn.js";
import { LibreHRMark } from "../icons/index.js";

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  isActive?: boolean;
  badge?: string | number;
}

export interface SidebarProps {
  items: NavItem[];
  currentPath?: string;
  orgName?: string;
  logo?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  items,
  currentPath,
  orgName = "LibreHR",
  logo,
  footer,
  className,
}) => {
  return (
    <aside
      className={cn(
        "hidden md:flex h-screen w-64 flex-col border-r border-border bg-surface",
        className,
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-border px-6">
        {logo ?? (
          <LibreHRMark size={32} className="text-primary flex-shrink-0" />
        )}
        <div className="flex flex-col overflow-hidden">
          <span className="truncate text-sm font-semibold text-foreground">
            {orgName}
          </span>
          <span className="text-xs text-muted-foreground">
            LibreHR Workspace
          </span>
        </div>
      </div>

      <nav
        className="flex-1 space-y-1 overflow-y-auto p-4"
        aria-label="Main Navigation"
      >
        {items.map((item) => {
          const active =
            item.isActive ?? (currentPath ? currentPath === item.href : false);
          return (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-input px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                active
                  ? "bg-accent text-primary font-semibold"
                  : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              <span className="truncate flex-1">{item.label}</span>
              {item.badge !== undefined && (
                <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary font-bold">
                  {item.badge}
                </span>
              )}
            </a>
          );
        })}
      </nav>

      {footer && <div className="border-t border-border p-4">{footer}</div>}
    </aside>
  );
};
