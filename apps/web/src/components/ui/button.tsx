import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

// Every button in the dashboard used to be hand-rolled: 21 primary buttons
// in four sizes, a dozen ghosts, and emerald/pink/red one-offs, while this
// primitive sat unused. The variants below cover every real use, and
// `buttonClass` exists for the places that must stay a <Link> or an <a>.
const VARIANT_CLASS = {
  primary: "bg-pulso-primary text-white hover:bg-pulso-accent",
  secondary: "border border-ink-700 text-neutral-200 hover:border-pulso-accent/60 hover:text-neutral-100",
  subtle: "bg-ink-800 text-neutral-200 hover:bg-ink-700",
  success: "bg-status-green text-ink-950 hover:bg-status-green/85",
  danger: "bg-status-pink text-white hover:bg-status-pink/85",
  dangerGhost: "border border-ink-700 text-neutral-300 hover:border-status-pink/60 hover:text-status-pink",
  link: "text-pulso-accent hover:underline",
} as const;

const SIZE_CLASS = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
} as const;

export type ButtonVariant = keyof typeof VARIANT_CLASS;
export type ButtonSize = keyof typeof SIZE_CLASS;

const BASE_CLASS =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pulso-accent/60 disabled:cursor-not-allowed disabled:opacity-60";

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = ""): string {
  const sizing = variant === "link" ? "" : SIZE_CLASS[size];
  return `${BASE_CLASS} ${sizing} ${VARIANT_CLASS[variant]} ${extra}`.trim();
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** Shows a spinner + `pendingText` and disables the button. */
  pending?: boolean | undefined;
  pendingText?: ReactNode;
}

export function Button({
  variant = "primary",
  size = "md",
  pending = false,
  pendingText,
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={buttonClass(variant, size, className)}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? (
        <>
          <Loader2 size={14} className="animate-spin" aria-hidden="true" />
          {pendingText ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
