import * as React from "react";
import { cn } from "../lib/cn.js";

export interface PageHeaderProps {
  /** The page's `<h1>`. Text only: no icons in titles. */
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Page-level actions, right-aligned from `sm` up; the primary one last. */
  actions?: React.ReactNode;
  /**
   * Where this page sits, rendered above the title. A slot rather than an
   * href so the app can pass its own router link (`ui` doesn't import Next).
   */
  breadcrumb?: React.ReactNode;
  className?: string;
}

/**
 * The one page header (DESIGN.md §3): breadcrumb, title, description and
 * actions, with a single title style on every page.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  description,
  actions,
  breadcrumb,
  className,
}) => (
  <header
    className={cn(
      "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
      className,
    )}
  >
    <div className="min-w-0 space-y-1">
      {breadcrumb && <div className="mb-2 text-sm">{breadcrumb}</div>}
      <h1 className="text-2xl font-semibold tracking-tight text-foreground [overflow-wrap:anywhere]">
        {title}
      </h1>
      {description && (
        <p className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      )}
    </div>
    {actions && (
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {actions}
      </div>
    )}
  </header>
);
