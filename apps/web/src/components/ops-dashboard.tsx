"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, ErrorState } from "@flyvan/ui";
import { apiRequest } from "../lib/api";
import { bookingStatusLabels, formatWhen, tripStatusLabels } from "./operations-labels";

type TripRow = {
  id: string;
  reference: string;
  status: string;
  scheduledAt: string;
  destination: { name: string };
  passengerCount: number;
};

type BookingRow = {
  id: string;
  reference: string;
  status: string;
  passengerName: string;
  scheduledAt: string;
  legs: { destinationName: string }[];
};

type DriverRow = {
  id: string;
  displayName: string;
  approvalStatus: string;
  assignmentBlocked: boolean;
  userStatus: string;
};

type BreakdownRow = { id: string; reference: string; breakdownNote: string | null; destination: { name: string } };

type Page<T> = { items: T[]; total: number };

type Snapshot = {
  trips: Page<TripRow> | null;
  bookings: Page<BookingRow> | null;
  drivers: Page<DriverRow> | null;
  breakdowns: BreakdownRow[];
  denied: string[];
};

type Tone = "info" | "success" | "warning" | "danger" | "neutral";

const tripTones: Record<string, Tone> = {
  IN_PROGRESS: "info",
  COMPLETED: "success",
  ASSIGNED: "info",
  DRIVER_ARRIVED: "info",
  PENDING_ASSIGNMENT: "warning",
  OFFERED: "warning",
  CANCELLED: "danger",
  NO_SHOW: "danger",
  DISPUTED: "warning",
};

const activeStatuses = new Set(["IN_PROGRESS", "ASSIGNED", "DRIVER_ARRIVED"]);
const waitingStatuses = new Set(["PENDING_ASSIGNMENT", "OFFERED"]);

function countStatus(items: TripRow[], status: string): number {
  return items.filter((item) => item.status === status).length;
}

async function readPage<T>(path: string): Promise<{ ok: true; page: Page<T> } | { ok: false; status: number }> {
  const response = await apiRequest(path);
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, page: (await response.json()) as Page<T> };
}

export function OpsDashboard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [trips, bookings, drivers, breakdowns] = await Promise.all([
          readPage<TripRow>("/api/trips?page=1&pageSize=100&sort=scheduledAt&direction=desc"),
          readPage<BookingRow>("/api/bookings?page=1&pageSize=8&sort=createdAt&direction=desc"),
          readPage<DriverRow>("/api/drivers?page=1&pageSize=100&sort=createdAt&direction=desc"),
          apiRequest("/api/trips/breakdowns"),
        ]);
        if (cancelled) return;
        const denied: string[] = [];
        if (!trips.ok && trips.status === 403) denied.push("الرحلات");
        if (!bookings.ok && bookings.status === 403) denied.push("الحجوزات");
        if (!drivers.ok && drivers.status === 403) denied.push("السائقون");
        const breakdownBody = breakdowns.ok ? ((await breakdowns.json()) as { items: BreakdownRow[] }) : { items: [] };
        setSnapshot({
          trips: trips.ok ? trips.page : null,
          bookings: bookings.ok ? bookings.page : null,
          drivers: drivers.ok ? drivers.page : null,
          breakdowns: breakdownBody.items,
          denied,
        });
      } catch {
        if (!cancelled) setFailed("تعذر تحميل ملخص التشغيل.");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) return <ErrorState title="تعذر فتح النظرة العامة" description={failed} />;
  if (!snapshot) {
    return (
      <div className="fv-dash" role="status" aria-live="polite" aria-busy="true">
        <p className="m-0 text-sm text-muted">جارٍ تحميل ملخص التشغيل.</p>
        <div className="fv-dash-kpis">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="fv-card grid gap-3 p-4">
              <span className="fv-skeleton w-24" />
              <span className="fv-skeleton h-8 w-16" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const trips = snapshot.trips;
  const tripItems = trips?.items ?? [];
  const tripSampleIncomplete = Boolean(trips && trips.total > tripItems.length);
  const drivers = snapshot.drivers;
  const driverItems = drivers?.items ?? [];
  const available = driverItems.filter(
    (driver) => driver.approvalStatus === "APPROVED" && !driver.assignmentBlocked && driver.userStatus === "ACTIVE",
  ).length;
  const driverSampleIncomplete = Boolean(drivers && drivers.total > driverItems.length);
  const running = countStatus(tripItems, "IN_PROGRESS");
  const waiting = tripItems.filter((item) => waitingStatuses.has(item.status));
  const active = tripItems.filter((item) => activeStatuses.has(item.status));
  const pendingBookings = (snapshot.bookings?.items ?? []).filter((item) => item.status === "PENDING" || item.status === "DRAFT");
  const statusOrder = ["IN_PROGRESS", "ASSIGNED", "PENDING_ASSIGNMENT", "COMPLETED", "CANCELLED"];
  const distribution = statusOrder
    .map((status) => ({ status, count: countStatus(tripItems, status) }))
    .filter((item) => item.count > 0);
  const distributionTotal = distribution.reduce((sum, item) => sum + item.count, 0);
  const sampleHint = tripSampleIncomplete ? `ضمن أول ${tripItems.length} رحلة` : "من الرحلات المحمّلة";
  const urgentCount = snapshot.breakdowns.length + waiting.length + pendingBookings.length;

  return (
    <section className="fv-dash">
      <header className="fv-dash-head">
        <div>
          <p className="fv-kicker">لوحة التشغيل</p>
          <h1>ما يحتاج متابعة الآن</h1>
          <p>الإجراءات العاجلة في الأعلى، ثم الأرقام والسجلات. مبالغ العمولة والتسديد تُحسب في المالية بعد اعتماد الرحلة.</p>
        </div>
        <div className="fv-dash-actions">
          <Link className="fv-button fv-button-primary no-underline" href="/admin/bookings">
            الحجوزات
          </Link>
          <Link className="fv-button fv-button-secondary no-underline" href="/admin/trips">
            الرحلات
          </Link>
        </div>
      </header>

      {snapshot.denied.length > 0 ? (
        <p className="fv-dash-denied" role="status">
          بعض الأقسام غير متاحة لهذا الدور: {snapshot.denied.join("، ")}.
        </p>
      ) : null}

      <div className="fv-dash-kpis">
        <Metric
          label="رحلات متعثرة"
          value={String(snapshot.breakdowns.length)}
          hint="مفتوحة وتحتاج متابعة"
          href="/admin/trips"
          tone={snapshot.breakdowns.length > 0 ? "danger" : "neutral"}
        />
        <Metric
          label="بانتظار الإسناد"
          value={trips ? String(waiting.length) : "—"}
          hint={trips ? sampleHint : "الرحلات غير متاحة"}
          href="/admin/trips"
          tone={waiting.length > 0 ? "warning" : "neutral"}
        />
        <Metric
          label="رحلات جارية"
          value={trips ? String(running) : "—"}
          hint={trips ? sampleHint : "الرحلات غير متاحة"}
          href="/admin/trips"
          tone={running > 0 ? "info" : "neutral"}
        />
        <Metric
          label="سائقون متاحون"
          value={drivers ? String(available) : "—"}
          hint={
            drivers
              ? driverSampleIncomplete
                ? `معتمدون وغير موقوفين ضمن أول ${driverItems.length}`
                : "معتمدون وحسابهم نشط وغير موقوفين"
              : "السائقون غير متاحين"
          }
          href="/admin/drivers"
          tone="success"
        />
      </div>

      <div className="fv-dash-work">
        <article className="fv-card fv-dash-panel">
          <div className="fv-dash-panel-head">
            <h2>يتطلب إجراء</h2>
            <Badge tone={urgentCount > 0 ? "warning" : "success"}>{urgentCount}</Badge>
          </div>
          {urgentCount === 0 ? (
            <p className="fv-dash-empty">لا يوجد إجراء عاجل ضمن البيانات المحمّلة.</p>
          ) : (
            <ul className="fv-dash-queue">
              {snapshot.breakdowns.map((item) => (
                <li key={`breakdown-${item.id}`}>
                  <Link href={`/admin/trips/${item.id}`}>
                    <span>
                      <strong>عطل: {item.reference}</strong>
                      <small>
                        {item.destination.name}
                        {item.breakdownNote ? ` · ${item.breakdownNote}` : ""}
                      </small>
                    </span>
                    <Badge tone="danger">متعثر</Badge>
                  </Link>
                </li>
              ))}
              {waiting.slice(0, 4).map((item) => (
                <li key={`waiting-${item.id}`}>
                  <Link href={`/admin/trips/${item.id}`}>
                    <span>
                      <strong>{item.reference}</strong>
                      <small>
                        {item.destination.name} · {formatWhen(item.scheduledAt)}
                      </small>
                    </span>
                    <Badge tone="warning">{tripStatusLabels[item.status] ?? item.status}</Badge>
                  </Link>
                </li>
              ))}
              {pendingBookings.slice(0, 3).map((item) => (
                <li key={`booking-${item.id}`}>
                  <Link href="/admin/bookings">
                    <span>
                      <strong>
                        {item.reference} — {item.passengerName}
                      </strong>
                      <small>
                        {item.legs[0]?.destinationName ?? "بدون وجهة"} · {formatWhen(item.scheduledAt)}
                      </small>
                    </span>
                    <Badge tone="warning">{bookingStatusLabels[item.status] ?? item.status}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="fv-card fv-dash-panel">
          <div className="fv-dash-panel-head">
            <h2>حالات الرحلات المحمّلة</h2>
          </div>
          {distributionTotal === 0 ? (
            <p className="fv-dash-empty">{trips ? "لا توجد رحلات بعد." : "عرض الرحلات غير متاح لهذا الدور."}</p>
          ) : (
            <>
              <p className="fv-dash-hint">
                {tripSampleIncomplete ? `العينة ${tripItems.length} من ${trips?.total}.` : "تشمل كل الرحلات المعادة في هذا التحميل."}
              </p>
              <div className="fv-dash-bar" aria-hidden="true">
                {distribution.map((item) => (
                  <span key={item.status} className={barClass(item.status)} style={{ width: `${(item.count / distributionTotal) * 100}%` }} />
                ))}
              </div>
              <ul className="fv-dash-legend">
                {distribution.map((item) => (
                  <li key={item.status}>
                    <span className={barClass(item.status)} aria-hidden="true" />
                    {tripStatusLabels[item.status] ?? item.status}: {item.count}
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="fv-dash-hint">
            الحجوزات المسجّلة: {snapshot.bookings ? snapshot.bookings.total : "غير متاحة"}. بانتظار التأكيد ضمن المعروض: {pendingBookings.length}.
          </p>
        </article>
      </div>

      <div className="fv-dash-lists">
        <RecordList
          title="رحلات نشطة"
          href="/admin/trips"
          empty={trips ? "لا توجد رحلة معينة أو جارية ضمن التحميل." : "عرض الرحلات غير متاح لهذا الدور."}
          rows={active.slice(0, 5).map((item) => ({
            id: item.id,
            href: `/admin/trips/${item.id}`,
            title: `${item.reference} — ${item.destination.name}`,
            meta: `${item.passengerCount} حجوزات · ${formatWhen(item.scheduledAt)}`,
            badge: tripStatusLabels[item.status] ?? item.status,
            tone: tripTones[item.status] ?? "neutral",
          }))}
        />
        <RecordList
          title="أحدث الحجوزات"
          href="/admin/bookings"
          empty={snapshot.bookings ? "لا توجد حجوزات بعد." : "عرض الحجوزات غير متاح لهذا الدور."}
          rows={(snapshot.bookings?.items ?? []).slice(0, 5).map((item) => ({
            id: item.id,
            href: "/admin/bookings",
            title: `${item.reference} — ${item.passengerName}`,
            meta: `${item.legs[0]?.destinationName ?? "بدون وجهة"} · ${formatWhen(item.scheduledAt)}`,
            badge: bookingStatusLabels[item.status] ?? item.status,
            tone: item.status === "CANCELLED" ? "danger" : item.status === "CONFIRMED" ? "success" : "warning",
          }))}
        />
      </div>

      <p className="fv-dash-finance">
        أجرة الراكب النقدية لا تُحسب تسديدًا. الرصيد في المالية يأتي من قيود العمولة والدفعات المعتمدة.{" "}
        <Link href="/admin/finance">فتح المالية</Link>
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  hint,
  href,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  href: string;
  tone: Tone;
}) {
  return (
    <Link href={href} className={`fv-metric fv-metric-${tone} no-underline`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </Link>
  );
}

function RecordList({
  title,
  href,
  empty,
  rows,
}: {
  title: string;
  href: string;
  empty: string;
  rows: { id: string; href: string; title: string; meta: string; badge: string; tone: Tone }[];
}) {
  return (
    <article className="fv-card fv-dash-panel">
      <div className="fv-dash-panel-head">
        <h2>{title}</h2>
        <Link href={href}>عرض الكل</Link>
      </div>
      {rows.length === 0 ? (
        <p className="fv-dash-empty">{empty}</p>
      ) : (
        <ul className="fv-dash-queue">
          {rows.map((row) => (
            <li key={row.id}>
              <Link href={row.href}>
                <span>
                  <strong>{row.title}</strong>
                  <small>{row.meta}</small>
                </span>
                <Badge tone={row.tone}>{row.badge}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function barClass(status: string): string {
  if (status === "COMPLETED") return "is-success";
  if (status === "CANCELLED" || status === "NO_SHOW") return "is-danger";
  if (status === "PENDING_ASSIGNMENT" || status === "OFFERED" || status === "DISPUTED") return "is-warning";
  return "is-info";
}
