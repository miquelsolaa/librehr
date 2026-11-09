import * as React from "react";
import { cn } from "../lib/cn.js";
import { useUiStrings } from "./ui-strings.js";

export interface TopbarProps {
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
  userMenu?: React.ReactNode;
  orgSwitcher?: React.ReactNode;
  className?: string;
}

export const Topbar: React.FC<TopbarProps> = ({
  breadcrumbs,
  actions,
  userMenu,
  orgSwitcher,
  className,
}) => {
  const strings = useUiStrings();
  return (
    <header
      className={cn(
        "flex h-16 w-full items-center justify-between border-b border-border bg-background px-4 md:px-6",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        {orgSwitcher}
        {breadcrumbs && (
          <nav aria-label={strings.breadcrumb} className="text-sm">
            {breadcrumbs}
          </nav>
        )}
      </div>

      <div className="flex items-center gap-3">
        {actions}
        {userMenu}
      </div>
    </header>
  );
};
