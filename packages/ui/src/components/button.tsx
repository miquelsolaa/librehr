import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Loader2 } from "lucide-react";
import { cn } from "../lib/cn.js";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  variant?: "default" | "secondary" | "outline" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "md",
      asChild = false,
      isLoading = false,
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";

    const variantStyles = {
      default: "bg-primary text-primary-foreground hover:opacity-90",
      secondary:
        "bg-surface border border-border text-foreground hover:bg-accent",
      outline:
        "border border-border bg-transparent text-foreground hover:bg-surface",
      ghost: "text-foreground hover:bg-surface",
      danger: "bg-danger text-white hover:opacity-90",
    };

    const sizeStyles = {
      sm: "h-8 px-3 text-xs rounded-input",
      md: "h-10 px-4 text-sm rounded-input",
      lg: "h-12 px-6 text-base rounded-input",
      icon: "h-10 w-10 p-2 rounded-input",
    };

    return (
      <Comp
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring disabled:pointer-events-none disabled:opacity-50 select-none",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        {...props}
      >
        {isLoading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            {children}
          </span>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
