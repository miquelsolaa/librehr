import * as React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  strokeWidth?: number | string;
}

function createIcon(
  displayName: string,
  paths: React.ReactNode,
  viewBox = "0 0 24 24",
) {
  const Component = React.forwardRef<SVGSVGElement, IconProps>(
    (
      {
        size = 24,
        strokeWidth = 1.75,
        color = "currentColor",
        className,
        children,
        ...props
      },
      ref,
    ) => (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox={viewBox}
        width={size}
        height={size}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        {...props}
      >
        {paths}
        {children}
      </svg>
    ),
  );
  Component.displayName = displayName;
  return Component;
}

export const IconEmployees = createIcon(
  "IconEmployees",
  <>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>,
);

export const IconOrgChart = createIcon(
  "IconOrgChart",
  <>
    <rect x="9" y="3" width="6" height="4" rx="1" />
    <rect x="2" y="15" width="6" height="4" rx="1" />
    <rect x="9" y="15" width="6" height="4" rx="1" />
    <rect x="16" y="15" width="6" height="4" rx="1" />
    <path d="M12 7v4" />
    <path d="M5 11h14" />
    <path d="M5 11v4" />
    <path d="M12 11v4" />
    <path d="M19 11v4" />
  </>,
);

export const IconTimeOff = createIcon(
  "IconTimeOff",
  <>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <path d="M8 14h.01" />
    <path d="M12 14h.01" />
    <path d="M16 14h.01" />
    <path d="M8 18h.01" />
    <path d="M12 18h4" />
  </>,
);

export const IconClockIn = createIcon(
  "IconClockIn",
  <>
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 6 12 12 16 14" />
    <path d="M19.5 4.5l2-2" />
    <path d="M4.5 4.5l-2-2" />
  </>,
);

export const IconDocuments = createIcon(
  "IconDocuments",
  <>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="12" y2="17" />
  </>,
);

export const IconOnboarding = createIcon(
  "IconOnboarding",
  <>
    <path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
    <path d="M15 12h.01" />
    <path d="M2 21h20" />
    <path d="M9 17l3-3 3 3" />
  </>,
);

export const IconReports = createIcon(
  "IconReports",
  <>
    <path d="M3 21h18" />
    <rect x="5" y="13" width="3" height="8" rx="1" />
    <rect x="10.5" y="8" width="3" height="13" rx="1" />
    <rect x="16" y="4" width="3" height="17" rx="1" />
    <path d="M4 9l5-4 5 3 6-5" />
  </>,
);

export const IconSettings = createIcon(
  "IconSettings",
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </>,
);

export interface BrandMarkProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export const OpenHRMark = React.forwardRef<SVGSVGElement, BrandMarkProps>(
  ({ size = 32, className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      width={size}
      height={size}
      className={className}
      {...props}
    >
      <path
        d="M 44.5 14.5 A 22 22 0 1 0 53 35"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="32" cy="32" r="7.5" fill="currentColor" />
    </svg>
  ),
);
OpenHRMark.displayName = "OpenHRMark";

export interface BrandLogoProps extends React.SVGProps<SVGSVGElement> {
  height?: number | string;
}

export const OpenHRLogo = React.forwardRef<SVGSVGElement, BrandLogoProps>(
  ({ height = 32, className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 310 64"
      height={height}
      className={className}
      {...props}
    >
      <g>
        <path
          d="M 44.5 14.5 A 22 22 0 1 0 53 35"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="32" cy="32" r="7.5" fill="currentColor" />
      </g>
      <g fill="currentColor">
        <path d="M 96 13 C 84.95 13 76 21.95 76 33 C 76 44.05 84.95 53 96 53 C 107.05 53 116 44.05 116 33 C 116 21.95 107.05 13 96 13 Z M 96 18.5 C 104.01 18.5 110.5 24.99 110.5 33 C 110.5 41.01 104.01 47.5 96 47.5 C 87.99 47.5 81.5 41.01 81.5 33 C 81.5 24.99 87.99 18.5 96 18.5 Z" />
        <path d="M 123 23 L 128.5 23 L 128.5 27.2 C 130.8 24.2 134.6 22.5 139.2 22.5 C 147.8 22.5 154 29.2 154 38.5 C 154 47.8 147.8 54.5 139.2 54.5 C 134.6 54.5 130.8 52.8 128.5 49.8 L 128.5 63 L 123 63 Z M 138.5 27.8 C 132.6 27.8 128.5 32.5 128.5 38.5 C 128.5 44.5 132.6 49.2 138.5 49.2 C 144.4 49.2 148.5 44.5 148.5 38.5 C 148.5 32.5 144.4 27.8 138.5 27.8 Z" />
        <path d="M 172 22.5 C 162.2 22.5 155 29.8 155 39 C 155 48.2 162.2 54.5 172.5 54.5 C 179.2 54.5 184.5 51.2 187 45.5 L 181.5 43.5 C 180 47 176.5 49.2 172.5 49.2 C 166.8 49.2 161.8 45.5 160.6 39.8 L 188.5 39.8 C 188.7 38.8 188.7 37.8 188.7 36.8 C 188.7 28.5 181.8 22.5 172 22.5 Z M 160.8 35.5 C 162 30.8 166.2 27.5 172 27.5 C 177.8 27.5 182.2 30.8 183 35.5 Z" />
        <path d="M 195 23 L 200.5 23 L 200.5 27.8 C 202.8 24.5 206.8 22.5 212 22.5 C 220 22.5 224 27.2 224 35.5 L 224 53 L 218.5 53 L 218.5 36.5 C 218.5 30.8 215.5 27.8 210.5 27.8 C 204.8 27.8 200.5 32 200.5 38.5 L 200.5 53 L 195 53 Z" />
        <path d="M 237 13 L 243 13 L 243 30 L 261 30 L 261 13 L 267 13 L 267 53 L 261 53 L 261 35.5 L 243 35.5 L 243 53 L 237 53 Z" />
        <path d="M 277 13 L 293.5 13 C 300.5 13 305.5 17.5 305.5 24.5 C 305.5 30 301.8 33.8 296 35.2 L 307 53 L 300 53 L 290 36 L 283 36 L 283 53 L 277 53 Z M 283 18.5 L 283 31 L 293 31 C 297 31 299.5 28.5 299.5 24.8 C 299.5 21 297 18.5 293 18.5 Z" />
      </g>
    </svg>
  ),
);
OpenHRLogo.displayName = "OpenHRLogo";
