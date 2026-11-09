import type { ReactNode } from "react";

export function NavIcon({ children }: { children: ReactNode }) {
  return (
    <svg className="fv-nav-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}
