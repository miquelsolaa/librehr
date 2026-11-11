import * as React from "react";
import { cn } from "../lib/cn.js";
import { LibreHRMark } from "../icons/index.js";

export interface NavItem {
  href: string;
  label: string;
  /** One-word label for the mobile bottom bar, where `label` won't fit. */
  shortLabel?: string;
  icon: React.ReactNode;
  isActive?: boolean;
  badge?: string | number;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface SidebarProps {
  /** A single ungrouped list. Ignored when `groups` is given. */
  items?: NavItem[];
  /** Labelled sections; labels show only when there is more than one group. */
  groups?: NavGroup[];
  currentPath?: string;
  orgName?: string;
  logo?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  ariaLabel?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  items = [],
  groups,
  currentPath,
  orgName = "LibreHR",
  logo,
  footer,
  className,
  ariaLabel = "Main Navigation",
}) => {
  const groupId = React.useId();
  const sections = (groups ?? [{ label: "", items }]).filter(
    (group) => group.items.length > 0,
  );
  const showLabels = sections.length > 1;
  const activeHref = currentPath
    ? sections
        .flatMap((group) => group.items)
        .filter(
          (item) =>
            currentPath === item.href ||
            currentPath.startsWith(`${item.href}/`),
        )
        .sort((a, b) => b.href.length - a.href.length)[0]?.href
    : undefined;
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-surface md:flex",
        className,
      )}
    >
      <div className="flex h-16 items-center gap-3 border-b border-border px-6">
        {logo ?? (
          <LibreHRMark size={32} className="text-primary flex-shrink-0" />
        )}
        <span className="truncate text-sm font-semibold text-foreground">
          {orgName}
        </span>
      </div>

      <nav
        className="flex-1 space-y-6 overflow-y-auto p-4"
        aria-label={ariaLabel}
      >
        {sections.map((group, index) => {
          const labelId = `${groupId}-${index}`;
          return (
            <div key={index}>
              {showLabels && (
                <p
                  id={labelId}
                  className="mb-2 px-3 text-xs font-medium text-muted-foreground"
                >
                  {group.label}
                </p>
              )}
              <ul
                className="space-y-1"
                aria-labelledby={showLabels ? labelId : undefined}
              >
                {group.items.map((item) => {
                  const active = item.isActive ?? activeHref === item.href;
                  return (
                    <li key={item.href}>
                      <a
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "relative flex items-center gap-3 rounded-input px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                          active
                            ? // A bar on the leading edge marks the page without relying on colour alone.
                              "bg-accent text-primary before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-primary"
                            : "text-muted-foreground hover:bg-surface-raised hover:text-foreground",
                        )}
                      >
                        <span className="shrink-0">{item.icon}</span>
                        <span className="truncate flex-1">{item.label}</span>
                        {item.badge !== undefined && (
                          <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary tabular-nums">
                            {item.badge}
                          </span>
                        )}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      {footer && <div className="border-t border-border p-4">{footer}</div>}
    </aside>
  );
};
