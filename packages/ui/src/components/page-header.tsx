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
      // Actions drop under the title when both do not fit: never squeeze it.
      "flex flex-wrap items-end justify-between gap-4",
      className,
    )}
  >
    <div className="min-w-0 max-w-full flex-1 basis-80 space-y-1">
      {breadcrumb && <div className="mb-2 text-sm">{breadcrumb}</div>}
      <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl [overflow-wrap:anywhere]">
        {title}
      </h1>
      {description && (
        <p className="max-w-prose text-sm text-muted-foreground">
          {description}
        </p>
      )}
    </div>
    {actions && (
      <div className="flex max-w-full flex-wrap items-center gap-2">
        {actions}
      </div>
    )}
  </header>
);
