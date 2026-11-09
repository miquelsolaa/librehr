import * as React from "react";
import { cn } from "../lib/cn.js";
import type { NavItem } from "./sidebar.js";

export interface BottomNavProps {
  items: NavItem[];
  overflowItems?: NavItem[];
  currentPath?: string;
  ariaLabel?: string;
  moreLabel?: string;
  /**
   * Content shown at the end of the "More" panel, below the overflow links
   * (for example a sign-out button). Its presence alone makes "More" appear.
   */
  overflowFooter?: React.ReactNode;
  className?: string;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  items,
  overflowItems = [],
  currentPath,
  ariaLabel = "Mobile Navigation",
  moreLabel = "More",
  overflowFooter,
  className,
}) => {
  const [open, setOpen] = React.useState(false);
  const moreRef = React.useRef<HTMLButtonElement>(null);
  const panelId = React.useId();
  const allItems = [...items, ...overflowItems];
  const hasOverflow = overflowItems.length > 0 || Boolean(overflowFooter);
  const activeHref = currentPath
    ? allItems
        .filter(
          (item) =>
            currentPath === item.href ||
            currentPath.startsWith(`${item.href}/`),
        )
        .sort((a, b) => b.href.length - a.href.length)[0]?.href
    : undefined;

  return (
    <nav
      aria-label={ariaLabel}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          setOpen(false);
          moreRef.current?.focus();
        }
      }}
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 flex min-h-16 items-center justify-around border-t border-border bg-surface-raised px-1 pb-[env(safe-area-inset-bottom)] md:hidden",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.isActive ?? activeHref === item.href;
        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-[48px] min-w-[48px] flex-1 flex-col items-center justify-center gap-1 rounded-input px-1 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
              active
                ? "text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <span className="shrink-0">{item.icon}</span>
            <span className="max-w-full truncate text-[10px]">
              {item.label}
            </span>
          </a>
        );
      })}
      {hasOverflow && (
        <>
          {open && (
            <div
              id={panelId}
              className="absolute bottom-full right-2 mb-2 max-h-[60vh] w-56 overflow-y-auto rounded-card border border-border bg-surface-raised p-2 shadow-lg"
            >
              {overflowItems.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  aria-current={activeHref === item.href ? "page" : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex min-h-[44px] items-center gap-3 rounded-input px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring",
                    activeHref === item.href
                      ? "bg-accent text-primary"
                      : "text-foreground hover:bg-accent",
                  )}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </a>
              ))}
              {overflowFooter && (
                <div
                  className={cn(
                    overflowItems.length > 0 &&
                      "mt-1 border-t border-border pt-1",
                  )}
                >
                  {overflowFooter}
                </div>
              )}
            </div>
          )}
          <button
            ref={moreRef}
            type="button"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-[48px] min-w-[48px] flex-1 flex-col items-center justify-center gap-1 rounded-input px-1 py-1 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <span aria-hidden="true" className="text-lg leading-4">
              ⋯
            </span>
            <span className="text-[10px]">{moreLabel}</span>
          </button>
        </>
      )}
    </nav>
  );
};
