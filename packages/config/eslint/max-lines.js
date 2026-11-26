// File-size guard for AGENTS.md section 4 ("keep files under ~300 lines").
//
// Review alone did not hold the line, so `max-lines` is an error for source
// files. Files that were already over the limit when the rule landed are
// listed in `MAX_LINES_ALLOWLIST` and exempt. The list is a ratchet: it only
// shrinks. When you split a listed file below the limit, delete its entry in
// the same PR and lower the ceiling in test/max-lines.test.ts. Never add a
// new entry; split the file instead (issue #37).
//
// Tests, e2e specs, seeds, generated code and migrations are out of scope:
// their length follows the data or the cases they cover.

export const MAX_LINES = 300;

/**
 * Source files over the limit when the rule landed, as plain repo-relative
 * paths. Only remove entries.
 */
export const MAX_LINES_ALLOWLIST = [
  "apps/api/src/app.ts",
  "apps/api/src/env.ts",
  "apps/api/src/routes/auth.ts",
  "apps/api/src/routes/documents.ts",
  "apps/api/src/routes/employees.ts",
  "apps/api/src/routes/invitations.ts",
  "apps/api/src/routes/leave.ts",
  "apps/api/src/routes/shifts.ts",
  "apps/api/src/routes/time-closures.ts",
  "apps/api/src/routes/time.ts",
  "apps/api/src/routes/webhooks.ts",
  "apps/web/src/app/[locale]/(app)/approvals/page.tsx",
  "apps/web/src/app/[locale]/(app)/documents/page.tsx",
  "apps/web/src/app/[locale]/(app)/onboarding/page.tsx",
  "apps/web/src/app/[locale]/(app)/people/[id]/page.tsx",
  "apps/web/src/app/[locale]/(app)/people/page.tsx",
  "apps/web/src/app/[locale]/(app)/settings/custom-fields/page.tsx",
  "apps/web/src/app/[locale]/(app)/settings/locations/page.tsx",
  "apps/web/src/app/[locale]/(app)/settings/security/page.tsx",
  "apps/web/src/app/[locale]/(app)/settings/sso/page.tsx",
  "apps/web/src/app/[locale]/(app)/settings/tokens/page.tsx",
  "apps/web/src/app/[locale]/(app)/settings/webhooks/page.tsx",
  "apps/web/src/app/[locale]/(app)/time-off/page.tsx",
  "apps/web/src/app/[locale]/(app)/time/page.tsx",
  "apps/web/src/app/[locale]/(app)/time/shifts/page.tsx",
  "apps/web/src/app/[locale]/(auth)/setup/page.tsx",
  "apps/web/src/app/[locale]/(auth)/sign-in/page.tsx",
  "packages/contracts/scripts/generate-openapi.ts",
  "packages/core/src/calendar/statutory-holidays.ts",
  "packages/db/src/repositories/document.repository.ts",
  "packages/db/src/repositories/employee.repository.ts",
  "packages/db/src/repositories/leave.repository.ts",
  "packages/db/src/repositories/shift.repository.ts",
  "packages/db/src/schema/time.ts",
  "packages/ui/stories/brand.stories.tsx",
];

/** Next.js route segments use `[id]` and `(app)`, which are glob syntax. */
const literalGlob = (path) => path.replace(/[[\]()]/g, "\\$&");

export const maxLinesConfigs = [
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    ignores: [
      "**/*.test.{ts,tsx}",
      "**/*.spec.{ts,tsx}",
      "**/test/**",
      "**/e2e/**",
      "**/seeds/**",
      "**/generated/**",
      "**/migrations/**",
      ...MAX_LINES_ALLOWLIST.map(literalGlob),
    ],
    rules: {
      "max-lines": [
        "error",
        { max: MAX_LINES, skipBlankLines: true, skipComments: true },
      ],
    },
  },
];
