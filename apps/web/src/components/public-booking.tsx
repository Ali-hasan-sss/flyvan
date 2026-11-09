"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, TextField } from "@flyvan/ui";
import { apiRequest, readError } from "../lib/api";
import { Brand } from "./brand";
import { directionLabels, formatWhen } from "./operations-labels";

const MapPicker = dynamic(() => import("./map-picker").then((mod) => mod.MapPicker), { ssr: false });

type PublicTrip = {
  id: string;
  reference: string;
  direction: string;
  destinationName: string;
  scheduledAt: string;
  arrivesAt: string;
  isDaily: boolean;
  seatsRemaining: number | null;
};

type BookingResult = {
  reference: string;
  message: string;
  destinationName: string;
  seatCount: number;
};

function tripLabel(trip: PublicTrip): string {
  const rhythm = trip.isDaily ? "يومي" : "مرة واحدة";
  const seats = trip.seatsRemaining === null ? "المقاعد تُحدد مع المركبة" : `${trip.seatsRemaining} مقاعد متبقية`;
  return `${trip.destinationName} · ${directionLabels[trip.direction] ?? trip.direction} · ${rhythm} · ${formatWhen(trip.scheduledAt)} · ${seats}`;
}

export function PublicBooking() {
  const [trips, setTrips] = useState<PublicTrip[]>([]);
  const [tripId, setTripId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [seatCount, setSeatCount] = useState(1);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BookingResult | null>(null);

  useEffect(() => {
    let active = true;
    void apiRequest("/api/public/trips")
      .then(async (response) => {
        if (!active) return;
        if (!response.ok) {
          setError(await readError(response, "تعذر تحميل الرحلات."));
          return;
        }
        const body = (await response.json()) as { items?: PublicTrip[] };
        const items = body.items ?? [];
        setTrips(items);
        setTripId(items[0]?.id ?? "");
      })
      .catch(() => {
        if (active) setError("تعذر الاتصال بالخادم.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const selected = trips.find((trip) => trip.id === tripId) ?? null;
  const maxSeats = Math.min(6, selected?.seatsRemaining ?? 6);

  useEffect(() => {
    if (seatCount > maxSeats) setSeatCount(maxSeats);
  }, [maxSeats, seatCount]);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!tripId) {
      setError("اختر رحلة.");
      return;
    }
    if (!latitude || !longitude) {
      setError("حدد موقع الالتقاط على الخريطة.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await apiRequest("/api/public/bookings", {
        method: "POST",
        body: JSON.stringify({
          passengerName: name,
          passengerPhone: phone,
          tripId,
          seatCount,
          pickupLatitude: latitude,
          pickupLongitude: longitude,
          pickupNote: note,
        }),
      });
      if (!response.ok) {
        setError(await readError(response, "تعذر إرسال الطلب."));
        return;
      }
      setResult((await response.json()) as BookingResult);
    } catch {
      setError("تعذر الاتصال بالخادم.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-start px-4 py-8">
      <Card className="mx-auto grid w-full max-w-3xl gap-5 p-6 md:p-8">
        <Brand />
        <div className="grid gap-2">
          <h1 className="m-0 text-2xl">حجز رحلة</h1>
          <p className="m-0 text-muted">
            أدخل اسمك ورقم هاتفك، اختر الرحلة وعدد المقاعد، ثم ضع موقع الالتقاط على الخريطة. الطلب يبقى بانتظار تثبيت الأجرة من الكونترول، والدفع نقدًا للسائق بعد التأكيد.
          </p>
        </div>
        {result ? (
          <div className="grid gap-3" role="status">
            <p className="m-0 text-lg font-semibold">رقم الطلب {result.reference}</p>
            <p className="m-0">
              {result.seatCount} {result.seatCount === 1 ? "مقعد" : "مقاعد"} إلى {result.destinationName}. {result.message}
            </p>
            <Link href="/" className="text-sm font-semibold text-primary-strong no-underline">
              العودة إلى الرئيسية
            </Link>
          </div>
        ) : (
          <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
            {error ? (
              <p className="m-0 text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <TextField label="الاسم" name="passengerName" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
            <TextField label="رقم الهاتف" name="passengerPhone" required minLength={6} maxLength={20} inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
            <label className="fv-field">
              <span className="fv-label">الرحلة</span>
              <select className="fv-input" required value={tripId} disabled={loading || trips.length === 0} onChange={(event) => setTripId(event.target.value)}>
                {trips.length === 0 ? <option value="">{loading ? "جارٍ تحميل الرحلات" : "لا توجد رحلات متاحة"}</option> : null}
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {tripLabel(trip)}
                  </option>
                ))}
              </select>
            </label>
            <label className="fv-field">
              <span className="fv-label">عدد المقاعد</span>
              <select className="fv-input" value={seatCount} onChange={(event) => setSeatCount(Number(event.target.value))}>
                {Array.from({ length: Math.max(1, maxSeats) }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid gap-2">
              <span className="fv-label">موقع الالتقاط</span>
              <MapPicker
                latitude={latitude}
                longitude={longitude}
                markerTone="pickup"
                placeSearch
                searchPath="/api/public/places"
                onChange={(nextLatitude, nextLongitude) => {
                  setLatitude(nextLatitude);
                  setLongitude(nextLongitude);
                }}
              />
            </div>
            <TextField label="ملاحظة الالتقاط" name="pickupNote" maxLength={160} hint="اختيارية، مثل بوابة أو معلم قرب الدبوس." value={note} onChange={(event) => setNote(event.target.value)} />
            <Button type="submit" disabled={busy || trips.length === 0}>
              {busy ? "جارٍ الإرسال" : "إرسال طلب الحجز"}
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}
