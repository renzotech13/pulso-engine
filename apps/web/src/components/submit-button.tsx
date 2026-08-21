"use client";

import { useFormStatus } from "react-dom";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface SubmitButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pendingText?: ReactNode;
  /** When set, shows a native confirm() on click and blocks the submit if the user cancels — for destructive actions. */
  confirmMessage?: string;
}

export function SubmitButton({ children, pendingText, disabled, confirmMessage, onClick, ...props }: SubmitButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      onClick={(e) => {
        if (confirmMessage && !window.confirm(confirmMessage)) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...props}
    >
      {pending ? (pendingText ?? "Enviando…") : children}
    </button>
  );
}
