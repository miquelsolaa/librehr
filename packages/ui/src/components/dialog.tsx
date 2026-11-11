import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "../lib/cn.js";
import { useUiStrings } from "./ui-strings.js";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-scrim/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

export interface DialogContentProps extends React.ComponentPropsWithoutRef<
  typeof DialogPrimitive.Content
> {
  /**
   * How much room the task needs (DESIGN.md §4, Overlays).
   * - `dialog` (default): one decision or a short form. Floats in the
   *   centre on desktop; docks to the bottom edge on a phone.
   * - `panel`: a long form or reference content. Slides in from the right
   *   on desktop so the page behind stays readable; fills the screen on a
   *   phone.
   */
  size?: "dialog" | "panel";
}

const shell =
  "fixed z-50 flex flex-col gap-4 overflow-y-auto overscroll-contain border-border bg-surface-raised p-5 shadow-lg duration-200 sm:p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 motion-reduce:animate-none";

const sizes = {
  dialog:
    // Centred with auto margins, not a transform, so the entry slide stays true.
    "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-dialog border-t data-[state=open]:slide-in-from-bottom-4 sm:inset-0 sm:m-auto sm:h-fit sm:max-h-[85dvh] sm:w-full sm:max-w-lg sm:rounded-dialog sm:border",
  panel:
    "inset-0 data-[state=open]:slide-in-from-right-8 sm:left-auto sm:w-full sm:max-w-xl sm:border-l",
} as const;

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      children,
      size = "dialog",
      onOpenAutoFocus,
      onCloseAutoFocus,
      ...props
    },
    ref,
  ) => {
    const strings = useUiStrings();
    // Radix returns focus to its <DialogTrigger> on close. Our dialogs are
    // mostly opened from state with no trigger, which drops focus on <body>
    // (WCAG 2.4.3). Remember what was focused at open and restore that instead.
    const returnFocusRef = React.useRef<HTMLElement | null>(null);
    return (
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          onOpenAutoFocus={(event) => {
            const active = document.activeElement;
            returnFocusRef.current =
              active instanceof HTMLElement && active !== document.body
                ? active
                : null;
            onOpenAutoFocus?.(event);
          }}
          onCloseAutoFocus={(event) => {
            onCloseAutoFocus?.(event);
            if (event.defaultPrevented) return;
            const target = returnFocusRef.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
          className={cn(shell, sizes[size], className)}
          {...props}
        >
          {children}
          <DialogPrimitive.Close className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-input text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring">
            <X aria-hidden="true" className="h-4 w-4" />
            <span className="sr-only">{strings.close}</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPortal>
    );
  },
);
DialogContent.displayName = DialogPrimitive.Content.displayName;

export const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Clears the close button; always set to the left like the page.
      "flex flex-col gap-1.5 pr-10 text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

export const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      // Full-width and stacked under the thumb on a phone, main action first.
      "mt-auto flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "font-display text-xl font-semibold leading-tight tracking-tight text-foreground",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;
