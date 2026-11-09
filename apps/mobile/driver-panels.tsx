import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@flyvan/ui/tokens";
import { driverFetch, getDriverSession } from "./driver-session";
import { AreasSkeleton, ProfileSkeleton } from "./driver-skeleton";

type AreaLink = {
  id: string;
  serviceAreaId: string;
  name: string;
  preference: string;
  status: string;
};

type Profile = {
  displayName: string;
  approvalStatus: string;
  nearbyRadiusMeters: number;
  acceptsNearbyRequests: boolean;
  assignmentBlocked: boolean;
  primaryVehicle: { plateNumber: string; approvalStatus: string } | null;
  documents: { id: string; kind: string; status: string }[];
  serviceAreas: AreaLink[];
  availableAreas: { id: string; name: string }[];
};

const approvalLabels: Record<string, string> = {
  PENDING: "قيد المراجعة",
  APPROVED: "معتمد",
  SUSPENDED: "موقوف",
  REJECTED: "مرفوض",
};

export function DriverPanels({ screen }: { screen: "profile" | "areas" }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(): Promise<void> {
    const session = getDriverSession();
    if (!session) {
      setProfile(null);
      setMessage("سجّل الدخول من الرئيسية أولًا.");
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`${session.apiUrl}/api/drivers/me`, {
        headers: { authorization: `Bearer ${session.accessToken}` },
      });
      const body = (await response.json()) as Profile & { message?: string };
      if (!response.ok) {
        setProfile(null);
        setMessage(body.message ?? "تعذر قراءة الملف.");
        return;
      }
      setProfile(body);
      setMessage("");
    } catch {
      setProfile(null);
      setMessage("تعذر الوصول إلى الخادم.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [screen]);

  async function toggleNearby(): Promise<void> {
    if (!profile || !getDriverSession()) return;
    const next = !profile.acceptsNearbyRequests;
    try {
      const response = await driverFetch("/api/drivers/me", {
        method: "PATCH",
        body: JSON.stringify({ acceptsNearbyRequests: next }),
      });
      const body = (await response.json()) as { message?: string };
      if (response.ok) await load();
      setMessage(response.ok ? (next ? "ستصلك عروض الطلبات القريبة، وقبول كل رحلة يبقى قرارك." : "توقفت عروض الطلبات القريبة.") : (body.message ?? "تعذر تحديث التفضيل."));
    } catch {
      setMessage("تعذر الوصول إلى الخادم.");
    }
  }

  async function requestArea(serviceAreaId: string): Promise<void> {
    if (!getDriverSession()) {
      return;
    }
    const response = await driverFetch("/api/drivers/me/service-areas", {
      method: "POST",
      body: JSON.stringify({ serviceAreaId, preference: "TARGET" }),
    });
    const body = (await response.json()) as { message?: string };
    if (response.ok) await load();
    setMessage(response.ok ? "أُرسل طلب المنطقة. القبول مراجعة منفصلة ولا يسند رحلة." : (body.message ?? "تعذر الطلب."));
  }

  if (loading && !profile) {
    return screen === "profile" ? <ProfileSkeleton /> : <AreasSkeleton />;
  }

  if (!profile) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{screen === "profile" ? "الملف والاعتماد" : "مناطق الخدمة"}</Text>
        <Text style={styles.body}>{message}</Text>
      </View>
    );
  }

  if (screen === "profile") {
    const approval = approvalLabels[profile.approvalStatus] ?? profile.approvalStatus;
    const approved = profile.approvalStatus === "APPROVED";
    return (
      <View style={styles.stack}>
        <View style={styles.hero}>
          <Text style={styles.kicker}>{profile.displayName}</Text>
          <View style={[styles.pill, approved ? styles.pillGood : styles.pillWarn]}>
            <Text style={[styles.pillLabel, approved ? styles.pillLabelGood : styles.pillLabelWarn]}>{approval}</Text>
          </View>
        </View>
        <View style={styles.card}>
          <View style={styles.row}>
            <Ionicons name="car-outline" size={22} color={colors.primaryStrong} />
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>المركبة الأساسية</Text>
              <Text style={styles.body}>
                {profile.primaryVehicle
                  ? `${profile.primaryVehicle.plateNumber} · ${approvalLabels[profile.primaryVehicle.approvalStatus] ?? profile.primaryVehicle.approvalStatus}`
                  : "لا توجد مركبة أساسية"}
              </Text>
            </View>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: profile.acceptsNearbyRequests }}
            onPress={() => void toggleNearby()}
            style={({ pressed }) => [styles.switchRow, pressed ? styles.pressed : null]}
          >
            <View style={[styles.track, profile.acceptsNearbyRequests ? styles.trackOn : null]}>
              <View style={[styles.knob, profile.acceptsNearbyRequests ? styles.knobOn : null]} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowTitle}>الطلبات القريبة</Text>
              <Text style={styles.body}>
                {profile.acceptsNearbyRequests ? "مفعّلة" : "متوقفة"} ضمن {profile.nearbyRadiusMeters} متر. القبول يبقى قرارك لكل رحلة.
              </Text>
            </View>
          </Pressable>
          <Text style={profile.assignmentBlocked ? styles.warn : styles.body}>
            {profile.assignmentBlocked ? "الإسناد موقوف إداريًا." : "لا يوجد إيقاف إداري للإسناد."}
          </Text>
          {message ? <Text style={styles.body}>{message}</Text> : null}
        </View>
        <View style={styles.card}>
          <Text style={styles.rowTitle}>الوثائق</Text>
          {profile.documents.length === 0 ? <Text style={styles.body}>لا توجد وثائق مرفوعة.</Text> : null}
          <View style={styles.chips}>
            {profile.documents.map((item) => (
              <View key={item.id} style={styles.chip}>
                <Text style={styles.chipLabel}>
                  {item.kind} · {approvalLabels[item.status] ?? item.status}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.title}>مناطقك</Text>
        <Text style={styles.body}>طلب المنطقة لا يعني قبول كل رحلة داخلها.</Text>
        {message ? <Text style={styles.body}>{message}</Text> : null}
        {profile.serviceAreas.length === 0 ? <Text style={styles.body}>لم تختر منطقة بعد.</Text> : null}
        {profile.serviceAreas.map((link) => (
          <View key={link.id} style={styles.areaRow}>
            <Text style={styles.rowTitle}>{link.name}</Text>
            <Text style={styles.pillLabel}>{approvalLabels[link.status] ?? link.status}</Text>
          </View>
        ))}
      </View>
      {profile.availableAreas.map((area) => (
        <Pressable
          key={area.id}
          accessibilityRole="button"
          onPress={() => {
            void requestArea(area.id);
          }}
          style={({ pressed }) => [styles.request, pressed ? styles.pressed : null]}
        >
          <Ionicons name="add" size={20} color={colors.primaryStrong} />
          <Text style={styles.requestLabel}>طلب {area.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  hero: {
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: 20,
    borderRadius: 24,
    backgroundColor: colors.ink,
  },
  kicker: { flex: 1, color: colors.card, fontSize: 22, fontWeight: "700", textAlign: "right" },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  title: { color: colors.ink, fontSize: 18, fontWeight: "700", textAlign: "right" },
  body: { color: colors.muted, fontSize: 14, lineHeight: 22, textAlign: "right" },
  warn: { color: colors.warning, fontSize: 14, lineHeight: 22, textAlign: "right" },
  row: { flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  rowCopy: { flex: 1, gap: 2 },
  rowTitle: { color: colors.ink, fontSize: 16, fontWeight: "700", textAlign: "right" },
  switchRow: { minHeight: 56, flexDirection: "row-reverse", alignItems: "center", gap: 12 },
  track: {
    width: 52,
    height: 32,
    borderRadius: 16,
    padding: 3,
    backgroundColor: colors.line,
    flexDirection: "row",
  },
  trackOn: { backgroundColor: colors.primaryStrong },
  knob: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.card },
  knobOn: { marginLeft: "auto" },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  pillGood: { backgroundColor: colors.successSoft },
  pillWarn: { backgroundColor: colors.warningSoft },
  pillLabel: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  pillLabelGood: { color: colors.success },
  pillLabelWarn: { color: colors.warning },
  chips: { flexDirection: "row-reverse", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 8 },
  chipLabel: { color: colors.ink, fontWeight: "700" },
  areaRow: {
    minHeight: 48,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
  },
  request: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  requestLabel: { color: colors.primaryStrong, fontSize: 16, fontWeight: "700" },
  pressed: { opacity: 0.72 },
});
