"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Dialog, ErrorState, TextField } from "@flyvan/ui";
import { apiRequest, readError } from "../lib/api";
import { useAdminSession } from "./require-session";
import { directionLabels, formatClock, formatWhen, tripStatusLabels } from "./operations-labels";

type TripCard = {
  id: string;
  reference: string;
  parentReference: string | null;
  direction: string;
  status: string;
  scheduledAt: string;
  arrivesAt: string;
  isDaily: boolean;
  destination: { name: string };
  passengerCount: number;
  vehiclesNeeded: number;
  seatShortfall: number;
  capacity: number | null;
  vehicles: { disabledAt: string | null }[];
  breakdownReportedAt: string | null;
  arrivalState?: "ON_TIME" | "LATE" | "STALLED";
};

type DestinationOption = { id: string; name: string; isActive: boolean };

function localDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function TripsAdmin() {
  const session = useAdminSession();
  const canDispatch = ["PLATFORM_OWNER", "ADMIN", "DISPATCHER"].includes(session.user.role);
  const isDriver = session.user.role === "DRIVER";
  const [items, setItems] = useState<TripCard[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState("scheduledAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [forbidden, setForbidden] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [destinations, setDestinations] = useState<DestinationOption[]>([]);
  const [tripForm, setTripForm] = useState({
    direction: "OUTBOUND",
    destinationId: "",
    serviceDate: "",
    departsAt: "07:30",
    arrivesAt: "08:15",
    isDaily: true,
    notes: "",
  });

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearch(searchDraft.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchDraft]);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      const query = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sort,
        direction,
      });
      if (search) query.set("q", search);
      const response = await apiRequest(`/api/trips?${query.toString()}`);
      if (cancelled) return;
      if (response.status === 403) {
        setForbidden("عرض الرحلات غير متاح لهذا الحساب.");
        setLoading(false);
        return;
      }
      if (!response.ok) {
        setError(await readError(response, "تعذر تحميل الرحلات."));
        setLoading(false);
        return;
      }
      const body = (await response.json()) as { items: TripCard[]; total: number };
      setItems(body.items);
      setTotal(body.total);
      setError("");
      setLoading(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, sort, direction, search, reloadKey]);

  async function openCreate(): Promise<void> {
    setError("");
    const departs = new Date();
    departs.setDate(departs.getDate() + 1);
    const response = await apiRequest("/api/destinations");
    const body = response.ok ? ((await response.json()) as { items: DestinationOption[] }) : { items: [] };
    const active = body.items.filter((item) => item.isActive);
    setDestinations(active);
    setTripForm({
      direction: "OUTBOUND",
      destinationId: active[0]?.id ?? "",
      serviceDate: localDateValue(departs),
      departsAt: "07:30",
      arrivesAt: "08:15",
      isDaily: true,
      notes: "",
    });
    setCreateOpen(true);
    if (!response.ok) setError(await readError(response, "تعذر تحميل الوجهات."));
  }

  async function createTrip(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const scheduled = new Date(`${tripForm.serviceDate}T${tripForm.departsAt}`);
    const arrives = new Date(`${tripForm.serviceDate}T${tripForm.arrivesAt}`);
    if (Number.isNaN(scheduled.getTime()) || Number.isNaN(arrives.getTime()) || arrives.getTime() <= scheduled.getTime()) {
      setError("وقت الوصول يجب أن يكون بعد وقت الانطلاق في تاريخ الرحلة نفسه.");
      return;
    }
    const response = await apiRequest("/api/trips", {
      method: "POST",
      body: JSON.stringify({
        direction: tripForm.direction,
        destinationId: tripForm.destinationId,
        scheduledAt: scheduled.toISOString(),
        arrivesAt: arrives.toISOString(),
        isDaily: tripForm.isDaily,
        notes: tripForm.notes,
      }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر إنشاء الرحلة."));
      return;
    }
    setCreateOpen(false);
    setMessage("أُنشئت الرحلة. افتح بطاقتها لربط المركبات وتوزيع حجوزات الغد.");
    setReloadKey((value) => value + 1);
  }

  if (forbidden) return <ErrorState title="الرحلات" description={forbidden} />;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <section className="grid gap-4">
      <header className="fv-page-head">
        <div>
          <h1>الرحلات</h1>
          <p>
            {isDriver
              ? "هذه رحلاتك الفرعية: كل واحدة لمركبة واحدة ومرة واحدة، وركابها هم من أكّدهم الكونترول."
              : "الرحلة الدائمة تُعرض كبطاقة. من داخلها تُختار مركبات الغد بحسب الحجوزات، ولكل مركبة رحلة فرعية لا تتجدد."}
          </p>
        </div>
        {canDispatch ? (
          <Button variant="teal" onClick={() => void openCreate()}>
            رحلة جديدة
          </Button>
        ) : null}
      </header>
      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="m-0 text-sm text-success">{message}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="fv-input max-w-xs"
          value={searchDraft}
          placeholder="بحث بالرقم أو الوجهة"
          aria-label="بحث في الرحلات"
          onChange={(event) => setSearchDraft(event.target.value)}
        />
        <select
          className="fv-input w-auto"
          value={String(pageSize)}
          aria-label="عدد البطاقات"
          onChange={(event) => {
            setPageSize(Number(event.target.value));
            setPage(1);
          }}
        >
          <option value="10">10</option>
          <option value="15">15</option>
          <option value="25">25</option>
        </select>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setSort("scheduledAt");
            setDirection((value) => (value === "asc" ? "desc" : "asc"));
            setPage(1);
          }}
        >
          الموعد {direction === "asc" ? "تصاعدي" : "تنازلي"}
        </Button>
      </div>
      {loading ? <p className="m-0 text-sm text-muted">جارٍ تحميل الرحلات.</p> : null}
      {!loading && items.length === 0 ? (
        <p className="m-0 text-sm text-muted">{isDriver ? "لا توجد رحلات فرعية مسندة إليك." : "لا توجد رحلات مطابقة."}</p>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        {items.map((trip) => {
          const activeVehicles = trip.vehicles.filter((vehicle) => !vehicle.disabledAt).length;
          const closed = ["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"].includes(trip.status);
          return (
            <Link key={trip.id} href={`/admin/trips/${trip.id}`} className="fv-card grid gap-2 p-4 no-underline">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{trip.reference}</strong>
                <span className="flex gap-2">
                  {!closed && (trip.breakdownReportedAt || trip.arrivalState === "STALLED") ? (
                    <span className="fv-badge fv-badge-danger">متعثرة</span>
                  ) : !closed && trip.arrivalState === "LATE" ? (
                    <span className="fv-badge fv-badge-warning">متأخرة</span>
                  ) : null}
                  <span className="fv-badge fv-badge-info">{tripStatusLabels[trip.status] ?? trip.status}</span>
                </span>
              </div>
              <div>
                {trip.destination.name}
                <span className="text-muted"> — {directionLabels[trip.direction] ?? trip.direction}</span>
              </div>
              <div className="text-sm text-muted">
                {trip.isDaily ? "رحلة دائمة" : "مرة واحدة"}
                {trip.parentReference ? ` من ${trip.parentReference}` : ""} — {formatWhen(trip.scheduledAt)} — الوصول {formatClock(trip.arrivesAt)}
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="fv-badge fv-badge-neutral">{trip.passengerCount} حجز</span>
                <span className="fv-badge fv-badge-neutral">{activeVehicles} مركبات مرتبطة</span>
                {trip.isDaily ? <span className="fv-badge fv-badge-success">يلزم {trip.vehiclesNeeded} للغد</span> : null}
                {trip.seatShortfall > 0 ? <span className="fv-badge fv-badge-warning">ينقص {trip.seatShortfall} مقعد</span> : null}
                {trip.capacity !== null && !trip.isDaily ? <span className="fv-badge fv-badge-neutral">{trip.capacity} مقاعد</span> : null}
              </div>
            </Link>
          );
        })}
      </div>
      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            السابق
          </Button>
          <span className="text-sm text-muted">
            {page} / {pageCount} — {total} رحلة
          </span>
          <Button type="button" variant="secondary" disabled={page >= pageCount} onClick={() => setPage((value) => value + 1)}>
            التالي
          </Button>
        </div>
      ) : null}

      <Dialog open={createOpen} title="رحلة جديدة" description="رحلة دائمة باتجاه واحد. توزيع الركاب على المركبات يتم لاحقًا لكل يوم." onClose={() => setCreateOpen(false)}>
        <form className="fv-dialog-layout" onSubmit={(event) => void createTrip(event)}>
          <div className="fv-dialog-scroll grid gap-4">
            {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
            <div className="fv-switch">
              <span className="fv-switch-copy">
                <span className="font-semibold">يومي</span>
                <span className="text-sm text-muted">الرحلة الدائمة تتكرر. رحلة كل مركبة في اليوم التالي تُنشأ مرة واحدة ولا تتجدد.</span>
              </span>
              <button
                type="button"
                className="fv-switch-control"
                role="switch"
                aria-checked={tripForm.isDaily}
                aria-label="رحلة يومية"
                onClick={() => setTripForm({ ...tripForm, isDaily: !tripForm.isDaily })}
              >
                <span />
              </button>
            </div>
            <label className="fv-field">
              <span className="fv-label">الاتجاه</span>
              <select className="fv-input" value={tripForm.direction} onChange={(event) => setTripForm({ ...tripForm, direction: event.target.value })}>
                <option value="OUTBOUND">ذهاب</option>
                <option value="RETURN">إياب</option>
              </select>
            </label>
            <label className="fv-field">
              <span className="fv-label">الوجهة</span>
              <select className="fv-input" required value={tripForm.destinationId} onChange={(event) => setTripForm({ ...tripForm, destinationId: event.target.value })}>
                {destinations.length === 0 ? <option value="">أضف وجهة من صفحة الوجهات أولًا.</option> : null}
                {destinations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fv-field">
              <span className="fv-label">تاريخ بداية الجدول</span>
              <input className="fv-input" type="date" required value={tripForm.serviceDate} onChange={(event) => setTripForm({ ...tripForm, serviceDate: event.target.value })} />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className="fv-field">
                <span className="fv-label">وقت الانطلاق</span>
                <input className="fv-input" type="time" required value={tripForm.departsAt} onChange={(event) => setTripForm({ ...tripForm, departsAt: event.target.value })} />
              </label>
              <label className="fv-field">
                <span className="fv-label">وقت الوصول</span>
                <input className="fv-input" type="time" required value={tripForm.arrivesAt} onChange={(event) => setTripForm({ ...tripForm, arrivesAt: event.target.value })} />
              </label>
            </div>
            <TextField label="ملاحظات" name="tripNotes" hint="اختياري." value={tripForm.notes} onChange={(event) => setTripForm({ ...tripForm, notes: event.target.value })} />
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit">حفظ الرحلة</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
