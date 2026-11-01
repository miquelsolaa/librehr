# LibreHR Brand Identity Guidelines

> **License:** The brand marks, logos, iconography, and image assets in this repository are licensed under **Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0)**. The software code implementing them is licensed under **AGPL-3.0**.

---

## 1. Concept Exploration & Rationale

During the brand identity process, three distinct conceptual directions were explored from first principles adhering to `CLEANROOM.md`:

### Concept 1: "L'Arc" (The Open Meridian & Radiant Hearth) — **SELECTED**

```svg
<svg viewBox="0 0 64 64" width="48" height="48">
  <path d="M 44.5 14.5 A 22 22 0 1 0 53 35" stroke="#1a564b" stroke-width="6" stroke-linecap="round" fill="none"/>
  <circle cx="32" cy="32" r="7.5" fill="#1a564b"/>
</svg>
```

- **One-line Rationale:** An unclosed solar arc with an inner nucleus, symbolizing the human core at the center of cyclical working time and open transparent governance.
- **Why it was chosen:** It strikes an immediate balance between timeless geometry, craft, and calm human warmth. Crucially, the 6px stroke with a 3px opening and 7.5px nucleus scales effortlessly from a 16px favicon to a 512px app icon without loss of legibility or optical blurriness. It bears zero resemblance to any corporate or commercial HR vendor.

### Concept 2: "The Stepped Glyph" (Human & Growth Pillar)

```svg
<svg viewBox="0 0 64 64" width="48" height="48">
  <rect x="12" y="28" width="10" height="24" rx="3" fill="#1a564b"/>
  <rect x="27" y="18" width="10" height="34" rx="3" fill="#1a564b"/>
  <rect x="42" y="36" width="10" height="16" rx="3" fill="#1a564b"/>
</svg>
```

- **One-line Rationale:** Three rhythmic columns symbolizing collective organization and stepped progression.
- **Critique:** While structured, it leans too heavily into analytics/bar charts and misses the personal, human dimension of HR and working-time balance.

### Concept 3: "The Cadence Node" (Time Interval & Nexus)

```svg
<svg viewBox="0 0 64 64" width="48" height="48">
  <circle cx="20" cy="32" r="10" fill="none" stroke="#1a564b" stroke-width="5"/>
  <circle cx="44" cy="32" r="10" fill="none" stroke="#1a564b" stroke-width="5"/>
  <path d="M 28 32 L 36 32" stroke="#1a564b" stroke-width="5" stroke-linecap="round"/>
</svg>
```

- **One-line Rationale:** Two interconnected circles denoting the bridge between employer and employee.
- **Critique:** Lacks optical weight when scaled down to 16px and reads more like a telecommunications or network protocol mark.

---

## 2. Brand Architecture & Name

- **Brand Name:** **LibreHR** (Emphasizing freedom, self-sovereignty, and European open-source AGPL stewardship).

---

## 3. Geometry & Construction

The primary mark is constructed on a 64×64 pixel master grid:

- **Outer Arc:** Radius $R = 22\text{px}$, stroke width $W = 6\text{px}$, rounded stroke caps. The arc begins at $(44.5, 14.5)$ and sweeps clockwise $290^\circ$ to $(53, 35)$, leaving an upper-right aperture of $70^\circ$.
- **Inner Nucleus:** Centered circle at $(32, 32)$ with radius $r = 7.5\text{px}$.
- **Wordmark:** Hand-crafted vector letterforms for `LibreHR` (`packages/ui/src/brand/librehr-wordmark.svg`), converted into pure bezier paths with zero external web fonts or CDN runtime dependencies.

---

## 4. Semantic Palette & Color Tokens

| Semantic Role          | Token Name             | Light Value                       | Dark Value                        | WCAG Contrast                                       |
| :--------------------- | :--------------------- | :-------------------------------- | :-------------------------------- | :-------------------------------------------------- |
| **Primary Brand**      | `--primary`            | `#1a564b`<br>`hsl(168, 54%, 22%)` | `#4ecbb6`<br>`hsl(168, 55%, 55%)` | **8.1:1 (AAA)** on light<br>**9.7:1 (AAA)** on dark |
| **Primary Foreground** | `--primary-foreground` | `#ffffff`<br>`hsl(0, 0%, 100%)`   | `#0d201c`<br>`hsl(168, 45%, 9%)`  | **8.1:1 (AAA)**<br>**10.1:1 (AAA)**                 |
| **Warm Accent**        | `--brand-accent`       | `#d9822b`<br>`hsl(32, 68%, 51%)`  | `#e5903b`<br>`hsl(32, 75%, 58%)`  | Badges, milestones, warm highlights                 |
| **Accent Background**  | `--accent`             | `hsl(168, 40%, 94%)`              | `hsl(168, 30%, 16%)`              | Subtle tint containers                              |
| **Focus Ring**         | `--focus-ring`         | `hsl(168, 54%, 30%)`              | `hsl(168, 55%, 55%)`              | $\ge 3:1$ boundary ring                             |

---

## 5. Asset Map & Deliverables

### Brand Assets (`packages/ui/src/brand/`)

- `librehr-mark.svg` / `librehr-mark-dark.svg` / `librehr-mark-monochrome.svg`: Standalone 64×64 mark.
- `librehr-wordmark.svg` / `librehr-wordmark-dark.svg` / `librehr-wordmark-monochrome.svg`: Vector letterforms.
- `librehr-lockup-horizontal.svg` / `librehr-lockup-horizontal-dark.svg`: Primary horizontal lockup (350×64).
- `librehr-lockup-stacked.svg` / `librehr-lockup-stacked-dark.svg`: Stacked lockup (260×170).

### Web & PWA Assets (`apps/web/public/`)

- `favicon.svg`: Responsive vector favicon with `prefers-color-scheme` adaptation.
- `favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png`: Sharp-rendered raster favicons.
- `apple-touch-icon.png`: 180×180 iOS touch icon with squircle radius.
- `icons/icon-192.png`, `icons/icon-512.png`: Android PWA application icons.
- `icons/icon-maskable-512.png`: 512×512 PWA maskable icon with calibrated 80% diameter safe zone.
- `og-image.png`: 1200×630 OpenGraph card.

### Module Icon Set (`packages/ui/src/icons/`)

Custom 24×24 grid, 1.75 stroke, rounded cap icons matching Lucide design language:

1. `IconEmployees` (`employees.svg`): People & organizational directory.
2. `IconOrgChart` (`org-chart.svg`): Department & team hierarchies.
3. `IconTimeOff` (`time-off.svg`): Vacation ledger, calendar, and leave approvals.
4. `IconClockIn` (`clock-in.svg`): Working-time tracking (_registro de jornada_).
5. `IconDocuments` (`documents.svg`): Document storage and signature vault.
6. `IconOnboarding` (`onboarding.svg`): New hire checklists and offboarding workflows.
7. `IconReports` (`reports.svg`): Statutory compliance exports and labor analytics.
8. `IconSettings` (`settings.svg`): Organization configuration and access control.

---

## 6. Usage Rules

- **Clear Space:** Maintain minimum clear space equal to half the mark's radius ($0.5r$) on all sides.
- **Minimum Size:**
  - Favicon: 16×16 px.
  - In-app status/badge: 20×20 px.
  - Navigation / header: 32×32 px.
  - Lockup with wordmark: minimum height 28 px.
- **Do's:**
  - Always use the official SVGs or `@openhr/ui` React icon components (`<LibreHRMark />`, `<LibreHRLogo />`).
  - Ensure high contrast: use Mediterranean Pine on light backgrounds and Luminous Sage on dark backgrounds.
- **Don'ts:**
  - Do not rotate the arc; the aperture must always face the upper-right meridian.
  - Do not alter the relative proportion or offset of the central circle.
  - Do not apply artificial drop shadows, bevels, or unapproved gradient fills.
