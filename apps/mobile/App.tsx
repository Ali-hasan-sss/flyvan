import { useEffect, useRef, useState } from "react";
import { Dimensions, Keyboard, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View } from "react-native";
import { initialWindowMetrics, SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@flyvan/ui/tokens";
import { DriverFinance } from "./driver-finance";
import { DriverPanels } from "./driver-panels";
import { DriverRoute } from "./driver-route";
import { DriverSchedule } from "./driver-schedule";
import { DriverDrawer, TabBar, TopBar, type DriverScreen } from "./driver-shell";
import { HomeSkeleton } from "./driver-skeleton";
import { resolveApiUrl } from "./api-url";
import { clearDriverLogin, restoreDriverLogin, saveDriverLogin } from "./driver-session";

const titles: Record<DriverScreen, string> = {
  home: "الرحلات",
  profile: "الملف",
  areas: "المناطق",
  trips: "الخريطة",
  finance: "العمولة",
};

function useKeyboardInset(): { open: boolean; overlap: number } {
  const [inset, setInset] = useState({ open: false, overlap: 0 });

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (event) => {
      requestAnimationFrame(() => {
        const windowHeight = Dimensions.get("window").height;
        const covered = windowHeight - event.endCoordinates.screenY;
        setInset({ open: true, overlap: Math.max(0, Math.round(covered)) });
      });
    });
    const hide = Keyboard.addListener(hideEvent, () => setInset({ open: false, overlap: 0 }));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return inset;
}

export function App() {
  return (
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <DriverApp />
    </SafeAreaProvider>
  );
}

function DriverApp() {
  const [screen, setScreen] = useState<DriverScreen>("home");
  const [menu, setMenu] = useState(false);
  const [sessionName, setSessionName] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const keyboard = useKeyboardInset();
  const insets = useSafeAreaInsets();
  const mapScreen = screen === "trips";
  const mapTabClearance = keyboard.open ? 0 : insets.bottom + 82;

  useEffect(() => {
    let active = true;
    void restoreDriverLogin().then((saved) => {
      if (!active) return;
      setSessionName(saved?.displayName ?? null);
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!keyboard.open || screen !== "home") return;
    const frame = requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => cancelAnimationFrame(frame);
  }, [keyboard.open, keyboard.overlap, screen]);

  async function logout(): Promise<void> {
    setLeaving(true);
    try {
      await clearDriverLogin();
      setSessionName(null);
      setScreen("home");
      setMenu(false);
    } finally {
      setLeaving(false);
    }
  }

  function open(next: DriverScreen): void {
    setScreen(next);
    setMenu(false);
  }

  return (
    <View style={styles.safe}>
      <StatusBar backgroundColor={colors.page} barStyle="dark-content" />
      <SafeAreaView edges={mapScreen ? ["top", "left", "right"] : ["top", "left", "right", "bottom"]} style={styles.safe}>
      {mapScreen ? (
        <View style={styles.mapStage}>
          <DriverRoute bottomInset={mapTabClearance} onOpenMenu={() => setMenu(true)} />
          {keyboard.open ? null : (
            <View pointerEvents="box-none" style={[styles.mapNav, { bottom: insets.bottom }]}>
              <TabBar screen={screen} onSelect={open} />
            </View>
          )}
        </View>
      ) : (
        <>
          <TopBar menuOpen={menu} onMenu={() => setMenu(true)} title={titles[screen]} />
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={[styles.content, { paddingBottom: keyboard.overlap > 0 ? keyboard.overlap + 16 : 24 }]}
          >
            {screen === "home" ? (
              <Home
                ready={ready}
                sessionName={sessionName}
                onSignedIn={setSessionName}
                onOpenRoute={() => setScreen("trips")}
                onFocusField={() => scrollRef.current?.scrollToEnd({ animated: true })}
              />
            ) : screen === "profile" || screen === "areas" ? (
              <DriverPanels screen={screen} />
            ) : (
              <DriverFinance />
            )}
          </ScrollView>
        </>
      )}
      {keyboard.open || mapScreen ? null : <TabBar screen={screen} onSelect={open} />}
      <DriverDrawer
        busy={leaving}
        name={sessionName}
        onClose={() => setMenu(false)}
        onLogout={() => void logout()}
        onNavigate={open}
        open={menu}
        screen={screen}
      />
      </SafeAreaView>
    </View>
  );
}

function Home({
  ready,
  sessionName,
  onSignedIn,
  onOpenRoute,
  onFocusField,
}: {
  ready: boolean;
  sessionName: string | null;
  onSignedIn: (name: string) => void;
  onOpenRoute: () => void;
  onFocusField: () => void;
}) {
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const apiUrl = resolveApiUrl();

  useEffect(() => {
    if (!sessionName) setMessage("");
  }, [sessionName]);

  async function checkConnection(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/health`);
      const body = (await response.json()) as { database?: string };
      if (response.ok && body.database === "up") {
        setNotice("الخادم وقاعدة البيانات متصلان.");
      } else if (response.status === 503) {
        setNotice("الخادم يعمل وقاعدة البيانات غير متصلة.");
      } else {
        setNotice("استجابة فحص الصحة غير متوقعة.");
      }
    } catch {
      setNotice(`تعذر الوصول إلى ${apiUrl}. الهاتف والكمبيوتر يجب أن يكونا على نفس الشبكة.`);
    } finally {
      setBusy(false);
    }
  }

  async function login(): Promise<void> {
    setBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier, password }),
      });
      const body = (await response.json()) as {
        message?: string;
        accessToken?: string;
        user?: { displayName?: string };
        refreshToken?: string;
      };
      if (!response.ok || !body.user?.displayName || !body.refreshToken || !body.accessToken) {
        setMessage(body.message ?? "تعذر تسجيل الدخول.");
        return;
      }
      await saveDriverLogin({
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        displayName: body.user.displayName,
      });
      setPassword("");
      setMessage("");
      onSignedIn(body.user.displayName);
    } catch {
      setMessage(`تعذر الوصول إلى خادم الدخول على ${apiUrl}.`);
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return <HomeSkeleton />;
  }

  if (sessionName) {
    return (
      <View style={styles.stack}>
        <View style={styles.welcome}>
          <Text style={styles.welcomeKicker}>مرحبًا</Text>
          <Text style={styles.welcomeName}>{sessionName}</Text>
          <Text style={styles.welcomeBody}>العروض والرحلات المسندة إليك بالأسفل. الخريطة تفتح الرحلة النشطة.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onOpenRoute}
            style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
          >
            <Ionicons name="navigate" size={18} color={colors.card} />
            <Text style={styles.actionLabel}>فتح الرحلة</Text>
          </Pressable>
        </View>
        <DriverSchedule />
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      <View style={styles.loginCard}>
        <Text style={styles.loginTitle}>دخول السائق</Text>
        <Text style={styles.loginBody}>استخدم البريد أو الهاتف المعتمد من الشركة. الجلسة تبقى على هذا الجهاز.</Text>
        <TextInput
          accessibilityLabel="البريد أو الهاتف"
          autoCapitalize="none"
          autoComplete="username"
          onChangeText={setIdentifier}
          onFocus={onFocusField}
          placeholder="البريد أو الهاتف"
          placeholderTextColor={colors.muted}
          style={styles.input}
          textAlign="right"
          textContentType="username"
          value={identifier}
        />
        <TextInput
          accessibilityLabel="كلمة المرور"
          autoComplete="password"
          onChangeText={setPassword}
          onFocus={onFocusField}
          placeholder="كلمة المرور"
          placeholderTextColor={colors.muted}
          secureTextEntry
          style={styles.input}
          textAlign="right"
          textContentType="password"
          value={password}
        />
        {message ? <Text style={styles.error}>{message}</Text> : null}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void login()}
          style={({ pressed }) => [styles.action, busy ? styles.disabled : null, pressed ? styles.pressed : null]}
        >
          <Text style={styles.actionLabel}>{busy ? "جارٍ الدخول" : "تسجيل الدخول"}</Text>
        </Pressable>
      </View>
      {__DEV__ ? (
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void checkConnection()} style={styles.devCheck}>
          <Text style={styles.devLabel}>{notice || `فحص الاتصال · ${apiUrl}`}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.page },
  mapStage: { flex: 1 },
  mapNav: { position: "absolute", left: 0, right: 0, zIndex: 20, elevation: 24 },
  content: { flexGrow: 1, paddingHorizontal: 16, gap: 16 },
  stack: { gap: 16 },
  welcome: {
    gap: 8,
    padding: 20,
    borderRadius: 24,
    backgroundColor: colors.ink,
  },
  welcomeKicker: { color: "#BAE6FD", fontWeight: "700", textAlign: "right" },
  welcomeName: { color: colors.card, fontSize: 28, fontWeight: "700", textAlign: "right" },
  welcomeBody: { color: "#D6E8F5", lineHeight: 22, textAlign: "right" },
  loginCard: {
    gap: 12,
    padding: 20,
    borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  loginTitle: { color: colors.ink, fontSize: 22, fontWeight: "700", textAlign: "right" },
  loginBody: { color: colors.muted, lineHeight: 22, textAlign: "right" },
  status: { color: colors.muted, textAlign: "right" },
  error: { color: colors.danger, textAlign: "right", lineHeight: 22 },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 14,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  action: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.primaryStrong,
    flexDirection: "row-reverse",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  actionLabel: { color: colors.card, fontSize: 17, fontWeight: "700" },
  pressed: { opacity: 0.72 },
  disabled: { opacity: 0.6 },
  devCheck: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  devLabel: { color: colors.muted, fontSize: 13, fontWeight: "700", textAlign: "center" },
});
