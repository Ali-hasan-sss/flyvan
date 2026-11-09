"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Brand } from "./brand";
import { AdminNav } from "./admin-nav";
import { AdminTopbar } from "./admin-topbar";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="fv-shell">
      {open ? (
        <button type="button" className="fv-backdrop" aria-label="إغلاق القائمة" onClick={() => setOpen(false)} />
      ) : null}
      <aside id="admin-sidebar" className={open ? "fv-sidebar is-open" : "fv-sidebar"}>
        <Brand href="/admin" />
        <p className="fv-sidebar-note">التشغيل اليومي من الشركة مباشرة</p>
        <AdminNav />
      </aside>
      <div className="fv-main">
        <AdminTopbar menuOpen={open} onMenu={() => setOpen((current) => !current)} />
        <div className="fv-content">{children}</div>
      </div>
    </div>
  );
}
