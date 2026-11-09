import type { ButtonHTMLAttributes } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "teal";

const variantClass: Record<ButtonVariant, string> = {
  primary: "fv-button fv-button-primary",
  secondary: "fv-button fv-button-secondary",
  ghost: "fv-button fv-button-ghost",
  danger: "fv-button fv-button-danger",
  teal: "fv-button fv-button-teal",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
};

export function Button({ variant = "primary", className, type = "button", ...props }: ButtonProps) {
  const classes = [variantClass[variant], className].filter(Boolean).join(" ");
  return <button type={type} className={classes} {...props} />;
}
