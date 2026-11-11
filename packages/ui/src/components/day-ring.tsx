import * as React from "react";
import { cn } from "../lib/cn.js";

const RADIUS = 22;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** Keeps a stretch that has just begun visible as a short arc. */
const MIN_SPAN = 0.02;

const dash = (span: number) =>
  Math.min(1, Math.max(MIN_SPAN, span)) * CIRCUMFERENCE;
/** SVG circles start at 3 o'clock; the dial starts at 12. */
const rotation = (from: number) => `rotate(${from * 360 - 90} 32 32)`;

export type DayRingTone = "idle" | "working" | "break";

export interface DayRingProps extends Omit<
  React.SVGProps<SVGSVGElement>,
  "from"
> {
  size?: number | string;
  /**
   * Where the arc begins on a 12-hour dial: 0 is 12 o'clock, 0.25 is 3
   * o'clock, clockwise. `null` draws no arc (nothing is running).
   */
  from?: number | null;
  /** Arc length as a share of the dial (1 = twelve hours). Clamped to 0–1. */
  span?: number;
  tone?: DayRingTone;
  /**
   * Stretches already worked today, drawn faintly under the current arc so
   * the ring reads as the day so far. Same units as `from` and `span`.
   */
  earlier?: readonly { from: number; span: number }[];
  /** Stroke class of the full dial behind the arc, for coloured surfaces. */
  trackClassName?: string;
}

const toneClass: Record<DayRingTone, string> = {
  idle: "text-muted-foreground",
  working: "text-primary",
  break: "text-brand-accent",
};

/**
 * The brand mark as a clock face (DESIGN.md §4): a ring with an arc running
 * from when the current stretch began to now. Decorative: always pair it with
 * text that states the clock state, never rely on the colour or the arc.
 *
 * @example
 * // Working since 9:00, three hours in.
 * <DayRing tone="working" from={0.75} span={0.25} />
 */
export const DayRing = React.forwardRef<SVGSVGElement, DayRingProps>(
  (
    {
      size = 64,
      from = null,
      span = 0,
      tone = "idle",
      earlier = [],
      trackClassName = "stroke-border",
      className,
      ...props
    },
    ref,
  ) => {
    const running = from !== null && tone !== "idle";
    const length = dash(span);
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 64 64"
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
        className={cn("shrink-0", toneClass[tone], className)}
        {...props}
      >
        <circle
          cx="32"
          cy="32"
          r={RADIUS}
          fill="none"
          strokeWidth="6"
          className={trackClassName}
        />
        {earlier.map((stretch, index) => (
          <circle
            key={index}
            cx="32"
            cy="32"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeDasharray={`${dash(stretch.span)} ${CIRCUMFERENCE}`}
            transform={rotation(stretch.from)}
            className="text-primary opacity-40"
          />
        ))}
        {running && (
          <circle
            cx="32"
            cy="32"
            r={RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${length} ${CIRCUMFERENCE}`}
            transform={rotation(from ?? 0)}
          />
        )}
        {running ? (
          <circle cx="32" cy="32" r="7.5" fill="currentColor" />
        ) : (
          <circle
            cx="32"
            cy="32"
            r="6"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
          />
        )}
      </svg>
    );
  },
);
DayRing.displayName = "DayRing";
