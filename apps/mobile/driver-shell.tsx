import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@flyvan/ui/tokens";

export type DriverScreen = "home" | "profile" | "areas" | "trips" | "finance";

const links: { id: DriverScreen; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: "home", label: "الرحلات", hint: "العروض والرحلات المسندة", icon: "calendar-outline" },
  { id: "trips", label: "الخريطة", hint: "المسار والركاب", icon: "navigate-outline" },
  { id: "profile", label: "الملف", hint: "الاعتماد والمركبة", icon: "person-outline" },
  { id: "areas", label: "مناطق الخدمة", hint: "أين تستقبل الرحلات", icon: "map-outline" },
  { id: "finance", label: "العمولة", hint: "الرصيد وحد المديونية", icon: "wallet-outline" },
];

const tabs: { id: DriverScreen; label: string; icon: keyof typeof Ionicons.glyphMap; active: keyof typeof Ionicons.glyphMap }[] = [
  { id: "home", label: "الرحلات", icon: "calendar-outline", active: "calendar" },
  { id: "trips", label: "الخريطة", icon: "navigate-outline", active: "navigate" },
  { id: "finance", label: "العمولة", icon: "wallet-outline", active: "wallet" },
];

export function TopBar({ title, menuOpen, onMenu }: { title: string; menuOpen: boolean; onMenu: () => void }) {
  return (
    <View style={styles.top}>
      <Pressable
        accessibilityLabel="فتح القائمة"
        accessibilityRole="button"
        accessibilityState={{ expanded: menuOpen }}
        onPress={onMenu}
        style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
      >
        <Ionicons name="menu" size={24} color={colors.ink} />
      </Pressable>
      <View style={styles.topCopy}>
        <Text style={styles.brand}>فلاي فان</Text>
        <Text style={styles.topTitle}>{title}</Text>
      </View>
    </View>
  );
}

export function TabBar({ screen, onSelect }: { screen: DriverScreen; onSelect: (screen: DriverScreen) => void }) {
  return (
    <View style={styles.nav}>
      {tabs.map((item) => {
        const active = item.id === screen;
        return (
          <Pressable
            key={item.id}
            accessibilityLabel={item.label}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onSelect(item.id)}
            style={({ pressed }) => [styles.navButton, active ? styles.navButtonActive : null, pressed ? styles.pressed : null]}
          >
            <Ionicons name={active ? item.active : item.icon} size={22} color={active ? colors.card : colors.ink} />
            <Text style={[styles.navLabel, active ? styles.navLabelActive : null]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function DriverDrawer({
  open,
  screen,
  name,
  busy,
  onClose,
  onNavigate,
  onLogout,
}: {
  open: boolean;
  screen: DriverScreen;
  name: string | null;
  busy: boolean;
  onClose: () => void;
  onNavigate: (screen: DriverScreen) => void;
  onLogout: () => void;
}) {
  const panelWidth = Math.min(340, Math.round(Dimensions.get("window").width * 0.86));
  const slide = useRef(new Animated.Value(panelWidth)).current;
  const [shown, setShown] = useState(open);
  const [confirmExit, setConfirmExit] = useState(false);
  const reduce = useRef(false);
  const scrim = slide.interpolate({ inputRange: [0, panelWidth], outputRange: [1, 0], extrapolate: "clamp" });

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      reduce.current = value;
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", (value) => {
      reduce.current = value;
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!open) setConfirmExit(false);
    if (open) {
      setShown(true);
      slide.setValue(panelWidth);
      Animated.timing(slide, { toValue: 0, duration: reduce.current ? 0 : 240, useNativeDriver: true }).start();
      return;
    }
    Animated.timing(slide, { toValue: panelWidth, duration: reduce.current ? 0 : 170, useNativeDriver: true }).start(({ finished }) => {
      if (finished) setShown(false);
    });
  }, [open, panelWidth, slide]);

  const initial = name?.trim().charAt(0) || "ف";

  return (
    <Modal animationType="none" onRequestClose={onClose} statusBarTranslucent transparent visible={open || shown}>
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <View style={styles.drawerRoot}>
        <Animated.View style={[styles.scrim, { opacity: scrim }]}>
          <Pressable accessibilityLabel="إغلاق القائمة" onPress={onClose} style={styles.scrimHit} />
        </Animated.View>
        <Animated.View style={[styles.panel, { width: panelWidth, transform: [{ translateX: slide }] }]}>
          <SafeAreaView edges={["top", "bottom"]} style={styles.panelSafe}>
            <View style={styles.panelHead}>
              <Pressable
                accessibilityLabel="إغلاق"
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.iconButton, pressed ? styles.pressed : null]}
              >
                <Ionicons name="close" size={22} color={colors.ink} />
              </Pressable>
              <View style={styles.brandMark}>
                <Ionicons name="navigate" size={20} color={colors.card} />
              </View>
            </View>
            <View style={styles.identity}>
              <View style={styles.avatar}>
                <Text style={styles.avatarLabel}>{initial}</Text>
              </View>
              <View style={styles.identityCopy}>
                <Text numberOfLines={1} style={styles.identityName}>{name ?? "لم تسجّل الدخول"}</Text>
                <Text style={styles.identityRole}>سائق فلاي فان</Text>
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.linkList} showsVerticalScrollIndicator={false}>
              {links.map((item) => {
                const selected = item.id === screen;
                return (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => onNavigate(item.id)}
                    style={({ pressed }) => [styles.link, selected ? styles.linkSelected : null, pressed ? styles.pressed : null]}
                  >
                    <Ionicons name={item.icon} size={22} color={selected ? colors.primaryStrong : colors.ink} />
                    <View style={styles.linkCopy}>
                      <Text style={[styles.linkLabel, selected ? styles.linkLabelSelected : null]}>{item.label}</Text>
                      <Text style={styles.linkHint}>{item.hint}</Text>
                    </View>
                  </Pressable>
                );
              })}
              <View style={styles.safety}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.warning} />
                <Text style={styles.safetyText}>أوقف المركبة قبل استخدام الهاتف. التطبيق غير مخصص للتفاعل أثناء القيادة.</Text>
              </View>
            </ScrollView>
            {name ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  if (!confirmExit) {
                    setConfirmExit(true);
                    return;
                  }
                  onLogout();
                }}
                style={({ pressed }) => [styles.logout, busy ? styles.disabled : null, pressed ? styles.pressed : null]}
              >
                <Ionicons name="log-out-outline" size={20} color={colors.danger} />
                <Text style={styles.logoutLabel}>{busy ? "جارٍ الخروج" : confirmExit ? "تأكيد الخروج" : "تسجيل الخروج"}</Text>
              </Pressable>
            ) : (
              <Text style={styles.guestNote}>تسجيل الخروج يظهر بعد الدخول.</Text>
            )}
          </SafeAreaView>
        </Animated.View>
      </View>
      </SafeAreaProvider>
    </Modal>
  );
}

const styles = StyleSheet.create({
  top: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  topCopy: { flex: 1, gap: 2 },
  brand: { color: colors.primaryStrong, fontSize: 12, fontWeight: "700", textAlign: "right" },
  topTitle: { color: colors.ink, fontSize: 26, fontWeight: "700", textAlign: "right" },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.72 },
  nav: {
    flexDirection: "row-reverse",
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 6,
    borderRadius: 28,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    elevation: 8,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  navButton: { flex: 1, minHeight: 52, borderRadius: 22, alignItems: "center", justifyContent: "center", gap: 2 },
  navButtonActive: { backgroundColor: colors.primaryStrong },
  navLabel: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  navLabelActive: { color: colors.card },
  drawerRoot: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15, 39, 66, 0.5)" },
  scrimHit: { flex: 1 },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    backgroundColor: colors.page,
    borderTopLeftRadius: 28,
    borderBottomLeftRadius: 28,
    elevation: 16,
    shadowColor: colors.ink,
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: -8, height: 0 },
  },
  panelSafe: { flex: 1, paddingHorizontal: 16, paddingBottom: 12 },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingTop: 8 },
  brandMark: {
    width: 44,
    height: 44,
    borderRadius: 16,
    backgroundColor: colors.primaryStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  identity: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    marginTop: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 20,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.infoSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLabel: { color: colors.primaryStrong, fontSize: 20, fontWeight: "700" },
  identityCopy: { flex: 1, gap: 2 },
  identityName: { color: colors.ink, fontSize: 18, fontWeight: "700", textAlign: "right" },
  identityRole: { color: colors.muted, textAlign: "right" },
  linkList: { gap: 8, paddingVertical: 12 },
  link: {
    minHeight: 64,
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  linkSelected: { backgroundColor: colors.infoSoft, borderColor: colors.primary },
  linkCopy: { flex: 1, gap: 2 },
  linkLabel: { color: colors.ink, fontSize: 16, fontWeight: "700", textAlign: "right" },
  linkLabelSelected: { color: colors.primaryStrong },
  linkHint: { color: colors.muted, fontSize: 13, textAlign: "right" },
  safety: {
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    gap: 8,
    marginTop: 8,
    padding: 12,
    borderRadius: 16,
    backgroundColor: colors.warningSoft,
  },
  safetyText: { flex: 1, color: colors.warning, lineHeight: 20, textAlign: "right" },
  logout: {
    minHeight: 52,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.dangerSoft,
    backgroundColor: colors.dangerSoft,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  logoutLabel: { color: colors.danger, fontSize: 16, fontWeight: "700" },
  guestNote: { color: colors.muted, textAlign: "center", paddingVertical: 8 },
  disabled: { opacity: 0.6 },
});
