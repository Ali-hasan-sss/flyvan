"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@flyvan/ui";
import { logoutRequest } from "../lib/api";
import { roleLabels } from "../lib/roles";
import { useAdminSession } from "./require-session";

const sectionTitles: { prefix: string; title: string }[] = [
  { prefix: "/admin/bookings", title: "الحجوزات" },
  { prefix: "/admin/trips", title: "الرحلات" },
  { prefix: "/admin/destinations", title: "الوجهات" },
  { prefix: "/admin/drivers", title: "السائقون والمركبات" },
  { prefix: "/admin/vehicles", title: "المركبات" },
  { prefix: "/admin/areas", title: "مناطق الخدمة" },
  { prefix: "/admin/finance", title: "المالية" },
  { prefix: "/admin/audit", title: "سجل التدقيق" },
  { prefix: "/admin/users", title: "المستخدمون" },
];

export function AdminTopbar({ menuOpen, onMenu }: { menuOpen: boolean; onMenu: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useAdminSession();
  const initial = session.user.displayName.trim().slice(0, 1);
  const section = pathname === "/admin" ? "نظرة عامة" : (sectionTitles.find((item) => pathname.startsWith(item.prefix))?.title ?? "لوحة التشغيل");

  return (
    <header className="fv-topbar">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="fv-button fv-button-secondary fv-menu-button"
          aria-expanded={menuOpen}
          aria-controls="admin-sidebar"
          onClick={onMenu}
        >
          القائمة
        </button>
        <p className="m-0 text-sm font-semibold text-ink">{section}</p>
      </div>
      <div className="flex items-center gap-3">
        <p className="fv-user-chip">
          <span className="fv-avatar" aria-hidden="true">
            {initial}
          </span>
          <span>
            <span className="fv-user-name">{session.user.displayName}</span>
            <span className="fv-user-role">{roleLabels[session.user.role] ?? session.user.role}</span>
          </span>
        </p>
        <Button
          variant="secondary"
          onClick={() => {
            void logoutRequest().finally(() => {
              router.replace("/login");
              router.refresh();
            });
          }}
        >
          تسجيل الخروج
        </Button>
      </div>
    </header>
  );
}
