"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiRequest } from "../lib/api";
import { useAdminSession } from "./require-session";

type BreakdownItem = {
  id: string;
  reference: string;
  breakdownNote: string | null;
  arrivalState?: "ON_TIME" | "LATE" | "STALLED";
  destination: { name: string };
};

export function BreakdownNotice() {
  const session = useAdminSession();
  const canDispatch = ["PLATFORM_OWNER", "ADMIN", "DISPATCHER"].includes(session.user.role);
  const [items, setItems] = useState<BreakdownItem[]>([]);

  useEffect(() => {
    if (!canDispatch) return;
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const response = await apiRequest("/api/trips/breakdowns");
        if (cancelled || !response.ok) return;
        const body = (await response.json()) as { items: BreakdownItem[] };
        setItems(body.items);
      } catch {
        if (!cancelled) setItems([]);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canDispatch]);

  if (!canDispatch || items.length === 0) return null;

  return (
    <section className="fv-card fv-alert-breakdown mb-4 grid gap-2 p-4" role="status" aria-live="polite">
      <strong>تعثرت {items.length === 1 ? "رحلة" : `${items.length} رحلات`}</strong>
      <p className="m-0 text-sm">
        رحلة تجاوزت ساعة بعد وقت الوصول، أو أبلغ سائقها عن عطل. ألغِها من صفحتها، ثم نسّق مع سائق بديل هاتفيًا. الإسناد البديل خارج النظام.
      </p>
      <ul className="m-0 grid gap-1 p-0">
        {items.map((item) => (
          <li key={item.id}>
            <Link href={`/admin/trips/${item.id}`}>
              {item.reference} — {item.destination.name}
              {` — ${item.breakdownNote ?? (item.arrivalState === "STALLED" ? "تجاوزت ساعة بعد وقت الوصول" : "تعثرت")}`}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
