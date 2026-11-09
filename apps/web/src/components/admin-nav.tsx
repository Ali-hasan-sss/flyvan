"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavIcon } from "./nav-icon";

const groups = [
  {
    label: "التشغيل",
    items: [
      { href: "/admin", label: "نظرة عامة", icon: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></> },
      { href: "/admin/bookings", label: "الحجوزات", icon: <><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></> },
      { href: "/admin/trips", label: "الرحلات", icon: <><path d="M3 17h13l4-5H7z" /><path d="M7 17v2" /><path d="M16 17v2" /><circle cx="7.5" cy="19.5" r="1.5" /><circle cx="16.5" cy="19.5" r="1.5" /></> },
      { href: "/admin/destinations", label: "الوجهات", icon: <><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11z" /><circle cx="12" cy="10" r="2.5" /></> },
    ],
  },
  {
    label: "الأسطول",
    items: [
      { href: "/admin/drivers", label: "السائقون والمركبات", icon: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></> },
      { href: "/admin/areas", label: "مناطق الخدمة", icon: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" /></> },
    ],
  },
  {
    label: "المالية والإدارة",
    items: [
      { href: "/admin/finance", label: "المالية", icon: <><rect x="3" y="6" width="18" height="13" rx="2" /><path d="M3 10h18" /><path d="M7 15h4" /></> },
      { href: "/admin/audit", label: "سجل التدقيق", icon: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M8 13h8" /><path d="M8 17h5" /></> },
      { href: "/admin/users", label: "المستخدمون", icon: <><path d="M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4z" /><path d="M4 20a8 8 0 0 1 16 0" /></> },
    ],
  },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="أقسام الإدارة" className="fv-nav">
      {groups.map((group) => (
        <div key={group.label} className="fv-nav-group">
          <p className="fv-nav-label">{group.label}</p>
          {group.items.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === item.href
                : item.href === "/admin/drivers"
                  ? pathname.startsWith(item.href) || pathname.startsWith("/admin/vehicles")
                  : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className="fv-nav-link">
                <NavIcon>{item.icon}</NavIcon>
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
