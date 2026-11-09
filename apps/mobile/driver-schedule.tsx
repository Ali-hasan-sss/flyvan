import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "@flyvan/ui/tokens";
import { driverFetch, getDriverSession } from "./driver-session";
import { TripListSkeleton } from "./driver-skeleton";

type TripRow = {
  id: string;
  reference: string;
  direction: string;
  status: string;
  scheduledAt: string;
  arrivesAt: string;
  isDaily: boolean;
  parentTripId: string | null;
  destination: { name: string };
  plateNumber: string | null;
  passengerCount: number;
  myOffer: { id: string; source: string; matchReason: string } | null;
};

const openStatuses = new Set(["ASSIGNED", "DRIVER_ARRIVED", "IN_PROGRESS"]);

const statusLabels: Record<string, string> = {
  ASSIGNED: "مسندة",
  DRIVER_ARRIVED: "وصل السائق",
  IN_PROGRESS: "قيد التنفيذ",
  COMPLETED: "مكتملة",
  NO_SHOW: "لم يحضر",
  CANCELLED: "ملغاة",
  DISPUTED: "متنازع عليها",
};

const sourceLabels: Record<string, string> = {
  NEARBY: "طلب قريب",
  SERVICE_AREA: "منطقة خدمة",
  MANUAL_DISPATCH: "إسناد من الكونترول",
  MATCHING_ENGINE: "مطابقة",
};

const directionLabels: Record<string, string> = {
  OUTBOUND: "ذهاب",
  RETURN: "إياب",
  INDEPENDENT: "مستقل",
  ROUND_TRIP: "ذهاب وإياب",
};

const whenLabel = new Intl.DateTimeFormat("ar-SY", {
  timeZone: "Asia/Damascus",
  weekday: "short",
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return whenLabel.format(date);
}

function statusTone(status: string): { color: string; background: string } {
  if (status === "IN_PROGRESS" || status === "DRIVER_ARRIVED") return { color: colors.primaryStrong, background: colors.infoSoft };
  if (status === "COMPLETED") return { color: colors.success, background: colors.successSoft };
  if (status === "CANCELLED" || status === "NO_SHOW" || status === "DISPUTED") return { color: colors.danger, background: colors.dangerSoft };
  return { color: colors.ink, background: colors.surface };
}

export function DriverSchedule() {
  const [offers, setOffers] = useState<TripRow[]>([]);
  const [upcoming, setUpcoming] = useState<TripRow[]>([]);
  const [previous, setPrevious] = useState<TripRow[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyOffer, setBusyOffer] = useState("");

  const load = useCallback(async () => {
    if (!getDriverSession()) {
      setOffers([]);
      setUpcoming([]);
      setPrevious([]);
      setMessage("سجّل الدخول لعرض الرحلات المسندة إليك.");
      setLoading(false);
      return;
    }
    try {
      const items: TripRow[] = [];
      let page = 1;
      let total = 0;
      do {
        const response = await driverFetch(`/api/trips?page=${page}&pageSize=100&sort=scheduledAt&direction=desc`);
        const body = (await response.json()) as { items?: TripRow[]; total?: number; message?: string };
        if (!response.ok || !body.items) {
          setMessage(body.message ?? "تعذر قراءة الرحلات.");
          setLoading(false);
          return;
        }
        items.push(...body.items);
        total = body.total ?? items.length;
        page += 1;
      } while (items.length < total && page <= 5);
      const offered = items.filter((trip) => trip.myOffer);
      const assigned = items.filter((trip) => !trip.myOffer && (openStatuses.has(trip.status) || statusLabels[trip.status]));
      setOffers(offered.sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)));
      setUpcoming(
        assigned.filter((trip) => openStatuses.has(trip.status)).sort((left, right) => left.scheduledAt.localeCompare(right.scheduledAt)),
      );
      setPrevious(
        assigned.filter((trip) => !openStatuses.has(trip.status)).sort((left, right) => right.scheduledAt.localeCompare(left.scheduledAt)),
      );
      setMessage(offered.length + assigned.length === 0 ? "لا توجد رحلات مسندة إليك." : "");
    } catch {
      setMessage("تعذر الوصول إلى الخادم.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(offerId: string, decision: "ACCEPT" | "REJECT"): Promise<void> {
    setBusyOffer(offerId);
    try {
      const response = await driverFetch(`/api/trip-offers/${offerId}/respond`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      });
      const body = (await response.json()) as { message?: string };
      if (response.ok) await load();
      setMessage(response.ok ? (decision === "ACCEPT" ? "قُبل العرض. الرحلة أصبحت مسندة إليك." : "رُفض العرض.") : (body.message ?? "تعذر الرد على العرض."));
    } catch {
      setMessage("تعذر الوصول إلى الخادم.");
    } finally {
      setBusyOffer("");
    }
  }

  if (loading && offers.length + upcoming.length + previous.length === 0) {
    return <TripListSkeleton />;
  }

  return (
    <View style={styles.stack}>
      <Text style={styles.hint}>العروض أولًا ثم الرحلات المسندة. قبول منطقة لا يعني قبول كل رحلة فيها. التوقيت بتوقيت دمشق.</Text>
      {message ? <Text style={styles.body}>{message}</Text> : null}
      <OfferCards busyOffer={busyOffer} rows={offers} onRespond={respond} />
      <TripCards title="التالية" empty="لا توجد رحلة تالية مسندة إليك." rows={upcoming} />
      <TripCards title="السابقة" empty="لا توجد رحلات سابقة." rows={previous} />
    </View>
  );
}

function OfferCards({
  rows,
  busyOffer,
  onRespond,
}: {
  rows: TripRow[];
  busyOffer: string;
  onRespond: (offerId: string, decision: "ACCEPT" | "REJECT") => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>عروض بانتظار ردك</Text>
      {rows.map((trip) => {
        const offer = trip.myOffer;
        if (!offer) return null;
        const kind = trip.isDaily && !trip.parentTripId ? "يومية" : directionLabels[trip.direction] ?? trip.direction;
        return (
          <View key={trip.id} style={styles.tripCard}>
            <Text style={styles.destination}>{trip.destination.name}</Text>
            <Text style={styles.meta}>
              {trip.reference} · {kind} · {sourceLabels[offer.source] ?? offer.source}
            </Text>
            <Text style={styles.when}>{offer.matchReason}</Text>
            <Text style={styles.when}>الانطلاق {formatWhen(trip.scheduledAt)}</Text>
            <View style={styles.offerActions}>
              <Pressable
                accessibilityRole="button"
                disabled={busyOffer === offer.id}
                onPress={() => void onRespond(offer.id, "REJECT")}
                style={styles.reject}
              >
                <Text style={styles.rejectLabel}>رفض</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busyOffer === offer.id}
                onPress={() => void onRespond(offer.id, "ACCEPT")}
                style={styles.accept}
              >
                <Text style={styles.acceptLabel}>قبول</Text>
              </Pressable>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function TripCards({ title, empty, rows }: { title: string; empty: string; rows: TripRow[] }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {rows.length === 0 ? <Text style={styles.empty}>{empty}</Text> : null}
      {rows.map((trip) => {
        const tone = statusTone(trip.status);
        const kind = trip.isDaily && !trip.parentTripId ? "يومية" : directionLabels[trip.direction] ?? trip.direction;
        return (
          <View key={trip.id} style={styles.tripCard}>
            <View style={styles.cardTop}>
              <Text style={styles.destination}>{trip.destination.name}</Text>
              <Text style={[styles.status, { color: tone.color, backgroundColor: tone.background }]}>
                {statusLabels[trip.status] ?? trip.status}
              </Text>
            </View>
            <Text style={styles.meta}>
              {trip.reference} · {kind}
              {trip.plateNumber ? ` · ${trip.plateNumber}` : ""}
              {` · ${trip.passengerCount} ركاب`}
            </Text>
            <Text style={styles.when}>الانطلاق {formatWhen(trip.scheduledAt)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  hint: { color: colors.muted, fontSize: 14, lineHeight: 22, textAlign: "right" },
  body: { color: colors.ink, textAlign: "right" },
  section: { gap: 8 },
  sectionTitle: { color: colors.ink, fontSize: 16, fontWeight: "700", textAlign: "right" },
  tripCard: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 6,
  },
  cardTop: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8 },
  destination: { flex: 1, color: colors.ink, fontSize: 17, fontWeight: "700", textAlign: "right" },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "right" },
  when: { color: colors.ink, fontSize: 13, textAlign: "right" },
  status: { overflow: "hidden", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 12, fontWeight: "700" },
  empty: { color: colors.muted, textAlign: "right", paddingVertical: 8 },
  offerActions: { flexDirection: "row-reverse", gap: 8, marginTop: 4 },
  accept: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: colors.primaryStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptLabel: { color: colors.card, fontWeight: "700" },
  reject: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  rejectLabel: { color: colors.ink, fontWeight: "700" },
});
