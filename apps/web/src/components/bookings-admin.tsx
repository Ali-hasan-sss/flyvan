"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button, Dialog, ErrorState, TextField } from "@flyvan/ui";
import { apiRequest, readError } from "../lib/api";
import { useAdminSession } from "./require-session";
import { TableFrame } from "./table-frame";
import { bookingStatusLabels, directionLabels, formatFare, formatWhen, tripStatusLabels } from "./operations-labels";

const MapPicker = dynamic(() => import("./map-picker").then((mod) => mod.MapPicker), { ssr: false });

type Leg = {
  tripId: string;
  tripReference: string;
  direction: string;
  tripStatus: string;
  scheduledAt: string;
  destinationName: string;
  fareAmount: string | null;
  fareCurrency: string | null;
};

type BookingItem = {
  id: string;
  reference: string;
  direction: string;
  status: string;
  passengerName: string;
  passengerPhone: string;
  pickupNote: string | null;
  seatCount?: number;
  scheduledAt: string;
  cancelReason: string | null;
  legs: Leg[];
};

type TripOption = {
  id: string;
  reference: string;
  scheduledAt: string;
  isDaily?: boolean;
  destination: { name: string };
  passengerCount: number;
  capacity: number | null;
};

type BookingForm = {
  passengerName: string;
  passengerPhone: string;
  direction: "OUTBOUND" | "RETURN" | "ROUND_TRIP";
  tripId: string;
  outboundTripId: string;
  returnTripId: string;
  pickupLatitude: string;
  pickupLongitude: string;
  pickupNote: string;
  fareAmount: string;
  returnFareAmount: string;
  notes: string;
};

type BoardingCode = { tripId: string; direction: string; boardingCode: string };

const headers = ["الحجز", "الراكب", "الهاتف", "التغطية", "الرحلات", "الأجرة", "الحالة", "إجراء"];

function emptyForm(): BookingForm {
  return {
    passengerName: "",
    passengerPhone: "",
    direction: "OUTBOUND",
    tripId: "",
    outboundTripId: "",
    returnTripId: "",
    pickupLatitude: "",
    pickupLongitude: "",
    pickupNote: "",
    fareAmount: "",
    returnFareAmount: "",
    notes: "",
  };
}

function tripLabel(trip: TripOption): string {
  const seats = trip.capacity === null ? `${trip.passengerCount} ركاب` : `${trip.passengerCount}/${trip.capacity}`;
  const rhythm = trip.isDaily === false ? "مرة واحدة" : "يومي";
  return `${trip.reference} — ${trip.destination.name} — ${rhythm} — ${formatWhen(trip.scheduledAt)} — ${seats}`;
}

function canCancel(booking: BookingItem): boolean {
  if (booking.status === "CANCELLED") return false;
  return !booking.legs.some((leg) => ["IN_PROGRESS", "COMPLETED", "DISPUTED"].includes(leg.tripStatus));
}

export function BookingsAdmin() {
  const session = useAdminSession();
  const canAdjustFare = session.user.role === "PLATFORM_OWNER";
  const canConfirm = session.user.role === "PLATFORM_OWNER" || session.user.role === "ADMIN" || session.user.role === "DISPATCHER";
  const [items, setItems] = useState<BookingItem[]>([]);
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
  const [forbidden, setForbidden] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<BookingForm>(emptyForm);
  const [outboundTrips, setOutboundTrips] = useState<TripOption[]>([]);
  const [returnTrips, setReturnTrips] = useState<TripOption[]>([]);
  const [boardingCodes, setBoardingCodes] = useState<BoardingCode[]>([]);
  const [cancelTarget, setCancelTarget] = useState<BookingItem | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<BookingItem | null>(null);
  const [confirmFare, setConfirmFare] = useState("");
  const [fareTarget, setFareTarget] = useState<BookingItem | null>(null);
  const [fareForm, setFareForm] = useState({ tripId: "", fareAmount: "", reason: "" });

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
      try {
        const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort, direction });
        if (search) query.set("q", search);
        const response = await apiRequest(`/api/bookings?${query.toString()}`);
        if (cancelled) return;
        if (response.status === 403) {
          setForbidden("إنشاء الحجوزات وعرضها متاح للكونترول والإدارة ومالك المنصة.");
          setLoading(false);
          return;
        }
        if (!response.ok) {
          setError(await readError(response, "تعذر تحميل الحجوزات."));
          setLoading(false);
          return;
        }
        const body = (await response.json()) as { items: BookingItem[]; total: number };
        setItems(body.items);
        setTotal(body.total);
        setError("");
        setLoading(false);
      } catch {
        if (cancelled) return;
        setError("تعذر الاتصال بالخادم.");
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, sort, direction, search, reloadKey]);

  async function loadTripOptions(): Promise<void> {
    const [outbound, returning] = await Promise.all([
      apiRequest("/api/trips?bookable=true&leg=OUTBOUND&page=1&pageSize=100"),
      apiRequest("/api/trips?bookable=true&leg=RETURN&page=1&pageSize=100"),
    ]);
    if (outbound.ok) {
      const body = (await outbound.json()) as { items: TripOption[] };
      setOutboundTrips(body.items);
      setForm((current) => ({ ...current, tripId: current.tripId || body.items[0]?.id || "", outboundTripId: current.outboundTripId || body.items[0]?.id || "" }));
    }
    if (returning.ok) {
      const body = (await returning.json()) as { items: TripOption[] };
      setReturnTrips(body.items);
      setForm((current) => ({ ...current, returnTripId: current.returnTripId || body.items[0]?.id || "" }));
    }
  }

  async function createBooking(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form.pickupLatitude || !form.pickupLongitude) {
      setError("حدد نقطة الالتقاط على الخريطة.");
      return;
    }
    const response = await apiRequest("/api/bookings", {
      method: "POST",
      body: JSON.stringify({
        passengerName: form.passengerName,
        passengerPhone: form.passengerPhone,
        direction: form.direction,
        tripId: form.direction === "ROUND_TRIP" ? undefined : form.tripId,
        outboundTripId: form.direction === "ROUND_TRIP" ? form.outboundTripId : undefined,
        returnTripId: form.direction === "ROUND_TRIP" ? form.returnTripId : undefined,
        pickupLatitude: form.pickupLatitude,
        pickupLongitude: form.pickupLongitude,
        pickupNote: form.pickupNote,
        fareAmount: form.fareAmount,
        returnFareAmount: form.direction === "ROUND_TRIP" ? form.returnFareAmount : undefined,
        notes: form.notes,
      }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر إنشاء الحجز."));
      return;
    }
    const created = (await response.json()) as BookingItem & { boardingCodes?: BoardingCode[] };
    setCreateOpen(false);
    setForm(emptyForm());
    setBoardingCodes(created.boardingCodes ?? []);
    setMessage(`أُضيف الراكب إلى الرحلة ضمن الحجز ${created.reference}.`);
    setPage(1);
    setReloadKey((value) => value + 1);
  }

  async function cancelBooking(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!cancelTarget) return;
    const response = await apiRequest(`/api/bookings/${cancelTarget.id}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: cancelReason }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر إلغاء الحجز."));
      return;
    }
    setCancelTarget(null);
    setCancelReason("");
    setMessage("أُلغي الحجز وأُزيل الراكب من الرحلة. الرحلة نفسها بقيت قائمة.");
    setReloadKey((value) => value + 1);
  }

  async function adjustFare(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!fareTarget) return;
    const response = await apiRequest(`/api/bookings/${fareTarget.id}/fare`, {
      method: "POST",
      body: JSON.stringify(fareForm),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تعديل الأجرة."));
      return;
    }
    setFareTarget(null);
    setMessage("عُدّلت أجرة هذا الاتجاه مع تسجيل السبب.");
    setReloadKey((value) => value + 1);
  }

  if (forbidden) return <ErrorState title="الحجوزات" description={forbidden} />;

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const singleTrips = form.direction === "RETURN" ? returnTrips : outboundTrips;

  return (
    <section className="grid gap-4">
      <header className="fv-page-head">
        <div>
          <h1>الحجوزات</h1>
          <p>
            تُنشأ الرحلة أولًا وترتبط بوجهة. الحجز يضيف الراكب إلى رحلة ذهاب أو إياب، أو إلى الاثنتين معًا. نقطة
            الالتقاط تُحدد من الخريطة، ولكل اتجاه أجرته.
          </p>
        </div>
        <Button
          variant="teal"
          onClick={() => {
            setForm(emptyForm());
            setError("");
            setCreateOpen(true);
            void loadTripOptions();
          }}
        >
          حجز راكب
        </Button>
      </header>
      {error && !createOpen && !cancelTarget && !fareTarget ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="m-0 text-sm text-success">{message}</p> : null}
      <TableFrame
        sorts={[
          { id: "scheduledAt", label: "الموعد", icon: "calendar" },
          { id: "createdAt", label: "التسجيل", icon: "calendar" },
          { id: "reference", label: "الرقم", icon: "plate" },
        ]}
        sort={sort}
        onSort={(id) => {
          setSort(id);
          setPage(1);
        }}
        direction={direction}
        onDirection={() => {
          setDirection((value) => (value === "asc" ? "desc" : "asc"));
          setPage(1);
        }}
        search={searchDraft}
        onSearch={setSearchDraft}
        pageSize={String(pageSize)}
        onPageSize={(value) => {
          setPageSize(Number(value));
          setPage(1);
        }}
        page={page}
        pageCount={pageCount}
        total={total}
        totalLabel="حجز"
        onPage={setPage}
        loading={loading}
        headers={headers}
        empty="لا توجد حجوزات مطابقة."
        isEmpty={items.length === 0}
      >
        {items.map((booking) => (
          <tr key={booking.id}>
            <td>
              <strong>{booking.reference}</strong>
            </td>
            <td>
              {booking.passengerName}
              {booking.seatCount && booking.seatCount > 1 ? ` · ${booking.seatCount} مقاعد` : ""}
            </td>
            <td>{booking.passengerPhone}</td>
            <td>{directionLabels[booking.direction] ?? booking.direction}</td>
            <td>
              {booking.legs.map((leg) => (
                <div key={leg.tripId}>
                  {directionLabels[leg.direction] ?? leg.direction}: {leg.tripReference} — {leg.destinationName}
                  <div className="text-sm text-muted">{tripStatusLabels[leg.tripStatus] ?? leg.tripStatus}</div>
                </div>
              ))}
            </td>
            <td>
              {booking.legs.map((leg) => (
                <div key={leg.tripId}>{formatFare(leg.fareAmount, leg.fareCurrency)}</div>
              ))}
            </td>
            <td>{bookingStatusLabels[booking.status] ?? booking.status}</td>
            <td>
              <div className="fv-cell-actions">
                {canConfirm && booking.status === "PENDING" ? (
                  <Button
                    onClick={() => {
                      setError("");
                      setConfirmFare("");
                      setConfirmTarget(booking);
                    }}
                  >
                    تثبيت الأجرة
                  </Button>
                ) : null}
                {canCancel(booking) ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setError("");
                      setCancelReason("");
                      setCancelTarget(booking);
                    }}
                  >
                    إلغاء
                  </Button>
                ) : null}
                {canAdjustFare && booking.status !== "CANCELLED" && booking.legs[0] ? (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      const leg = booking.legs[0];
                      if (!leg) return;
                      setError("");
                      setFareForm({
                        tripId: leg.tripId,
                        fareAmount: leg.fareAmount ?? "",
                        reason: "",
                      });
                      setFareTarget(booking);
                    }}
                  >
                    تعديل الأجرة
                  </Button>
                ) : null}
              </div>
            </td>
          </tr>
        ))}
      </TableFrame>

      <Dialog
        open={createOpen}
        title="حجز راكب على رحلة"
        description="اختيار ذهاب وإياب يضيف الراكب إلى رحلة الإياب تلقائيًا، ونقطة التقاط الإياب هي وجهة الذهاب."
        onClose={() => setCreateOpen(false)}
      >
        <form className="fv-dialog-layout" onSubmit={(event) => void createBooking(event)}>
          <div className="fv-dialog-scroll grid gap-4">
            {error ? (
              <p className="m-0 text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <TextField label="اسم الراكب" name="passengerName" required minLength={2} value={form.passengerName} onChange={(event) => setForm({ ...form, passengerName: event.target.value })} />
            <TextField label="هاتف الراكب" name="passengerPhone" required minLength={6} hint="لا يُنشأ حساب راكب." value={form.passengerPhone} onChange={(event) => setForm({ ...form, passengerPhone: event.target.value })} />
            <label className="fv-field">
              <span className="fv-label">التغطية</span>
              <select className="fv-input" value={form.direction} onChange={(event) => setForm({ ...form, direction: event.target.value as BookingForm["direction"] })}>
                <option value="OUTBOUND">ذهاب</option>
                <option value="RETURN">إياب</option>
                <option value="ROUND_TRIP">ذهاب وإياب</option>
              </select>
            </label>
            {form.direction === "ROUND_TRIP" ? (
              <>
                <TripSelect label="رحلة الذهاب" value={form.outboundTripId} trips={outboundTrips} onChange={(outboundTripId) => setForm({ ...form, outboundTripId })} />
                <TripSelect label="رحلة الإياب" value={form.returnTripId} trips={returnTrips} onChange={(returnTripId) => setForm({ ...form, returnTripId })} />
              </>
            ) : (
              <TripSelect label="الرحلة" value={form.tripId} trips={singleTrips} onChange={(tripId) => setForm({ ...form, tripId })} />
            )}
            {createOpen ? (
              <MapPicker
                latitude={form.pickupLatitude}
                longitude={form.pickupLongitude}
                markerTone="pickup"
                placeSearch
                onChange={(pickupLatitude, pickupLongitude) => setForm({ ...form, pickupLatitude, pickupLongitude })}
              />
            ) : null}
            <TextField label="ملاحظة الالتقاط" name="pickupNote" hint="اختيارية، مثل بوابة أو معلم قرب الدبوس." value={form.pickupNote} onChange={(event) => setForm({ ...form, pickupNote: event.target.value })} />
            <TextField label={form.direction === "ROUND_TRIP" ? "أجرة الذهاب" : "الأجرة"} name="fareAmount" required inputMode="decimal" hint="بالليرة السورية." value={form.fareAmount} onChange={(event) => setForm({ ...form, fareAmount: event.target.value })} />
            {form.direction === "ROUND_TRIP" ? (
              <TextField label="أجرة الإياب" name="returnFareAmount" required inputMode="decimal" hint="اتجاه مستقل بأجرة مستقلة، وبالليرة السورية." value={form.returnFareAmount} onChange={(event) => setForm({ ...form, returnFareAmount: event.target.value })} />
            ) : null}
            <TextField label="ملاحظات" name="notes" hint="اختياري." value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit">حفظ الحجز</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={boardingCodes.length > 0} title="رموز الصعود" description="تظهر مرة واحدة. لكل اتجاه رمزه." onClose={() => setBoardingCodes([])}>
        <div className="fv-dialog-layout">
          <div className="fv-dialog-scroll grid gap-3">
            {boardingCodes.map((code) => (
              <p key={code.tripId} className="m-0 text-2xl font-semibold tracking-widest">
                {directionLabels[code.direction] ?? code.direction}: {code.boardingCode}
              </p>
            ))}
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" onClick={() => setBoardingCodes([])}>
              إخفاء الرموز
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={confirmTarget !== null} title="تثبيت الأجرة وتأكيد الطلب" description="الأجرة تُقفل على المقعد. الدفع يبقى نقدًا للسائق." onClose={() => setConfirmTarget(null)}>
        <form
          className="fv-dialog-layout"
          onSubmit={(event) => {
            event.preventDefault();
            if (!confirmTarget) return;
            void (async () => {
              const response = await apiRequest(`/api/bookings/${confirmTarget.id}/confirm`, {
                method: "POST",
                body: JSON.stringify({ fareAmount: confirmFare }),
              });
              if (!response.ok) {
                setError(await readError(response, "تعذر تأكيد الحجز."));
                return;
              }
              const body = (await response.json()) as { boardingCodes?: BoardingCode[] };
              setConfirmTarget(null);
              setConfirmFare("");
              setBoardingCodes(body.boardingCodes ?? []);
              setMessage(`تم تأكيد ${confirmTarget.reference}.`);
              setReloadKey((value) => value + 1);
            })();
          }}
        >
          <div className="fv-dialog-scroll grid gap-4">
            {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
            <TextField label="الأجرة" name="fareAmount" required inputMode="decimal" hint="الأجرة الكاملة للمقاعد المحجوزة في هذا الطلب، بالليرة السورية." value={confirmFare} onChange={(event) => setConfirmFare(event.target.value)} />
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => setConfirmTarget(null)}>رجوع</Button>
            <Button type="submit">تأكيد الحجز</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={cancelTarget !== null} title="إلغاء الحجز" description="تبقى الرحلة متاحة لبقية الركاب." onClose={() => setCancelTarget(null)}>
        <form className="fv-dialog-layout" onSubmit={(event) => void cancelBooking(event)}>
          <div className="fv-dialog-scroll grid gap-4">
            {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
            <TextField label="سبب الإلغاء" name="cancelReason" required minLength={3} value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => setCancelTarget(null)}>رجوع</Button>
            <Button type="submit" variant="secondary">تأكيد الإلغاء</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={fareTarget !== null} title="تعديل أجرة الاتجاه" description="الصلاحية لمالك المنصة، وتُحفظ على مقعد الراكب في الرحلة." onClose={() => setFareTarget(null)}>
        <form className="fv-dialog-layout" onSubmit={(event) => void adjustFare(event)}>
          <div className="fv-dialog-scroll grid gap-4">
            {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
            <label className="fv-field">
              <span className="fv-label">الاتجاه</span>
              <select className="fv-input" value={fareForm.tripId} onChange={(event) => {
                const leg = fareTarget?.legs.find((item) => item.tripId === event.target.value);
                setFareForm({
                  tripId: event.target.value,
                  fareAmount: leg?.fareAmount ?? "",
                  reason: fareForm.reason,
                });
              }}>
                {fareTarget?.legs.map((leg) => (
                  <option key={leg.tripId} value={leg.tripId}>
                    {directionLabels[leg.direction] ?? leg.direction} — {leg.tripReference}
                  </option>
                ))}
              </select>
            </label>
            <TextField label="الأجرة" name="fareAmount" required hint="بالليرة السورية." value={fareForm.fareAmount} onChange={(event) => setFareForm({ ...fareForm, fareAmount: event.target.value })} />
            <TextField label="سبب التعديل" name="fareReason" required minLength={3} value={fareForm.reason} onChange={(event) => setFareForm({ ...fareForm, reason: event.target.value })} />
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => setFareTarget(null)}>إلغاء</Button>
            <Button type="submit">حفظ الأجرة</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}

function TripSelect({ label, value, trips, onChange }: { label: string; value: string; trips: TripOption[]; onChange: (value: string) => void }) {
  return (
    <label className="fv-field">
      <span className="fv-label">{label}</span>
      <select className="fv-input" required value={value} onChange={(event) => onChange(event.target.value)}>
        {trips.length === 0 ? <option value="">لا توجد رحلة متاحة. أنشئ الرحلة أولًا.</option> : null}
        {trips.map((trip) => (
          <option key={trip.id} value={trip.id}>
            {tripLabel(trip)}
          </option>
        ))}
      </select>
    </label>
  );
}
