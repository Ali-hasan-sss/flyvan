import type { ReactNode } from "react";

type StateProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function EmptyState({ title, description, action }: StateProps) {
  return (
    <div className="fv-state" role="status">
      <h2 className="fv-state-title">{title}</h2>
      <p className="fv-state-copy">{description}</p>
      {action}
    </div>
  );
}

export function ErrorState({ title, description, action }: StateProps) {
  return (
    <div className="fv-state" role="alert" style={{ borderColor: "var(--fv-danger)" }}>
      <h2 className="fv-state-title">{title}</h2>
      <p className="fv-state-copy">{description}</p>
      {action}
    </div>
  );
}

export function LoadingState({ label = "جارٍ التحميل" }: { label?: string }) {
  return (
    <div className="fv-state" role="status" aria-live="polite">
      <p className="fv-state-title">{label}</p>
    </div>
  );
}
