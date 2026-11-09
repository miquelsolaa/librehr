import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./dialog.js";
import { Button } from "./button.js";
import { Input } from "./input.js";
import { useUiStrings } from "./ui-strings.js";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  expectedConfirmationWord?: string;
  variant?: "danger" | "default";
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  cancelText,
  expectedConfirmationWord,
  variant = "danger",
  onConfirm,
  isLoading = false,
}) => {
  const strings = useUiStrings();
  const [before = "", after = ""] = strings.typeToConfirm.split("{word}");
  const [typedWord, setTypedWord] = React.useState("");

  const isConfirmed = expectedConfirmationWord
    ? typedWord.trim().toLowerCase() === expectedConfirmationWord.toLowerCase()
    : true;

  const handleConfirm = async () => {
    if (!isConfirmed) return;
    await onConfirm();
    setTypedWord("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {expectedConfirmationWord && (
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              {before}
              <span className="font-semibold text-foreground">
                {expectedConfirmationWord}
              </span>
              {after}
            </p>
            <Input
              value={typedWord}
              onChange={(e) => setTypedWord(e.target.value)}
              placeholder={expectedConfirmationWord}
              disabled={isLoading}
            />
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {cancelText ?? strings.cancel}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "default"}
            disabled={!isConfirmed || isLoading}
            isLoading={isLoading}
            onClick={handleConfirm}
          >
            {confirmText ?? strings.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
