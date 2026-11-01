import * as React from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  OpenHRMark,
  OpenHRLogo,
  IconEmployees,
  IconOrgChart,
  IconTimeOff,
  IconClockIn,
  IconDocuments,
  IconOnboarding,
  IconReports,
  IconSettings,
} from "../src/icons/index.js";

const BrandPage: React.FC = () => {
  return (
    <div className="space-y-16 p-8 font-sans max-w-5xl mx-auto text-slate-800 dark:text-slate-100">
      {/* Header */}
      <div className="border-b border-slate-200 dark:border-slate-800 pb-8">
        <span className="text-xs font-semibold tracking-wider text-emerald-700 dark:text-emerald-400 uppercase">
          OpenHR Design System
        </span>
        <h1 className="text-4xl font-extrabold tracking-tight mt-2 text-slate-900 dark:text-white">
          Brand Identity &amp; Guidelines
        </h1>
        <p className="mt-3 text-lg text-slate-600 dark:text-slate-400">
          The visual identity of OpenHR is built on &ldquo;L&rsquo;Arc&rdquo;
          (The Open Meridian &amp; Radiant Hearth). It conveys human warmth,
          transparency, continuous presence, and craftsmanship.
        </p>
      </div>

      {/* 1. Primary Marks & Lockups */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            1. Brand Marks &amp; Lockups
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Rendered using pure vector geometry. Always maintain clear contrast
            against the background.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Light Theme */}
          <div className="p-8 rounded-xl bg-white border border-slate-200 shadow-sm space-y-6">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Light Canvas (Mediterranean Pine #1a564b)
            </span>
            <div className="flex items-center gap-6 py-4">
              <OpenHRMark size={56} className="text-[#1a564b]" />
              <div className="h-10 w-px bg-slate-200" />
              <OpenHRLogo height={42} className="text-[#1a564b]" />
            </div>
            <p className="text-xs text-slate-500 font-mono">
              Mark: 64x64 viewBox • Primary: hsl(168, 54%, 22%)
            </p>
          </div>

          {/* Dark Theme */}
          <div className="p-8 rounded-xl bg-[#11151c] border border-slate-800 shadow-sm space-y-6">
            <span className="text-xs font-semibold uppercase text-slate-400 tracking-wider">
              Dark Canvas (Luminous Sage #4ecbb6)
            </span>
            <div className="flex items-center gap-6 py-4">
              <OpenHRMark size={56} className="text-[#4ecbb6]" />
              <div className="h-10 w-px bg-slate-800" />
              <div className="flex items-center gap-3">
                <OpenHRMark size={42} className="text-[#4ecbb6]" />
                <span className="text-2xl font-bold tracking-tight text-white font-sans">
                  Open<span className="font-extrabold tracking-normal">HR</span>
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-400 font-mono">
              Mark: 64x64 viewBox • Primary Dark: hsl(168, 55%, 55%)
            </p>
          </div>
        </div>
      </section>

      {/* 2. Clear Space & Minimum Sizes */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            2. Clear Space &amp; Minimum Sizes
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Clear space prevents visual clutter. Maintain at least 0.5x radius
            padding around the mark.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center">
            <div className="relative p-8 border-2 border-dashed border-emerald-400 rounded-lg inline-flex items-center justify-center">
              <span className="absolute top-2 text-[10px] font-mono text-emerald-600 dark:text-emerald-400">
                min clear space = 0.5r
              </span>
              <OpenHRMark
                size={64}
                className="text-[#1a564b] dark:text-[#4ecbb6]"
              />
            </div>
            <span className="mt-4 text-xs text-slate-500 font-medium">
              Clear Space Safe Zone
            </span>
          </div>

          <div className="p-6 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
              Legibility at Micro Sizes
            </h3>
            <div className="flex items-center gap-6 pt-2">
              <div className="flex flex-col items-center gap-2">
                <OpenHRMark
                  size={16}
                  className="text-[#1a564b] dark:text-[#4ecbb6]"
                />
                <span className="text-[11px] font-mono text-slate-400">
                  16px (Favicon)
                </span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <OpenHRMark
                  size={24}
                  className="text-[#1a564b] dark:text-[#4ecbb6]"
                />
                <span className="text-[11px] font-mono text-slate-400">
                  24px (Dense UI)
                </span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <OpenHRMark
                  size={32}
                  className="text-[#1a564b] dark:text-[#4ecbb6]"
                />
                <span className="text-[11px] font-mono text-slate-400">
                  32px (Navbar)
                </span>
              </div>
              <div className="flex flex-col items-center gap-2">
                <OpenHRMark
                  size={48}
                  className="text-[#1a564b] dark:text-[#4ecbb6]"
                />
                <span className="text-[11px] font-mono text-slate-400">
                  48px (Touch App)
                </span>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              The geometry features a 6px stroke and 7.5px nucleus radius on a
              64px grid, ensuring crisp subpixel rendering even on low-DPI
              displays at 16x16.
            </p>
          </div>
        </div>
      </section>

      {/* 3. Color Palette Tokens & Contrast */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            3. Color Palette &amp; Semantic Tokens
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            All colors strictly comply with WCAG 2.2 AA / AAA contrast
            standards.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Primary Pine */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="h-28 bg-[#1a564b] p-4 flex flex-col justify-end text-white">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-80">
                Primary (Light)
              </span>
              <span className="text-lg font-bold">Mediterranean Pine</span>
            </div>
            <div className="p-4 bg-white dark:bg-slate-900 space-y-1 text-xs font-mono text-slate-600 dark:text-slate-300">
              <div>HEX: #1a564b</div>
              <div>HSL: 168, 54%, 22%</div>
              <div className="text-emerald-700 dark:text-emerald-400 font-semibold pt-1">
                Contrast on #FFF: 8.1:1 (AAA)
              </div>
            </div>
          </div>

          {/* Primary Sage */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="h-28 bg-[#4ecbb6] p-4 flex flex-col justify-end text-[#0d201c]">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-80">
                Primary (Dark)
              </span>
              <span className="text-lg font-bold">Luminous Sage</span>
            </div>
            <div className="p-4 bg-white dark:bg-slate-900 space-y-1 text-xs font-mono text-slate-600 dark:text-slate-300">
              <div>HEX: #4ecbb6</div>
              <div>HSL: 168, 55%, 55%</div>
              <div className="text-emerald-700 dark:text-emerald-400 font-semibold pt-1">
                Contrast on #11151c: 9.7:1 (AAA)
              </div>
            </div>
          </div>

          {/* Accent Terracotta */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
            <div className="h-28 bg-[#d9822b] p-4 flex flex-col justify-end text-white">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-80">
                Warm Accent
              </span>
              <span className="text-lg font-bold">Terracotta Ochre</span>
            </div>
            <div className="p-4 bg-white dark:bg-slate-900 space-y-1 text-xs font-mono text-slate-600 dark:text-slate-300">
              <div>HEX: #d9822b</div>
              <div>HSL: 32, 68%, 51%</div>
              <div className="text-amber-700 dark:text-amber-400 font-semibold pt-1">
                UI Accent / Badges / Accents
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Do's and Don'ts */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            4. Brand Rules: Do&rsquo;s and Don&rsquo;ts
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Preserve the integrity and recognition of the OpenHR mark.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-xl border border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-800/40 space-y-3">
            <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-bold text-sm">
              <span className="h-5 w-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-xs">
                ✓
              </span>
              DO
            </div>
            <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-2 list-disc list-inside">
              <li>
                Use the official SVG paths and specified CSS tokens (
                <code className="font-mono">--primary</code>,{" "}
                <code className="font-mono">currentColor</code>).
              </li>
              <li>Provide ample clear space around all lockups and marks.</li>
              <li>
                Use the dark variant (<code className="font-mono">#4ecbb6</code>
                ) when rendering over dark charcoal or slate backgrounds.
              </li>
              <li>Respect the 64x64 geometric proportions when scaling.</li>
            </ul>
          </div>

          <div className="p-6 rounded-xl border border-rose-200 bg-rose-50/50 dark:bg-rose-950/20 dark:border-rose-800/40 space-y-3">
            <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300 font-bold text-sm">
              <span className="h-5 w-5 rounded-full bg-rose-600 text-white flex items-center justify-center text-xs">
                ✕
              </span>
              DON&rsquo;T
            </div>
            <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-2 list-disc list-inside">
              <li>
                Do not rotate or tilt the arc. The opening must always face the
                upper-right (10 o&rsquo;clock to 2 o&rsquo;clock meridian).
              </li>
              <li>
                Do not alter the relative size or offset position of the central
                nucleus dot.
              </li>
              <li>
                Do not apply bevels, heavy drop shadows, or uncalibrated
                multi-color gradients.
              </li>
              <li>
                Do not place low-contrast dark pine marks on dark backgrounds.
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 5. Custom Module Icon Set */}
      <section className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            5. Module Iconography (24px Grid, 1.75 Stroke)
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Hand-crafted icons designed to harmonize seamlessly with Lucide
            conventions while maintaining distinct domain character.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            {
              name: "Employees",
              component: <IconEmployees size={24} />,
              desc: "People & Org",
            },
            {
              name: "Org Chart",
              component: <IconOrgChart size={24} />,
              desc: "Structure",
            },
            {
              name: "Time Off",
              component: <IconTimeOff size={24} />,
              desc: "Ledger & Balances",
            },
            {
              name: "Clock In",
              component: <IconClockIn size={24} />,
              desc: "Jornada Tracking",
            },
            {
              name: "Documents",
              component: <IconDocuments size={24} />,
              desc: "Vault & Files",
            },
            {
              name: "Onboarding",
              component: <IconOnboarding size={24} />,
              desc: "Checklists & Flows",
            },
            {
              name: "Reports",
              component: <IconReports size={24} />,
              desc: "Audits & Exports",
            },
            {
              name: "Settings",
              component: <IconSettings size={24} />,
              desc: "System Config",
            },
          ].map((icon) => (
            <div
              key={icon.name}
              className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center space-y-2"
            >
              <div className="p-3 rounded-lg bg-white dark:bg-slate-800 text-[#1a564b] dark:text-[#4ecbb6] shadow-sm">
                {icon.component}
              </div>
              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {icon.name}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                {icon.desc}
              </span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};

const meta: Meta<typeof BrandPage> = {
  title: "Brand/Identity",
  component: BrandPage,
  parameters: {
    layout: "fullscreen",
  },
};

export default meta;
type Story = StoryObj<typeof BrandPage>;

export const Guidelines: Story = {};
