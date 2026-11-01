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

export const LibreHRMark = React.forwardRef<SVGSVGElement, BrandMarkProps>(
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
LibreHRMark.displayName = "LibreHRMark";
export const OpenHRMark = LibreHRMark;

export interface BrandLogoProps extends React.SVGProps<SVGSVGElement> {
  height?: number | string;
}

export const LibreHRLogo = React.forwardRef<SVGSVGElement, BrandLogoProps>(
  ({ height = 32, className, ...props }, ref) => (
    <svg
      ref={ref}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 350 64"
      height={height}
      className={className}
      {...props}
    >
      <g transform="translate(4, 0)">
        <path
          d="M 44.5 14.5 A 22 22 0 1 0 53 35"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="32" cy="32" r="7.5" fill="currentColor" />
      </g>
      <g fill="currentColor" transform="translate(76, 0)">
        <path d="M 12 13 L 18 13 L 18 47.5 L 38 47.5 L 38 53 L 12 53 Z" />
        <path d="M 47 23 L 52.5 23 L 52.5 53 L 47 53 Z M 49.75 12.5 C 51.4 12.5 52.75 13.85 52.75 15.5 C 52.75 17.15 49.4 18.5 49.75 18.5 C 48.1 18.5 46.75 17.15 46.75 15.5 C 46.75 13.85 48.1 12.5 49.75 12.5 Z" />
        <path d="M 62 13 L 67.5 13 L 67.5 27.2 C 69.8 24.2 73.6 22.5 78.2 22.5 C 86.8 22.5 93 29.2 93 38.5 C 93 47.8 86.8 54.5 78.2 54.5 C 73.6 54.5 69.8 52.8 67.5 49.8 L 67.5 53 L 62 53 Z M 77.5 27.8 C 71.6 27.8 67.5 32.5 67.5 38.5 C 67.5 44.5 71.6 49.2 77.5 49.2 C 83.4 49.2 87.5 44.5 87.5 38.5 C 87.5 32.5 83.4 27.8 77.5 27.8 Z" />
        <path d="M 101 23 L 106.5 23 L 106.5 28.5 C 108.8 24.8 112.8 22.5 118 22.5 C 120 22.5 122 23 123.5 24 L 121.5 29.2 C 120.2 28.2 116.8 27.8 116.8 27.8 C 111.8 27.8 106.5 32 106.5 38.5 L 106.5 53 L 101 53 Z" />
        <path d="M 143 22.5 C 133.2 22.5 126 29.8 126 39 C 126 48.2 133.2 54.5 143.5 54.5 C 150.2 54.5 155.5 51.2 158 45.5 L 152.5 43.5 C 151 47 147.5 49.2 143.5 49.2 C 137.8 49.2 132.8 45.5 131.6 39.8 L 159.5 39.8 C 159.7 38.8 159.7 37.8 159.7 36.8 C 159.7 28.5 152.8 22.5 143 22.5 Z M 131.8 35.5 C 133 30.8 137.2 27.5 143 27.5 C 148.8 27.5 153.2 30.8 154 35.5 Z" />
        <path d="M 173 13 L 179 13 L 179 30 L 197 30 L 197 13 L 203 13 L 203 53 L 197 53 L 197 35.5 L 179 35.5 L 179 53 L 173 53 Z" />
        <path d="M 213 13 L 229.5 13 C 236.5 13 241.5 17.5 241.5 24.5 C 241.5 30 237.8 33.8 232 35.2 L 243 53 L 236 53 L 226 36 L 219 36 L 219 53 L 213 53 Z M 219 18.5 L 219 31 L 229 31 C 233 31 235.5 28.5 235.5 24.8 C 235.5 21 233 18.5 229 18.5 Z" />
      </g>
    </svg>
  ),
);
LibreHRLogo.displayName = "LibreHRLogo";
export const OpenHRLogo = LibreHRLogo;
