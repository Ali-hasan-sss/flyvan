"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "@flyvan/ui";
import { apiRequest, readError } from "../lib/api";
import { formatDamascusClock, formatDamascusDay } from "../lib/damascus-time";
import { directionLabels, tripStatusLabels } from "./operations-labels";

type TripRow = {
  id: string;
  reference: string;
  direction: string;
  status: string;
  scheduledAt: string;
  arrivesAt: string;
  arrivalState: "ON_TIME" | "LATE" | "STALLED";
  isDaily: boolean;
  parentTripId: string | null;
  destination: { name: string };
  plateNumber: string | null;
  passengerCount: number;
  vehicles: { driverProfileId: string; plateNumber: string; disabledAt: string | null }[];
};

const openStatuses = new Set(["ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"]);
const closedStatuses = new Set(["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"]);

function badgeClass(status: string): string {
  if (status === "COMPLETED") return "fv-badge fv-badge-success";
  if (status === "CANCELLED" || status === "NO_SHOW" || status === "DISPUTED") return "fv-badge fv-badge-danger";
  if (status === "IN_PROGRESS" || status === "DRIVER_ARRIVED") return "fv-badge fv-badge-info";
  return "fv-badge fv-badge-neutral";
}

function plateFor(trip: TripRow, driverId: string): string {
  const linked = trip.vehicles.find((vehicle) => vehicle.driverProfileId === driverId && !vehicle.disabledAt);
  return linked?.plateNumber ?? trip.plateNumber ?? "—";
}

export function DriverTripSchedule({ driverId }: { driverId: string }) {
  const [upcoming, setUpcoming] = useState<TripRow[]>([]);
  const [previous, setPrevious] = useState<TripRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      const items: TripRow[] = [];
      let page = 1;
      let total = 0;
      try {
        do {
          const response = await apiRequest(
            `/api/trips?driverId=${encodeURIComponent(driverId)}&page=${page}&pageSize=100&sort=scheduledAt&direction=desc`,
          );
          if (!response.ok) {
            if (active) setError(await readError(response, "تعذر قراءة رحلات السائق."));
            return;
          }
          const body = (await response.json()) as { items?: TripRow[]; total?: number };
          items.push(...(body.items ?? []));
          total = body.total ?? items.length;
          page += 1;
        } while (items.length < total && page <= 5);
        if (!active) return;
        const assigned = items.filter((trip) => openStatuses.has(trip.status) || closedStatuses.has(trip.status));
        setUpcoming(assigned.filter((trip) => openStatuses.has(trip.status)).sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)));
        setPrevious(assigned.filter((trip) => !openStatuses.has(trip.status)).sort((left, right) => right.scheduledAt.localeCompare(left.scheduledAt)));
        setError("");
      } catch {
        if (active) setError("تعذر الوصول إلى الخادم.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [driverId]);

  return (
    <Card className="grid gap-4 p-4">
      <div>
        <h2 className="m-0 text-lg">جدول الرحلات</h2>
        <p className="m-0 mt-1 text-sm text-muted">الرحلات المسندة إلى هذا السائق، التالية والسابقة. التوقيت بتوقيت دمشق.</p>
      </div>
      {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
      {loading ? <p className="m-0 text-sm text-muted">جارٍ تحميل الرحلات.</p> : null}
      <ScheduleTable title="الرحلات التالية" empty="لا توجد رحلة تالية مسندة إليه." rows={upcoming} driverId={driverId} />
      <ScheduleTable title="الرحلات السابقة" empty="لا توجد رحلات سابقة." rows={previous} driverId={driverId} />
    </Card>
  );
}

function ScheduleTable({ title, empty, rows, driverId }: { title: string; empty: string; rows: TripRow[]; driverId: string }) {
  return (
    <div className="grid gap-2">
      <h3 className="m-0 text-base">{title}</h3>
      {rows.length === 0 ? <p className="m-0 text-sm text-muted">{empty}</p> : (
        <div className="fv-table-wrap">
          <table className="fv-table">
            <thead>
              <tr>
                <th>اليوم</th>
                <th>الوجهة</th>
                <th>الانطلاق</th>
                <th>الوصول</th>
                <th>المركبة</th>
                <th>الركاب</th>
                <th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((trip) => {
                const kind = trip.isDaily && !trip.parentTripId ? "يومية" : directionLabels[trip.direction] ?? trip.direction;
                const closed = closedStatuses.has(trip.status);
                const late = !closed && trip.arrivalState === "LATE";
                const stalled = !closed && trip.arrivalState === "STALLED";
                return (
                  <tr key={trip.id}>
                    <td>
                      <Link href={`/admin/trips/${trip.id}`}>{formatDamascusDay(trip.scheduledAt)}</Link>
                      <div className="text-sm text-muted">{trip.reference} · {kind}</div>
                    </td>
                    <td>{trip.destination.name}</td>
                    <td className="whitespace-nowrap">{formatDamascusClock(trip.scheduledAt)}</td>
                    <td className="whitespace-nowrap">{formatDamascusClock(trip.arrivesAt)}</td>
                    <td className="whitespace-nowrap">{plateFor(trip, driverId)}</td>
                    <td>{trip.passengerCount}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <span className={`${badgeClass(trip.status)} whitespace-nowrap`}>{tripStatusLabels[trip.status] ?? trip.status}</span>
                        {stalled ? <span className="fv-badge fv-badge-danger">متعثرة</span> : null}
                        {late ? <span className="fv-badge fv-badge-warning">متأخرة</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
