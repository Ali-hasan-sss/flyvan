"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

type DialogProps = {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
};

export function Dialog({ open, title, description, children, onClose, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={["fv-dialog", className].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <header className="fv-dialog-header">
        <div>
          <p className="fv-dialog-kicker">فلاي فان</p>
          <h2 id={titleId} className="fv-dialog-title">
            {title}
          </h2>
          {description ? <p className="fv-dialog-copy">{description}</p> : null}
        </div>
        <button type="button" className="fv-icon-button" aria-label="إغلاق" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="fv-dialog-slot">{children}</div>
    </dialog>
  );
}
