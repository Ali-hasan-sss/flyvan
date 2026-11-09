"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Button, Dialog, ErrorState, TextField } from "@flyvan/ui";
import { apiRequest, readError } from "../lib/api";
import { useAdminSession } from "./require-session";
import { formatDamascusClock, formatDamascusDay, formatDamascusRange, tripLogRange, type TripLogPeriod } from "../lib/damascus-time";
import { directionLabels, formatClock, formatFare, formatWhen, tripStatusLabels } from "./operations-labels";

const MapPicker = dynamic(() => import("./map-picker").then((mod) => mod.MapPicker), { ssr: false });

type TripPassenger = {
  id: string;
  name: string;
  phone: string;
  boardingStatus: string;
  pickupLatitude: string | null;
  pickupLongitude: string | null;
  pickupAt: string | null;
  fareAmount: string | null;
  fareCurrency: string | null;
  farePaidToCompany: boolean;
};

type LinkedVehicle = {
  id: string;
  vehicleId: string;
  plateNumber: string;
  capacity: number;
  driverProfileId: string;
  driverName: string;
  disabledAt: string | null;
};

type TripDetailItem = {
  id: string;
  reference: string;
  parentTripId: string | null;
  parentReference: string | null;
  direction: string;
  status: string;
  scheduledAt: string;
  arrivesAt: string;
  isDaily: boolean;
  originLatitude: string | null;
  originLongitude: string | null;
  notes: string | null;
  destination: {
    id: string;
    name: string;
    latitude: string;
    longitude: string;
    addressNote: string | null;
    notes: string | null;
  };
  passengerCount: number;
  vehiclesNeeded: number;
  seatShortfall: number;
  capacity: number | null;
  vehicles: LinkedVehicle[];
  passengerFareCollectedAt: string | null;
  breakdownReportedAt: string | null;
  breakdownNote: string | null;
  arrivalState?: "ON_TIME" | "LATE" | "STALLED";
  passengers: TripPassenger[];
  runs?: TripDetailItem[];
};

type Candidate = { id: string; displayName: string; plateNumber: string; vehicleId: string };
type DestinationOption = { id: string; name: string; isActive: boolean };
type RunPreview = {
  capacity: number;
  driverName: string;
  plateNumber: string;
  suggestedIds: string[];
  passengers: { id: string; name: string; phone: string; distanceMeters: number | null; suggested: boolean; assignedElsewhere: boolean }[];
};

const closedTripStatuses = new Set(["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"]);
const arrivalFilterLabels: Record<string, string> = { ON_TIME: "في الوقت", LATE: "متأخرة", STALLED: "متعثرة" };
const logPeriods: { id: TripLogPeriod; label: string }[] = [
  { id: "all", label: "كل الرحلات" },
  { id: "today", label: "رحلات اليوم" },
  { id: "tomorrow", label: "رحلات الغد" },
  { id: "lastWeek", label: "رحلات الأسبوع الماضي" },
  { id: "lastMonth", label: "رحلات الشهر الماضي" },
];

function assignedVehicle(run: TripDetailItem): LinkedVehicle | undefined {
  return run.vehicles.find((vehicle) => !vehicle.disabledAt) ?? run.vehicles[0];
}

const controlMoves: Record<string, { value: string; label: string }[]> = {
  PENDING_ASSIGNMENT: [{ value: "CANCELLED", label: "إلغاء" }],
  OFFERED: [{ value: "CANCELLED", label: "إلغاء" }],
  ASSIGNED: [
    { value: "DRIVER_ARRIVED", label: "وصل السائق" },
    { value: "NO_SHOW", label: "عدم حضور" },
    { value: "CANCELLED", label: "إلغاء" },
  ],
  DRIVER_ARRIVED: [
    { value: "IN_PROGRESS", label: "بدء الرحلة" },
    { value: "NO_SHOW", label: "عدم حضور" },
    { value: "CANCELLED", label: "إلغاء" },
  ],
  IN_PROGRESS: [
    { value: "COMPLETED", label: "إكمال" },
    { value: "DISPUTED", label: "نزاع" },
  ],
  COMPLETED: [{ value: "DISPUTED", label: "نزاع" }],
};

const driverMoves: Record<string, { value: string; label: string }[]> = {
  ASSIGNED: [
    { value: "DRIVER_ARRIVED", label: "وصلت" },
    { value: "NO_SHOW", label: "لم يحضر الراكب" },
  ],
  DRIVER_ARRIVED: [
    { value: "IN_PROGRESS", label: "بدء الرحلة" },
    { value: "NO_SHOW", label: "لم يحضر الراكب" },
  ],
  IN_PROGRESS: [{ value: "COMPLETED", label: "إنهاء الرحلة" }],
};

const boardingLabels: Record<string, string> = {
  EXPECTED: "متوقع",
  BOARDED: "صعد",
  NO_SHOW: "لم يحضر",
  CANCELLED: "ملغى",
};

const closedTrips = new Set(["COMPLETED", "CANCELLED", "NO_SHOW", "DISPUTED"]);
const editableTrips = new Set(["PENDING_ASSIGNMENT", "OFFERED", "ASSIGNED", "DRIVER_ARRIVED"]);

function clockValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function tomorrowValue(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDateValue(date);
}

function formatMeters(meters: number | null): string {
  if (meters === null) return "بلا موقع";
  if (meters < 1000) return `${meters} م`;
  return `${(meters / 1000).toFixed(1)} كم`;
}

export function TripDetail({ tripId }: { tripId: string }) {
  const router = useRouter();
  const session = useAdminSession();
  const canDispatch = ["PLATFORM_OWNER", "ADMIN", "DISPATCHER"].includes(session.user.role);
  const [trip, setTrip] = useState<TripDetailItem | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [driverId, setDriverId] = useState("");
  const [editing, setEditing] = useState(false);
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; reference: string } | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [serviceDate, setServiceDate] = useState(tomorrowValue);
  const [runVehicleId, setRunVehicleId] = useState<string | null>(null);
  const [logPeriod, setLogPeriod] = useState<TripLogPeriod>("all");
  const [logVehicleId, setLogVehicleId] = useState("");
  const [logDriverId, setLogDriverId] = useState("");
  const [logStatus, setLogStatus] = useState("");
  const [logArrival, setLogArrival] = useState("");
  const [logQuery, setLogQuery] = useState("");
  const [origin, setOrigin] = useState({ latitude: "", longitude: "" });
  const [preview, setPreview] = useState<RunPreview | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [nextStatus, setNextStatus] = useState("");
  const [reason, setReason] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!tripId) return;
    let cancelled = false;
    async function load(): Promise<void> {
      const response = await apiRequest(`/api/trips/${tripId}`);
      if (cancelled) return;
      if (!response.ok) {
        setTrip(null);
        setError(await readError(response, "تعذر فتح الرحلة."));
        setLoading(false);
        return;
      }
      const body = (await response.json()) as TripDetailItem;
      setTrip(body);
      setError("");
      setLoading(false);
      const moves = (canDispatch ? controlMoves : driverMoves)[body.status] ?? [];
      setNextStatus(moves[0]?.value ?? "");
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [tripId, reloadKey, canDispatch]);

  useEffect(() => {
    if (!canDispatch) return;
    let cancelled = false;
    async function loadCandidates(): Promise<void> {
      const response = await apiRequest("/api/trips/candidates");
      if (cancelled || !response.ok) return;
      const body = (await response.json()) as { items: Candidate[] };
      setCandidates(body.items);
      setDriverId((current) => current || body.items[0]?.id || "");
    }
    void loadCandidates();
    return () => {
      cancelled = true;
    };
  }, [canDispatch]);

  const template = Boolean(trip?.isDaily && !trip.parentTripId);
  const moves = trip ? ((canDispatch ? controlMoves : driverMoves)[trip.status] ?? []) : [];
  const activeVehicles = trip?.vehicles.filter((vehicle) => !vehicle.disabledAt) ?? [];
  const runs = trip?.runs ?? [];
  const logVehicles = useMemo(() => {
    const byId = new Map<string, string>();
    for (const vehicle of trip?.vehicles ?? []) byId.set(vehicle.vehicleId, vehicle.plateNumber);
    for (const run of runs) {
      const vehicle = assignedVehicle(run);
      if (vehicle) byId.set(vehicle.vehicleId, vehicle.plateNumber);
    }
    return [...byId.entries()].map(([id, plateNumber]) => ({ id, plateNumber }));
  }, [trip?.vehicles, runs]);
  const logDrivers = useMemo(() => {
    const byId = new Map<string, { name: string; plates: string[] }>();
    const add = (id: string, name: string, plate: string) => {
      const current = byId.get(id) ?? { name, plates: [] };
      if (!current.plates.includes(plate)) current.plates.push(plate);
      byId.set(id, current);
    };
    for (const vehicle of trip?.vehicles ?? []) add(vehicle.driverProfileId, vehicle.driverName, vehicle.plateNumber);
    for (const run of runs) {
      const vehicle = assignedVehicle(run);
      if (vehicle) add(vehicle.driverProfileId, vehicle.driverName, vehicle.plateNumber);
    }
    return [...byId.entries()].map(([id, value]) => ({ id, name: `${value.name} — ${value.plates.join("، ")}` }));
  }, [trip?.vehicles, runs]);
  const logRange = useMemo(() => (logPeriod === "all" ? null : tripLogRange(logPeriod)), [logPeriod]);
  const filteredRuns = useMemo(() => {
    const query = logQuery.trim();
    return runs.filter((run) => {
      const vehicle = assignedVehicle(run);
      if (logRange) {
        const at = new Date(run.scheduledAt).getTime();
        if (at < logRange.start.getTime() || at >= logRange.end.getTime()) return false;
      }
      if (logVehicleId && vehicle?.vehicleId !== logVehicleId) return false;
      if (logDriverId && vehicle?.driverProfileId !== logDriverId) return false;
      if (logStatus && run.status !== logStatus) return false;
      if (logArrival && (closedTripStatuses.has(run.status) || run.arrivalState !== logArrival)) return false;
      if (!query) return true;
      const haystack = [run.reference, vehicle?.plateNumber, vehicle?.driverName].filter(Boolean).join(" ");
      return haystack.includes(query);
    });
  }, [runs, logRange, logVehicleId, logDriverId, logStatus, logArrival, logQuery]);

  async function reload(note: string): Promise<void> {
    setMessage(note);
    setError("");
    setReloadKey((value) => value + 1);
  }

  async function linkVehicle(): Promise<void> {
    if (!trip || !driverId) return;
    const response = await apiRequest(`/api/trips/${trip.id}/vehicles`, {
      method: "POST",
      body: JSON.stringify({ driverProfileId: driverId }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر ربط المركبة."));
      return;
    }
    await reload("رُبطت المركبة بالرحلة. يمكن اختيارها لرحلة الغد إذا لزم ذلك.");
  }

  async function unlinkVehicle(vehicleId: string): Promise<void> {
    if (!trip) return;
    const response = await apiRequest(`/api/trips/${trip.id}/vehicles/${vehicleId}`, { method: "DELETE" });
    if (!response.ok) {
      setError(await readError(response, "تعذر إقصاء المركبة."));
      return;
    }
    if (runVehicleId === vehicleId) {
      setRunVehicleId(null);
      setPreview(null);
    }
    await reload("أُقصيت المركبة من الرحلة.");
  }

  async function openEdit(): Promise<void> {
    if (!trip) return;
    const response = await apiRequest("/api/destinations");
    const body = response.ok ? ((await response.json()) as { items: DestinationOption[] }) : { items: [] };
    setDestinations(body.items.filter((item) => item.isActive || item.id === trip.destination.id));
    const scheduled = new Date(trip.scheduledAt);
    setTripForm({
      direction: trip.direction,
      destinationId: trip.destination.id,
      serviceDate: localDateValue(scheduled),
      departsAt: clockValue(trip.scheduledAt),
      arrivesAt: clockValue(trip.arrivesAt),
      isDaily: trip.isDaily,
      notes: trip.notes ?? "",
    });
    setEditing(true);
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!trip) return;
    const scheduled = new Date(`${tripForm.serviceDate}T${tripForm.departsAt}`);
    const arrives = new Date(`${tripForm.serviceDate}T${tripForm.arrivesAt}`);
    if (Number.isNaN(scheduled.getTime()) || Number.isNaN(arrives.getTime()) || arrives.getTime() <= scheduled.getTime()) {
      setError("وقت الوصول يجب أن يكون بعد وقت الانطلاق في تاريخ الرحلة نفسه.");
      return;
    }
    const response = await apiRequest(`/api/trips/${trip.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        direction: tripForm.direction,
        destinationId: tripForm.destinationId,
        scheduledAt: scheduled.toISOString(),
        arrivesAt: arrives.toISOString(),
        isDaily: trip.parentTripId ? false : tripForm.isDaily,
        notes: tripForm.notes,
      }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تعديل الرحلة."));
      return;
    }
    setEditing(false);
    await reload("عُدّلت الرحلة.");
  }

  function askDelete(target: { id: string; reference: string }): void {
    setDeleteTarget(target);
    setActionReason("");
    setError("");
    setDeleteOpen(true);
  }

  async function confirmDelete(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!trip || !deleteTarget) return;
    const response = await apiRequest(`/api/trips/${deleteTarget.id}`, {
      method: "DELETE",
      body: JSON.stringify({ reason: actionReason }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر حذف الرحلة."));
      return;
    }
    setDeleteOpen(false);
    const removingCurrent = deleteTarget.id === trip.id;
    setDeleteTarget(null);
    if (!removingCurrent) {
      await reload("حُذفت الرحلة الفرعية من السجل.");
      return;
    }
    router.push(trip.parentTripId ? `/admin/trips/${trip.parentTripId}` : "/admin/trips");
  }

  function openRun(vehicle: LinkedVehicle): void {
    if (!trip) return;
    setRunVehicleId(vehicle.vehicleId);
    setPreview(null);
    setSelectedIds([]);
    setOrigin({
      latitude: trip.originLatitude || trip.destination.latitude,
      longitude: trip.originLongitude || trip.destination.longitude,
    });
    setError("");
  }

  async function suggestPassengers(): Promise<void> {
    if (!trip || !runVehicleId) return;
    const scheduled = new Date(`${serviceDate}T${clockValue(trip.scheduledAt)}`);
    if (Number.isNaN(scheduled.getTime())) {
      setError("تاريخ الرحلة الفرعية غير صالح.");
      return;
    }
    const response = await apiRequest(`/api/trips/${trip.id}/runs/preview`, {
      method: "POST",
      body: JSON.stringify({
        vehicleId: runVehicleId,
        latitude: origin.latitude,
        longitude: origin.longitude,
        scheduledAt: scheduled.toISOString(),
      }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر اقتراح الركاب."));
      return;
    }
    const body = (await response.json()) as RunPreview;
    setPreview(body);
    setSelectedIds(body.suggestedIds);
    setError("");
  }

  async function confirmRun(): Promise<void> {
    if (!trip || !runVehicleId) return;
    const scheduled = new Date(`${serviceDate}T${clockValue(trip.scheduledAt)}`);
    const arrives = new Date(`${serviceDate}T${clockValue(trip.arrivesAt)}`);
    if (Number.isNaN(scheduled.getTime()) || Number.isNaN(arrives.getTime()) || arrives.getTime() <= scheduled.getTime()) {
      setError("وقت الوصول يجب أن يكون بعد وقت الانطلاق.");
      return;
    }
    const response = await apiRequest(`/api/trips/${trip.id}/runs`, {
      method: "POST",
      body: JSON.stringify({
        vehicleId: runVehicleId,
        passengerIds: selectedIds,
        latitude: origin.latitude,
        longitude: origin.longitude,
        scheduledAt: scheduled.toISOString(),
        arrivesAt: arrives.toISOString(),
      }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تأكيد الرحلة الفرعية."));
      return;
    }
    const saved = (await response.json()) as TripDetailItem;
    setPreview(null);
    setRunVehicleId(null);
    setMessage(`أُكّدت الرحلة الفرعية ${saved.reference} لمرة واحدة.`);
    setReloadKey((value) => value + 1);
  }

  async function changeStatus(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!trip || !nextStatus) return;
    const needsReason = nextStatus === "CANCELLED" || nextStatus === "DISPUTED";
    const response = await apiRequest(`/api/trips/${trip.id}/status`, {
      method: "POST",
      body: JSON.stringify({ status: nextStatus, reason: needsReason ? reason : undefined }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تحديث الحالة."));
      return;
    }
    await reload("تحدّثت حالة الرحلة.");
  }

  async function board(passengerId: string, status: "BOARDED" | "NO_SHOW"): Promise<void> {
    if (!trip) return;
    const response = await apiRequest(`/api/trips/${trip.id}/passengers/${passengerId}/boarding`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تسجيل الصعود."));
      return;
    }
    await reload("سُجّل حدث الصعود.");
  }

  if (!tripId) return <ErrorState title="الرحلة" description="معرّف الرحلة غير صالح." />;
  if (loading) return <p className="m-0 text-sm text-muted">جارٍ فتح الرحلة.</p>;
  if (!trip) return <ErrorState title="الرحلة" description={error || "الرحلة غير موجودة."} />;

  const runVehicle = activeVehicles.find((vehicle) => vehicle.vehicleId === runVehicleId) ?? null;

  return (
    <section className="grid gap-4">
      <header className="fv-page-head">
        <div>
          <p className="m-0 text-sm">
            <Link href="/admin/trips">الرحلات</Link>
            {trip.parentTripId ? (
              <>
                {" / "}
                <Link href={`/admin/trips/${trip.parentTripId}`}>{trip.parentReference}</Link>
              </>
            ) : null}
          </p>
          <h1>{trip.reference}</h1>
          <p>
            {trip.destination.name} — {directionLabels[trip.direction] ?? trip.direction} —{" "}
            {template ? "رحلة دائمة" : trip.parentTripId ? "رحلة فرعية لمرة واحدة" : "مرة واحدة"} — {tripStatusLabels[trip.status] ?? trip.status}
            {trip.arrivalState === "LATE" ? " — متأخرة" : ""}
            {trip.arrivalState === "STALLED" ? " — متعثرة" : ""}
          </p>
        </div>
        {canDispatch ? (
          <div className="flex flex-wrap gap-2">
            {editableTrips.has(trip.status) ? (
              <Button type="button" variant="secondary" onClick={() => void openEdit()}>
                تعديل
              </Button>
            ) : null}
            <Button type="button" variant="danger" onClick={() => askDelete({ id: trip.id, reference: trip.reference })}>
              حذف
            </Button>
          </div>
        ) : null}
      </header>
      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="m-0 text-sm text-success">{message}</p> : null}
      {(trip.breakdownReportedAt || trip.arrivalState === "STALLED") && !closedTrips.has(trip.status) ? (
        <section className="fv-card fv-alert-breakdown grid gap-2 p-4" role="alert">
          <strong>تعثرت الرحلة</strong>
          <p className="m-0">
            {trip.breakdownReportedAt
              ? `أبلغ السائق عن عطل أو حادث${trip.breakdownNote ? `: ${trip.breakdownNote}` : ""}.`
              : "مرّت ساعة بعد وقت الوصول ولم تنتهِ الرحلة."}{" "}
            ألغِ هذه الرحلة. إسناد سائق بديل يتم هاتفيًا خارج النظام، ولا يُنشأ إسناد جديد من هنا.
          </p>
          {canDispatch ? (
            <Button
              type="button"
              variant="danger"
              onClick={() => {
                void (async () => {
                  const response = await apiRequest(`/api/trips/${trip.id}/status`, {
                    method: "POST",
                    body: JSON.stringify({
                      status: "CANCELLED",
                      reason: trip.breakdownNote || (trip.arrivalState === "STALLED" ? "تجاوزت ساعة بعد وقت الوصول" : "تعثر الرحلة لعطل أو حادث"),
                    }),
                  });
                  if (!response.ok) {
                    setError(await readError(response, "تعذر إلغاء الرحلة المتعثرة."));
                    return;
                  }
                  await reload("أُلغيت الرحلة المتعثرة. نسّق مع سائق بديل هاتفيًا خارج النظام.");
                })();
              }}
            >
              إلغاء الرحلة المتعثرة
            </Button>
          ) : null}
        </section>
      ) : trip.arrivalState === "LATE" && !closedTrips.has(trip.status) ? (
        <p className="fv-card m-0 p-4 text-sm" role="status">
          متأخرة: مضى أكثر من ربع ساعة على وقت الوصول. بعد ساعة من وقت الوصول تُعد الرحلة متعثرة.
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="fv-card grid gap-1 p-4">
          <span className="text-sm text-muted">الحجوزات</span>
          <strong className="text-2xl">{trip.passengerCount}</strong>
        </article>
        <article className="fv-card grid gap-1 p-4">
          <span className="text-sm text-muted">المقاعد المرتبطة</span>
          <strong className="text-2xl">{trip.capacity ?? 0}</strong>
        </article>
        <article className="fv-card grid gap-1 p-4">
          <span className="text-sm text-muted">{template ? "مركبات لازمة للغد" : "المركبة"}</span>
          <strong className="text-2xl">{template ? trip.vehiclesNeeded : activeVehicles.length}</strong>
        </article>
        <article className="fv-card grid gap-1 p-4">
          <span className="text-sm text-muted">نقص المقاعد</span>
          <strong className="text-2xl">{trip.seatShortfall}</strong>
        </article>
      </div>
      {template ? (
        <p className="m-0 text-sm text-muted">
          الحساب يأخذ أكبر المركبات المرتبطة أولًا حتى تغطي الحجوزات. وجود مركبة في الرحلة لا يعني تشغيلها غدًا؛ تُختار المركبات اللازمة فقط، ولكل مركبة تُؤكَّد رحلة فرعية واحدة لا تتجدد.
          الانطلاق {formatWhen(trip.scheduledAt)} والوصول {formatClock(trip.arrivesAt)}.
        </p>
      ) : (
        <p className="m-0 text-sm text-muted">
          {formatWhen(trip.scheduledAt)} — الوصول {formatClock(trip.arrivesAt)}
          {trip.notes ? ` — ${trip.notes}` : ""}
        </p>
      )}

      <div className="grid gap-3">
        <h2 className="m-0 text-lg">المركبات</h2>
        {trip.vehicles.length === 0 ? <p className="m-0 text-sm text-muted">لا توجد مركبة مرتبطة بعد.</p> : null}
        <div className="grid gap-3 md:grid-cols-2">
          {trip.vehicles.map((vehicle) => (
            <article key={vehicle.id} className="fv-card grid gap-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <strong>{vehicle.plateNumber}</strong>
                <span className="fv-badge fv-badge-neutral">{vehicle.capacity} مقاعد</span>
              </div>
              <div>{vehicle.driverName}</div>
              {vehicle.disabledAt ? <span className="text-sm text-muted">معطّلة</span> : null}
              {canDispatch && !vehicle.disabledAt && !closedTrips.has(trip.status) ? (
                <div className="flex flex-wrap gap-2">
                  {template ? (
                    <Button type="button" variant="teal" onClick={() => openRun(vehicle)}>
                      رحلة الغد
                    </Button>
                  ) : null}
                  {!trip.parentTripId ? (
                    <Button type="button" variant="secondary" onClick={() => void unlinkVehicle(vehicle.vehicleId)}>
                      إقصاء
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        {canDispatch && !trip.parentTripId && !closedTrips.has(trip.status) ? (
          <div className="flex flex-wrap items-end gap-2">
            <label className="fv-field min-w-64">
              <span className="fv-label">إضافة مركبة</span>
              <select className="fv-input" value={driverId} onChange={(event) => setDriverId(event.target.value)}>
                {candidates.length === 0 ? <option value="">لا يوجد سائق بمركبة معتمدة</option> : null}
                {candidates.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName} — {candidate.plateNumber}
                  </option>
                ))}
              </select>
            </label>
            <Button type="button" variant="teal" disabled={!driverId} onClick={() => void linkVehicle()}>
              إضافة
            </Button>
          </div>
        ) : null}
      </div>

      {template && runVehicle ? (
        <section className="fv-card grid gap-3 p-4">
          <h2 className="m-0 text-lg">
            رحلة {runVehicle.plateNumber} — {runVehicle.driverName}
          </h2>
          <p className="m-0 text-sm text-muted">
            النظام يرتب الركاب حسب المسافة المباشرة من موقع انطلاق السائق ويقترح الأقرب حتى تمتلئ المقاعد ({runVehicle.capacity}). أكد الاختيار لإنشاء رحلة فرعية واحدة لهذه المركبة فقط.
          </p>
          <label className="fv-field max-w-xs">
            <span className="fv-label">تاريخ التشغيل</span>
            <input className="fv-input" type="date" value={serviceDate} onChange={(event) => setServiceDate(event.target.value)} />
          </label>
          <MapPicker
            latitude={origin.latitude}
            longitude={origin.longitude}
            markerTone="driver"
            onChange={(latitude, longitude) => {
              setOrigin({ latitude, longitude });
              setPreview(null);
            }}
            caption="حدد موقع انطلاق هذه المركبة. الأقرب إليه يُقترح أولًا."
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void suggestPassengers()}>
              اقتراح الركاب
            </Button>
            <Button type="button" variant="ghost" onClick={() => setRunVehicleId(null)}>
              إغلاق
            </Button>
          </div>
          {preview ? (
            <div className="grid gap-2">
              {preview.passengers.length === 0 ? <p className="m-0 text-sm text-muted">لا توجد حجوزات على هذه الرحلة.</p> : null}
              {preview.passengers.map((passenger) => (
                <label key={passenger.id} className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(passenger.id)}
                      disabled={passenger.assignedElsewhere}
                      onChange={() =>
                        setSelectedIds((current) =>
                          current.includes(passenger.id) ? current.filter((id) => id !== passenger.id) : [...current, passenger.id],
                        )
                      }
                    />
                    <span>
                      {passenger.name}
                      {passenger.phone ? ` — ${passenger.phone}` : ""} — {formatMeters(passenger.distanceMeters)}
                      {passenger.assignedElsewhere ? " — معيّن على مركبة أخرى" : ""}
                      {passenger.suggested ? " — مقترح" : ""}
                    </span>
                  </span>
                </label>
              ))}
              <p className="m-0 text-sm text-muted">
                المختار {selectedIds.length} من {preview.capacity} مقاعد.
              </p>
              <Button type="button" variant="teal" disabled={selectedIds.length === 0 || selectedIds.length > preview.capacity} onClick={() => void confirmRun()}>
                تأكيد الرحلة الفرعية
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {template && canDispatch ? (
        <section className="grid gap-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="m-0 text-lg">سجل الرحلات</h2>
              <p className="m-0 text-sm text-muted">كل يوم تُشغَّل فيه مركبة تُحفظ رحلة هنا، حتى لو بقيت المركبة والسائق نفسهما.</p>
            </div>
            <span className="text-sm text-muted">
              {filteredRuns.length} من {runs.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="فترة السجل بتوقيت دمشق">
            {logPeriods.map((period) => (
              <Button key={period.id} type="button" variant={logPeriod === period.id ? "primary" : "secondary"} onClick={() => setLogPeriod(period.id)}>
                {period.label}
              </Button>
            ))}
          </div>
          {logRange ? <p className="m-0 text-sm text-muted">بتوقيت دمشق: {formatDamascusRange(logRange)}</p> : null}
          <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-4">
            <label className="fv-field">
              <span className="fv-label">المركبة</span>
              <select className="fv-input" value={logVehicleId} onChange={(event) => setLogVehicleId(event.target.value)}>
                <option value="">كل المركبات</option>
                {logVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plateNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="fv-field">
              <span className="fv-label">السائق</span>
              <select className="fv-input" value={logDriverId} onChange={(event) => setLogDriverId(event.target.value)}>
                <option value="">كل السائقين</option>
                {logDrivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fv-field">
              <span className="fv-label">الحالة</span>
              <select className="fv-input" value={logStatus} onChange={(event) => setLogStatus(event.target.value)}>
                <option value="">كل الحالات</option>
                {Object.entries(tripStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fv-field">
              <span className="fv-label">الالتزام بالوصول</span>
              <select className="fv-input" value={logArrival} onChange={(event) => setLogArrival(event.target.value)}>
                <option value="">الكل</option>
                {Object.entries(arrivalFilterLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fv-field md:col-span-2">
              <span className="fv-label">بحث</span>
              <input
                className="fv-input"
                value={logQuery}
                placeholder="رقم الرحلة أو اللوحة أو السائق"
                onChange={(event) => setLogQuery(event.target.value)}
              />
            </label>
          </div>
          {logPeriod !== "all" || logVehicleId || logDriverId || logStatus || logArrival || logQuery ? (
            <div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setLogPeriod("all");
                  setLogVehicleId("");
                  setLogDriverId("");
                  setLogStatus("");
                  setLogArrival("");
                  setLogQuery("");
                }}
              >
                مسح التصفية
              </Button>
            </div>
          ) : null}
          {runs.length === 0 ? (
            <p className="m-0 text-sm text-muted">لم تُسجَّل رحلات بعد. عند تأكيد مركبة ليوم محدد تُضاف رحلتها إلى هذا السجل.</p>
          ) : filteredRuns.length === 0 ? (
            <p className="m-0 text-sm text-muted">لا توجد رحلات مطابقة للتصفية.</p>
          ) : (
            <div className="fv-table-wrap">
              <table className="fv-table">
                <thead>
                  <tr>
                    <th>اليوم</th>
                    <th>الانطلاق</th>
                    <th>الوصول</th>
                    <th>المركبة</th>
                    <th>السائق</th>
                    <th>الركاب</th>
                    <th>الحالة</th>
                    <th>الالتزام</th>
                    <th>إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map((run) => {
                    const vehicle = assignedVehicle(run);
                    const closed = closedTripStatuses.has(run.status);
                    const arrival = !closed && run.arrivalState === "LATE" ? "متأخرة" : !closed && run.arrivalState === "STALLED" ? "متعثرة" : closed ? "—" : "في الوقت";
                    return (
                      <tr key={run.id}>
                        <td>
                          <Link href={`/admin/trips/${run.id}`}>{formatDamascusDay(run.scheduledAt)}</Link>
                          <div className="text-sm text-muted">{run.reference}</div>
                        </td>
                        <td>{formatDamascusClock(run.scheduledAt)}</td>
                        <td>{formatDamascusClock(run.arrivesAt)}</td>
                        <td>{vehicle?.plateNumber ?? "—"}</td>
                        <td>{vehicle?.driverName ?? "—"}</td>
                        <td>{run.passengerCount}</td>
                        <td>
                          <span className="fv-badge fv-badge-info">{tripStatusLabels[run.status] ?? run.status}</span>
                        </td>
                        <td>
                          {arrival === "متعثرة" ? (
                            <span className="fv-badge fv-badge-danger">متعثرة</span>
                          ) : arrival === "متأخرة" ? (
                            <span className="fv-badge fv-badge-warning">متأخرة</span>
                          ) : (
                            arrival
                          )}
                        </td>
                        <td>
                          <Button type="button" variant="danger" onClick={() => askDelete({ id: run.id, reference: run.reference })}>
                            حذف
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {!template && trip.passengers.length > 0 ? (
        <div className="grid gap-2">
          <h2 className="m-0 text-lg">الركاب</h2>
          {trip.passengers.map((passenger) => (
            <div key={passenger.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {passenger.name}
                {passenger.phone ? ` — ${passenger.phone}` : ""} — {boardingLabels[passenger.boardingStatus] ?? passenger.boardingStatus}
                {passenger.pickupAt ? ` — ${formatClock(passenger.pickupAt)}` : ""}
                {passenger.fareAmount ? ` — ${formatFare(passenger.fareAmount, passenger.fareCurrency)}` : ""}
              </span>
              {["ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"].includes(trip.status) && passenger.boardingStatus === "EXPECTED" ? (
                <span className="flex gap-2">
                  <Button type="button" variant="secondary" onClick={() => void board(passenger.id, "BOARDED")}>
                    صعد
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => void board(passenger.id, "NO_SHOW")}>
                    لم يحضر
                  </Button>
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {template && trip.passengers.length > 0 ? (
        <div className="grid gap-2">
          <h2 className="m-0 text-lg">حجوزات الرحلة الدائمة</h2>
          <ul className="m-0 grid gap-1 p-0">
            {trip.passengers.map((passenger) => (
              <li key={passenger.id}>
                {passenger.name}
                {passenger.phone ? ` — ${passenger.phone}` : ""}
                {passenger.fareAmount ? ` — ${formatFare(passenger.fareAmount, passenger.fareCurrency)}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!template && moves.length > 0 ? (
        <form className="grid max-w-md gap-3" onSubmit={(event) => void changeStatus(event)}>
          <label className="fv-field">
            <span className="fv-label">الحالة التالية</span>
            <select className="fv-input" value={nextStatus} onChange={(event) => setNextStatus(event.target.value)}>
              {moves.map((move) => (
                <option key={move.value} value={move.value}>
                  {move.label}
                </option>
              ))}
            </select>
          </label>
          {nextStatus === "DISPUTED" || nextStatus === "CANCELLED" ? (
            <TextField label="السبب" name="statusReason" required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          ) : null}
          <Button type="submit">تحديث الحالة</Button>
        </form>
      ) : null}

      <Dialog open={editing} title={`تعديل ${trip.reference}`} description="تعديل الوجهة والموعد قبل بدء الرحلة." onClose={() => setEditing(false)}>
        <form className="fv-dialog-layout" onSubmit={(event) => void saveEdit(event)}>
          <div className="fv-dialog-scroll grid gap-4">
            {template ? (
              <p className="m-0 text-sm text-muted">هذه الرحلة الدائمة. رحلات المركبات الفرعية تبقى مرة واحدة.</p>
            ) : null}
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
                {destinations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="fv-field">
              <span className="fv-label">التاريخ</span>
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
            <TextField label="ملاحظات" name="editTripNotes" value={tripForm.notes} onChange={(event) => setTripForm({ ...tripForm, notes: event.target.value })} />
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              إغلاق
            </Button>
            <Button type="submit">حفظ التعديل</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={deleteOpen}
        title={deleteTarget && (deleteTarget.id !== trip.id || trip.parentTripId) ? "حذف الرحلة الفرعية" : "حذف الرحلة"}
        description={
          deleteTarget && (deleteTarget.id !== trip.id || trip.parentTripId)
            ? "تُحذف رحلة هذا اليوم فقط. الرحلة الدائمة تبقى."
            : "تُحذف الرحلة الدائمة وكل رحلاتها الفرعية، وتُفصل المركبات المرتبطة."
        }
        onClose={() => setDeleteOpen(false)}
      >
        <form className="fv-dialog-layout" onSubmit={(event) => void confirmDelete(event)}>
          <div className="fv-dialog-scroll grid gap-4">
            <p className="m-0">
              {deleteTarget && (deleteTarget.id !== trip.id || trip.parentTripId)
                ? `حذف ${deleteTarget.reference} يزيل رحلة هذا اليوم فقط. الرحلة الأم وحجوزاتها تبقى، إلا إذا لم يبقَ للحجز اتجاه آخر.`
                : `حذف ${deleteTarget?.reference ?? trip.reference} يزيل الرحلة وسجل رحلاتها الفرعية ويفصل مركباتها. الحجز الذي لا يبقى له اتجاه آخر يُلغى.`}
            </p>
            {error ? (
              <p className="m-0 text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <TextField label="السبب" name="deleteReason" required minLength={3} value={actionReason} onChange={(event) => setActionReason(event.target.value)} />
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)}>
              رجوع
            </Button>
            <Button type="submit" variant="danger" disabled={actionReason.trim().length < 3}>
              تأكيد الحذف
            </Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
