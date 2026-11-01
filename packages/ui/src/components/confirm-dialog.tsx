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
  confirmText = "Confirm",
  cancelText = "Cancel",
  expectedConfirmationWord,
  variant = "danger",
  onConfirm,
  isLoading = false,
}) => {
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
              Please type{" "}
              <span className="font-semibold text-foreground">
                {expectedConfirmationWord}
              </span>{" "}
              to confirm:
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
            {cancelText}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "default"}
            disabled={!isConfirmed || isLoading}
            isLoading={isLoading}
            onClick={handleConfirm}
          >
            {confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
