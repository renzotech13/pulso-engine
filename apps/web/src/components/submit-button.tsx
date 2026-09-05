"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";

interface SubmitButtonProps extends Omit<ButtonProps, "pending" | "type"> {
  pendingText?: ReactNode;
  /** When set, shows a native confirm() on click and blocks the submit if the user cancels — for destructive actions. */
  confirmMessage?: string | undefined;
}

/**
 * The form-aware Button: reads the surrounding form's pending state so every
 * submit shows a spinner and can't be double-clicked. Same variants/sizes as
 * Button; a `className` is still accepted for layout tweaks.
 */
export function SubmitButton({
  children,
  pendingText,
  confirmMessage,
  onClick,
  variant = "primary",
  size = "md",
  ...props
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant={variant}
      size={size}
      pending={pending}
      pendingText={pendingText ?? "Enviando…"}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
