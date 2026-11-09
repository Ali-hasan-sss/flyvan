import type { HTMLAttributes } from "react";

type BadgeTone = "neutral" | "info" | "success" | "warning" | "danger";

const toneClass: Record<BadgeTone, string> = {
  neutral: "fv-badge fv-badge-neutral",
  info: "fv-badge fv-badge-info",
  success: "fv-badge fv-badge-success",
  warning: "fv-badge fv-badge-warning",
  danger: "fv-badge fv-badge-danger",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  const classes = [toneClass[tone], className].filter(Boolean).join(" ");
  return <span className={classes} {...props} />;
}
