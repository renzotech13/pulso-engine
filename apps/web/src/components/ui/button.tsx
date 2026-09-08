import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";

// Every button in the dashboard used to be hand-rolled: 21 primary buttons
// in four sizes, a dozen ghosts, and emerald/pink/red one-offs, while this
// primitive sat unused. The variants below cover every real use, and
// `buttonClass` exists for the places that must stay a <Link> or an <a>.
// Sobre CUALQUIER relleno de color va `text-accent-fg`, nunca `text-fg`: el
// crema sobre naranja da 2.94:1 y sobre el rojo de error 3.25:1, los dos por
// debajo de AA. Con el texto oscuro suben a 6.35:1 y 5.73:1. El botón de
// peligro venía en blanco sobre rosa desde antes de este rediseño.
const VARIANT_CLASS = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary: "border border-line-2 text-fg hover:border-fg-3 hover:bg-surface",
  subtle: "bg-surface-2 text-fg-2 hover:text-fg hover:bg-surface",
  success: "bg-success text-accent-fg hover:opacity-90",
  danger: "bg-danger text-accent-fg hover:opacity-90",
  dangerGhost: "border border-line-2 text-fg-2 hover:border-danger hover:text-danger",
  link: "text-accent-ink hover:underline",
} as const;

const SIZE_CLASS = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
} as const;

export type ButtonVariant = keyof typeof VARIANT_CLASS;
export type ButtonSize = keyof typeof SIZE_CLASS;

const BASE_CLASS =
  // El foco lo pinta el `:focus-visible` global (globals.css), como en el
  // sitio, en vez de un anillo repetido componente por componente.
  "inline-flex items-center justify-center gap-1.5 rounded-btn font-bold transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-40";

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
