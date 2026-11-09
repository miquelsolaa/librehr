import * as React from "react";
import { Eye, EyeOff, Copy, Check } from "lucide-react";
import { cn } from "../lib/cn.js";
import { Button } from "./button.js";
import { useUiStrings } from "./ui-strings.js";

export interface SecretFieldProps {
  value: string;
  label?: string;
  onReveal?: () => void;
  className?: string;
}

export const SecretField: React.FC<SecretFieldProps> = ({
  value,
  label,
  onReveal,
  className,
}) => {
  const strings = useUiStrings();
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const handleToggleReveal = () => {
    if (!revealed && onReveal) {
      onReveal();
    }
    setRevealed((prev) => !prev);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write failure in unsupported environments
    }
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
      )}
      <div className="flex items-center gap-2 rounded-input border border-border bg-background px-3 py-1.5 font-mono text-sm">
        <span className="flex-1 select-all font-mono">
          {revealed ? value : "••••••••••••••••"}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleToggleReveal}
          aria-label={revealed ? strings.hideSecret : strings.revealSecret}
          className="h-7 w-7 p-0"
        >
          {revealed ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleCopy}
          aria-label={strings.copyToClipboard}
          className="h-7 w-7 p-0"
        >
          {copied ? (
            <Check className="h-4 w-4 text-success" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
        <span className="sr-only" aria-live="polite">
          {copied ? strings.copiedToClipboard : ""}
        </span>
      </div>
    </div>
  );
};
