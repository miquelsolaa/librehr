# DESIGN.md - Design system and UX guidelines

Single source of truth for UI. Tokens live in `packages/ui/src/tokens.css`; components in `packages/ui`. Agents must use tokens and existing components, never raw hex values or ad-hoc styles.

> Originality: our UI is designed from our personas and flows (`PERSONA.md`, `PRD.md`). Do not model screens on screenshots of commercial HR products (`CLEANROOM.md`).

## 1. Design principles

1. **Calm and clear.** HR is stressful and personal. Quiet colors, generous whitespace, obvious next step.
2. **Status is always visible.** Every request, record, and task shows its state (pending, approved, rejected, overdue) with text + icon + color (never color alone).
3. **Explain numbers.** Any balance or total can be expanded to show how it was computed.
4. **Mobile-first for employees, desktop-first for admins.**
5. **Forgiving.** Confirm destructive actions, offer undo where possible, preserve form input on errors.
6. **Accessible by construction.** WCAG 2.2 AA is a baseline, not a polish step.
7. **Privacy-aware UI.** Sensitive values are masked by default with an explicit "reveal" action that is audited.

## 2. Foundations

### 2.1 Stack

Tailwind CSS (utility classes mapped to CSS variables), shadcn/ui primitives (Radix) copied into `packages/ui`, `lucide-react` icons, `next-themes` for light/dark, `next-intl` for i18n. Storybook documents every component with states and a11y checks.

### 2.2 Color tokens (semantic, HSL via CSS variables)

Define light and dark values. Never reference palette steps in feature code; use semantic tokens.

| Token                                             | Purpose                          | Light (calibrated) | Dark (calibrated)  | Contrast Ratio (AA/AAA) |
| ------------------------------------------------- | -------------------------------- | ------------------ | ------------------ | ----------------------- |
| `--background`                                    | App background                   | 0 0% 100%          | 222 18% 8%         | Base canvas             |
| `--surface`                                       | Cards, panels                    | 220 20% 98%        | 222 16% 11%        | Subtle tier             |
| `--surface-raised`                                | Popovers, dialogs                | 0 0% 100%          | 222 16% 14%        | Raised tier             |
| `--foreground`                                    | Primary text                     | 222 25% 12%        | 210 20% 96%        | >= 14:1 (AAA)           |
| `--muted-foreground`                              | Secondary text                   | 220 10% 38%        | 215 12% 70%        | >= 4.5:1 (AA)           |
| `--border`                                        | Dividers                         | 220 14% 90%        | 222 12% 20%        | UI boundary             |
| `--primary`                                       | Brand/primary action (Pine/Sage) | 168 54% 22%        | 168 55% 55%        | 8.1:1 AAA / 9.7:1 AAA   |
| `--primary-foreground`                            | Text on primary                  | 0 0% 100%          | 168 45% 9%         | 8.1:1 AAA / 10.1:1 AAA  |
| `--accent`                                        | Subtle tint/highlights           | 168 40% 94%        | 168 30% 16%        | Soft backdrop tint      |
| `--brand-accent`                                  | Warm Terracotta Ochre            | 32 68% 51%         | 32 75% 58%         | Warm highlight          |
| `--success` / `--warning` / `--danger` / `--info` | Status                           | WCAG-checked pairs | WCAG-checked pairs | >= 4.5:1 (AA)           |
| `--focus-ring`                                    | Focus outline (3:1 vs adjacent)  | 168 54% 30%        | 168 55% 55%        | >= 3:1 accessible ring  |

Leave-type colors come from a fixed, color-blind-safe categorical palette (8 hues) and are always paired with an icon/label.

### 2.3 Typography

- Self-hosted variable font (Inter or system UI stack fallback). **No Google Fonts or external CDNs.**
- Scale (rem): 12, 14 (base for dense UI), 16 (base for forms/mobile), 18, 20, 24, 30, 36. Line-height 1.5 body, 1.25 headings.
- Headings: every page title comes from `PageHeader` (24 px, semibold, no icons in the title). Section headings (`h2`) are 16 px semibold. Keep semantic order h1 → h2 → h3.
- No arbitrary font sizes (`text-[11px]`); use the scale above. Lint enforces this in `apps/web` and `packages/ui`.
- Numerals: use tabular figures for tables, balances, and timesheets (`font-variant-numeric: tabular-nums`).
- Never truncate meaningful text without a tooltip/expand affordance.

### 2.4 Spacing, radius, elevation, motion

- 4 px spacing grid (4, 8, 12, 16, 24, 32, 48, 64). Page max-width 1280 px; reading width 72ch.
- Radius: 6 (inputs), 10 (cards), 16 (dialogs), full (avatars/badges).
- Elevation: border-first; shadows only for popovers/dialogs.
- Motion: 120-200 ms ease-out for state changes; no parallax; honor `prefers-reduced-motion`.

### 2.5 Iconography and imagery

`lucide-react`, 16/20/24 px, stroke 1.75. Icons accompany, never replace, labels except in universally understood cases (close, search) with `aria-label`. Illustrations are our own, simple, and optional. Avatars show initials fallback.

## 3. Layout

- **App shell (desktop):** left sidebar (collapsible, modules), top bar (global search, notifications, user menu, org switcher), content area with page header (title, breadcrumbs, primary action right-aligned).
- **App shell (mobile):** top bar + bottom navigation (Home, Time off, Clock, Documents, Profile). Admin features are reachable but optimized for desktop.
- **Breakpoints:** 360, 640, 768, 1024, 1280. Test at 360 px.
- **Home dashboards:** Employee: clock widget, balance cards, upcoming leave, tasks. Manager: approval inbox, who's away today, team alerts. HR: tasks needing attention, upcoming joiners/leavers, compliance warnings.

### Wireframes (ASCII, illustrative)

Clock widget (employee home, mobile):

```
+--------------------------------+
| Good morning, Laia             |
| +----------------------------+ |
| |  Not clocked in            | |
| |  Today: 0h 00m             | |
| |  [   Clock in   ]          | |
| +----------------------------+ |
| Time off      18.5 days left   |
| Next: Fri 6 Nov (approved)     |
| Pending: 1 request             |
+--------------------------------+
```

Leave request (desktop dialog):

```
+------------------ Request time off -------------------+
| Type [Vacation v]     From [2026-12-21] To [2026-12-31]|
| [ ] Half day start    [ ] Half day end                 |
| Working days: 7   Balance after: 11.5   (explain)       |
| Team overlap: Pere (24-28 Dec)  ! coverage OK           |
| Note ____________________   Attachment [+]              |
|                                  [Cancel] [Submit]      |
+---------------------------------------------------------+
```

## 4. Components (in `packages/ui`)

Build on shadcn primitives; every component supports light/dark, RTL-safe logical properties, keyboard, and has Storybook stories.

- **Inputs:** Text, Textarea, Select, Combobox (async), DatePicker (locale-aware, keyboard typing supported), DateRangePicker (with half-day toggles), TimePicker, Switch, Checkbox, RadioGroup, FileDropzone, SecretField (masked + reveal).
- **Feedback:** Toast (non-critical), Alert (inline, persistent), Banner (org-level), Skeleton, Spinner, ProgressBar, EmptyState, ErrorState.
- **Data display:** DataTable (server pagination/sort/filter, column visibility, density toggle, sticky header, bulk selection, row actions), StatCard, Badge/StatusPill, Avatar/AvatarGroup, Timeline, Calendar (month/week/timeline-by-person), OrgChart, DescriptionList, BalanceExplainer.
- **Navigation:** PageHeader (breadcrumb, title, description, actions), Sidebar, Topbar, BottomNav, Tabs, Breadcrumbs, CommandPalette (Ctrl/Cmd+K).
- **Overlays:** Dialog, Sheet (mobile-friendly), Popover, Tooltip, ConfirmDialog (typed confirmation for destructive/irreversible).
- **Domain components:** ClockWidget, LeaveRequestForm, ApprovalCard, TimesheetGrid, CorrectionDialog, ChecklistRunner, DocumentList, AuditLogTable.

## 5. Patterns

### Forms

- Single column; labels above fields; helper text below; required fields marked with text "(required)" not just an asterisk.
- Validate on blur and on submit with Zod messages translated; show a summary at top on submit failure with links to fields; keep entered values.
- Disable submit only while submitting; show progress; prevent double-submit with idempotency keys.
- Autofill attributes set correctly (`autocomplete`).

### Tables

- Default density comfortable; offer compact. Right-align numbers; tabular figures.
- Always show total counts and active filters; filters are removable chips. Persist user's filters/columns per table.
- Row click opens detail; explicit action menu for operations. Bulk actions appear in a sticky bar.

### States

Every async view defines: loading (skeleton), empty (explain + primary action), error (what happened + retry + support hint), partial (stale data warning), offline (PWA banner).

### Destructive and sensitive actions

ConfirmDialog states consequence in plain language. Sensitive reveals (national id, IBAN) require click-to-reveal and are audit-logged; copy buttons announce via live region.

### Notifications

Toasts auto-dismiss after 6 s (not for errors); errors persist. Emails mirror in-app wording; deep links open the relevant item.

## 6. Accessibility checklist (per component/page)

- Keyboard: all interactions reachable, logical tab order, no traps, Esc closes overlays, focus returns to trigger.
- Focus: visible 2-3 px ring using `--focus-ring`; never `outline: none` without replacement.
- Semantics: landmarks (`header`, `nav`, `main`), headings in order, buttons vs links correct, tables with headers/scope, form labels associated.
- ARIA only when native HTML is insufficient; live regions for async results (e.g. clock-in success).
- Contrast: text >= 4.5:1, large text/UI >= 3:1, in both themes.
- Targets: >= 24x24 CSS px minimum (WCAG 2.2), >= 44x44 for primary mobile actions.
- Motion/time: no auto-moving content; respect reduced motion; session timeout warnings.
- Test with axe in Playwright, plus manual keyboard and VoiceOver/NVDA smoke checks for new flows.

## 7. Internationalization in UI

- Source strings in `en`; `ca` and `es` required. Use ICU message format (plurals, select). No string concatenation.
- Allow +35% text expansion; avoid fixed-width buttons. Use `Intl.DateTimeFormat`, `Intl.NumberFormat`, `Intl.RelativeTimeFormat`; first day of week per locale (Monday for es/ca).
- Time zones: show times in the user's/organization's zone and indicate zone when different.
- Names: do not assume first/last name order; support preferred name.
- Formal/informal address: Spanish and Catalan UI uses a neutral, informal-friendly tone ("tu"), consistently.

## 8. Voice and content

- Plain, warm, specific. Say what happened and what to do next. No jargon ("Your request is waiting for Pere's approval").
- Avoid blame in errors ("We couldn't save your changes" not "You entered invalid data").
- Avoid cheerleading and surveillance language; HR tools should feel fair and respectful.
- Legal/compliance copy is reviewed by a maintainer and linked to `COMPLIANCE.md`.

## 9. Theming and branding

Organizations can set name, logo, and an accent color (validated for contrast). Core layout and semantic status colors are not overridable. Dark mode and system preference supported.

## 10. Performance and quality bars

- Largest Contentful Paint < 2.5 s on mid-range mobile over 4G; no layout shift on skeleton -> content; JS per route budget enforced in CI.
- Images optimized and self-hosted; icons tree-shaken.
- Storybook visual regression (Chromatic-free: use Playwright screenshots in CI) for core components.

## 11. Definition of done for UI work

Matches tokens; all states implemented; keyboard + axe clean; 360 px to 1280 px verified; ca/es/en strings; dark mode checked; story added; no third-party runtime requests.
