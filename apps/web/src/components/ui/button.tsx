import type { ButtonHTMLAttributes } from "react";

const VARIANT_CLASS = {
  // The template's signature interaction: filled primary purple, hover swaps to teal.
  primary: "bg-pulso-primary text-white hover:bg-pulso-accent",
  ghost: "border border-ink-700 text-neutral-300 hover:border-pulso-accent/60 hover:text-neutral-100",
  icon: "flex h-[43px] w-[43px] items-center justify-center rounded-full bg-pulso-primary text-white hover:bg-pulso-accent",
} as const;

export type ButtonVariant = keyof typeof VARIANT_CLASS;

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const sizing = variant === "icon" ? "" : "rounded-lg px-4 py-2 text-sm font-medium";
  return (
    <button
      className={`transition-colors duration-300 ease-in-out ${sizing} ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  );
}
