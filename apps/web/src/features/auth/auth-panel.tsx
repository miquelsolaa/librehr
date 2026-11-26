import * as React from "react";
import { LibreHRMark } from "@librehr/ui";

/** Centred single-column frame for the signed-out account pages (AUTH-001). */
export function AuthPanel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | undefined;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen items-center bg-background px-4 py-12 sm:px-10">
      <div className="mx-auto w-full max-w-sm space-y-8">
        <div>
          <LibreHRMark size={40} aria-hidden="true" className="text-primary" />
          <h1 className="mt-6 font-display text-3xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-2 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
        {children}
      </div>
    </main>
  );
}

/** Status message under a form; errors are announced as alerts. */
export function AuthNotice({
  tone,
  children,
}: {
  tone: "error" | "success";
  children: React.ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={
        tone === "error"
          ? "rounded-input border border-danger/30 bg-danger/10 p-3 text-sm text-danger"
          : "rounded-input border border-primary/30 bg-primary/10 p-3 text-sm text-foreground"
      }
    >
      {children}
    </div>
  );
}
