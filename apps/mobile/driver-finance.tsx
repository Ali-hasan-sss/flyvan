import { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@flyvan/ui/tokens";
import { driverFetch, getDriverSession } from "./driver-session";
import { FinanceSkeleton } from "./driver-skeleton";

type Commission = {
  id: string;
  tripReference: string;
  fareAmount: string;
  ratePercent: string;
  commissionAmount: string;
  status: string;
  accruedAt: string;
};

type Settlement = {
  id: string;
  amount: string;
  receiptNumber: string;
  status: string;
  receivedAt: string;
};

type OwnFinance = {
  currency: string;
  outstanding: string;
  creditLimitAmount: string | null;
  creditNotice: string | null;
  cashFareNote: string;
  commissions: Commission[];
  settlements: Settlement[];
};

const commissionLabels: Record<string, string> = {
  PENDING: "معلّقة",
  DUE: "مستحقة",
  PARTIALLY_PAID: "مسددة جزئيًا",
  PAID: "مسددة",
  REVERSED: "معكوسة",
  DISPUTED: "متنازع عليها",
};

const settlementLabels: Record<string, string> = {
  RECORDED: "مسجّلة",
  PENDING_REVIEW: "بانتظار الاعتماد",
  APPROVED: "معتمدة",
  REJECTED: "مرفوضة",
  REVERSED: "معكوسة",
};

const whenLabel = new Intl.DateTimeFormat("ar-SY", {
  timeZone: "Asia/Damascus",
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

export function DriverFinance() {
  const [summary, setSummary] = useState<OwnFinance | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!getDriverSession()) {
      setSummary(null);
      setMessage("سجّل الدخول من الرئيسية أولًا.");
      setLoading(false);
      return;
    }
    try {
      const response = await driverFetch("/api/finance/me");
      const body = (await response.json()) as OwnFinance & { message?: string };
      if (!response.ok || !body.outstanding) {
        setSummary(null);
        setMessage(body.message ?? "تعذر قراءة الرصيد.");
        return;
      }
      setSummary(body);
      setMessage("");
    } catch {
      setSummary(null);
      setMessage("تعذر الوصول إلى الخادم.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !summary) return <FinanceSkeleton />;

  if (!summary) {
    return (
      <View style={styles.card}>
        <Text style={styles.section}>العمولة</Text>
        <Text style={styles.body}>{message}</Text>
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.hero}>
        <Text style={styles.heroLabel}>مستحق للشركة</Text>
        <Text style={styles.heroValue}>{summary.outstanding}</Text>
        <Text style={styles.heroUnit}>{summary.currency}</Text>
        <Text style={styles.heroLimit}>الحد الائتماني {summary.creditLimitAmount ?? "غير معيّن"}</Text>
      </View>
      <View style={styles.note}>
        <Ionicons name="cash-outline" size={18} color={colors.primaryStrong} />
        <Text style={styles.noteText}>{summary.cashFareNote}</Text>
      </View>
      {summary.creditNotice ? (
        <View style={styles.warnBox}>
          <Text style={styles.warnText}>{summary.creditNotice}</Text>
        </View>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.section}>آخر العمولات</Text>
        {summary.commissions.length === 0 ? <Text style={styles.body}>لا توجد عمولات بعد.</Text> : null}
        {summary.commissions.map((row) => (
          <View key={row.id} style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle}>{row.tripReference}</Text>
              <Text style={styles.amount}>{row.commissionAmount} {summary.currency}</Text>
            </View>
            <Text style={styles.body}>
              من أجرة {row.fareAmount} بنسبة {row.ratePercent}% · {commissionLabels[row.status] ?? row.status}
            </Text>
            <Text style={styles.body}>{formatWhen(row.accruedAt)}</Text>
          </View>
        ))}
      </View>
      <View style={styles.card}>
        <Text style={styles.section}>التسديدات للشركة</Text>
        {summary.settlements.length === 0 ? <Text style={styles.body}>لا توجد تسديدات مسجّلة.</Text> : null}
        {summary.settlements.map((row) => (
          <View key={row.id} style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle}>إيصال {row.receiptNumber}</Text>
              <Text style={styles.amount}>{row.amount} {summary.currency}</Text>
            </View>
            <Text style={styles.body}>
              {settlementLabels[row.status] ?? row.status} · {formatWhen(row.receivedAt)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  hero: { gap: 4, padding: 20, borderRadius: 24, backgroundColor: colors.ink },
  heroLabel: { color: "#BAE6FD", fontWeight: "700", textAlign: "right" },
  heroValue: { color: colors.card, fontSize: 36, fontWeight: "700", textAlign: "right" },
  heroUnit: { color: "#D6E8F5", fontWeight: "700", textAlign: "right" },
  heroLimit: { color: "#D6E8F5", textAlign: "right", marginTop: 8 },
  note: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 8,
    padding: 14,
    borderRadius: 18,
    backgroundColor: colors.infoSoft,
  },
  noteText: { flex: 1, color: colors.ink, lineHeight: 22, textAlign: "right" },
  warnBox: { padding: 14, borderRadius: 18, backgroundColor: colors.warningSoft },
  warnText: { color: colors.warning, lineHeight: 22, textAlign: "right" },
  card: {
    backgroundColor: colors.card,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  section: { color: colors.ink, fontSize: 16, fontWeight: "700", textAlign: "right" },
  body: { color: colors.muted, fontSize: 14, lineHeight: 22, textAlign: "right" },
  row: { gap: 4, padding: 12, borderRadius: 16, backgroundColor: colors.surface },
  rowTop: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rowTitle: { flex: 1, color: colors.ink, fontSize: 15, fontWeight: "700", textAlign: "right" },
  amount: { color: colors.primaryStrong, fontWeight: "700" },
});
