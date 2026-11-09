import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Animated, AppState, Linking, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { WebView } from "react-native-webview";

type MapViewProps = { ready?: undefined };
import * as Location from "expo-location";
import { colors } from "@flyvan/ui/tokens";
import { resolveApiUrl } from "./api-url";
import { driverMapDocument } from "./driver-map";
import { getDriverSession } from "./driver-session";
import { RouteSkeleton } from "./driver-skeleton";

type MapStop = {
  order: number;
  kind: "driver" | "pickup" | "destination";
  label: string;
  latitude: string;
  longitude: string;
  phone: string | null;
  note: string | null;
  passengerId: string | null;
  fareAmount: string | null;
  fareCurrency: string | null;
  farePaidToCompany: boolean;
};

type MapLeg = {
  targetKind: "pickup" | "destination";
  label: string;
  coordinates: { latitude: number; longitude: number }[];
};

type DriverMap = {
  phase: "current" | "next" | "none";
  trip: {
    id: string;
    reference: string;
    direction: string;
    status: string;
    scheduledAt: string;
    arrivesAt: string;
    plannedDepartureAt: string;
    plannedArrivalAt: string;
    startedAt: string | null;
    arrivalState: "ON_TIME" | "LATE" | "STALLED";
    destinationName: string;
    distanceMeters: number;
    durationSeconds: number;
    coordinates: { latitude: number; longitude: number }[];
    legs: MapLeg[];
    stops: MapStop[];
    unlocatedPassengers: string[];
    breakdownReportedAt: string | null;
    breakdownNote: string | null;
  } | null;
};

type Point = { latitude: number; longitude: number; heading?: number | null };
type GpsFix = Point & { accuracy: number; at: number };
type LocationGate = "permission" | "services" | "blocked";

const locationCopy: Record<LocationGate, { title: string; body: string; action: string }> = {
  permission: {
    title: "السماح بالموقع",
    body: "فلاي فان يحتاج موقعك أثناء الرحلة ليبدأ المسار من مكانك ويرتّب صعود الركاب. يُستخدم الموقع على هذه الشاشة فقط.",
    action: "السماح بالموقع",
  },
  services: {
    title: "الموقع مغلق",
    body: "خدمة الموقع متوقفة على الهاتف. افتحها حتى تبقى الخريطة على مكانك الحقيقي ولا يقفز المسار وأنت ثابت.",
    action: "فتح الموقع",
  },
  blocked: {
    title: "صلاحية الموقع مرفوضة",
    body: "فعّل صلاحية الموقع لتطبيق فلاي فان من إعدادات الهاتف، ثم ارجع إلى شاشة الرحلة.",
    action: "فتح إعدادات التطبيق",
  },
};

const collapsedSheet = 108;
const phaseLabels = { current: "الرحلة الحالية", next: "الرحلة التالية", none: "لا توجد رحلة" };

function stopKey(stop: { kind: string; order: number }): string {
  return `${stop.kind}-${stop.order}`;
}
const directionLabels: Record<string, string> = { OUTBOUND: "ذهاب", RETURN: "إياب" };
const statusLabels: Record<string, string> = {
  ASSIGNED: "بانتظار الانطلاق",
  DRIVER_ARRIVED: "عند الراكب",
  IN_PROGRESS: "على الطريق",
};
const arrivalLabels: Record<string, string> = { LATE: "متأخرة", STALLED: "متعثرة" };
const finishRadiusMeters = 500;
const earlyStartMs = 60 * 60 * 1000;
const arrivalGraceMs = 15 * 60 * 1000;

function formatDistance(meters: number): string {
  if (meters < 1000) return `${meters} م`;
  return `${(meters / 1000).toFixed(1)} كم`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} د`;
  return `${Math.floor(minutes / 60)} س ${minutes % 60} د`;
}

function headingToDestination(trip: { stops: { kind: string }[]; unlocatedPassengers: string[] }): boolean {
  return !trip.stops.some((stop) => stop.kind === "pickup") && trip.unlocatedPassengers.length === 0;
}

function formatFare(amount: string | null, currency: string | null, paid: boolean): string {
  if (!amount) return "الأجرة غير مثبتة";
  const money = !currency || currency === "SYP" ? `${amount} ل.س` : `${amount} ${currency}`;
  return `${money} (${paid ? "مدفوعة" : "غير مدفوعة"})`;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function arrivalTone(now: number, arrivesAt: string): "normal" | "warning" | "late" {
  const arrival = new Date(arrivesAt).getTime();
  if (!Number.isFinite(arrival) || now <= arrival) return "normal";
  return now - arrival > arrivalGraceMs ? "late" : "warning";
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }).format(date);
}

function acceptGpsFix(previous: GpsFix | null, next: GpsFix, live: boolean): boolean {
  if (!Number.isFinite(next.latitude) || !Number.isFinite(next.longitude)) return false;
  const accuracy = Number.isFinite(next.accuracy) && next.accuracy > 0 ? next.accuracy : 100;
  if (live) {
    if (accuracy > 45) return false;
    if (!previous) return accuracy <= 65;
    const moved = movedMeters(previous, next);
    const elapsed = Math.max(0.4, (next.at - previous.at) / 1000);
    if (moved / elapsed > 42) return false;
    return moved >= 5 || (elapsed >= 2 && moved >= 2);
  }
  if (!previous) return accuracy <= 65;
  if (accuracy <= 18 && previous.accuracy >= 35) return true;
  if (accuracy > 28 || accuracy > previous.accuracy + 12) return false;
  const moved = movedMeters(previous, next);
  if (moved < 40) return false;
  const elapsed = Math.max(1, (next.at - previous.at) / 1000);
  return moved / elapsed <= 36;
}

function distanceToDestination(trip: { stops: { kind: string; latitude: string; longitude: string }[] }, point: Point): number {
  const stop = trip.stops.find((item) => item.kind === "destination");
  if (!stop) return Number.POSITIVE_INFINITY;
  return movedMeters(point, { latitude: Number(stop.latitude), longitude: Number(stop.longitude) });
}

function movedMeters(from: Point, to: Point): number {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latDelta = toRadians(to.latitude - from.latitude);
  const lngDelta = toRadians(to.longitude - from.longitude);
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const arc = Math.sin(latDelta / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(lngDelta / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(arc)));
}

export function DriverRoute({ onOpenMenu, bottomInset = 0 }: { onOpenMenu: () => void; bottomInset?: number }) {
  const webRef = useRef<WebView<MapViewProps>>(null);
  const lastFetch = useRef<{ at: number; point: Point } | null>(null);
  const finishLock = useRef("");
  const finishing = useRef(false);
  const sheetScroll = useRef<ScrollView>(null);
  const expandedRef = useRef(420);
  const collapsedRef = useRef(collapsedSheet);
  const heightRef = useRef(collapsedSheet);
  const openRef = useRef(false);
  const sheetHeight = useRef(new Animated.Value(collapsedSheet)).current;
  const [point, setPoint] = useState<Point | null>(null);
  const [gate, setGate] = useState<LocationGate | null>(null);
  const [stallOpen, setStallOpen] = useState(false);
  const fixRef = useRef<GpsFix | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const watchGeneration = useRef(0);
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const [map, setMap] = useState<DriverMap | null>(null);
  const [message, setMessage] = useState("");
  const [booting, setBooting] = useState(true);
  const [drawing, setDrawing] = useState(false);
  const drawnFor = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const showAllRef = useRef(false);
  const mapRef = useRef<DriverMap | null>(null);
  const mapReady = useRef(false);
  const pendingRoute = useRef<string | null>(null);
  const revealedRef = useRef<string | null>(null);
  const fittedRef = useRef("");
  const stickRef = useRef(false);
  const passRef = useRef<{ id: string; closest: number } | null>(null);
  const passedIdRef = useRef<string | null>(null);
  const [passedPassengerId, setPassedPassengerId] = useState<string | null>(null);
  const watchLiveRef = useRef(false);
  const resumedRef = useRef(false);
  const userModeRef = useRef(false);
  showAllRef.current = showAll;
  mapRef.current = map;
  const apiUrl = getDriverSession()?.apiUrl ?? resolveApiUrl();
  const source = useMemo(
    () => ({ html: driverMapDocument(`${apiUrl}/api/maps/tiles/{z}/{x}/{y}`), baseUrl: apiUrl }),
    // The map document is generated text. Bump this when that script changes so the WebView reloads it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiUrl, "route-draw-1"],
  );
  const animateSheet = (open: boolean) => {
    openRef.current = open;
    setSheetOpen(open);
    const target = open ? expandedRef.current : collapsedRef.current;
    Animated.spring(sheetHeight, { toValue: target, useNativeDriver: false, friction: 9, tension: 80 }).start(({ finished }) => {
      if (finished) heightRef.current = target;
    });
    if (!open) setSelected(null);
  };
  const animateSheetRef = useRef(animateSheet);
  animateSheetRef.current = animateSheet;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        sheetHeight.stopAnimation((value) => {
          heightRef.current = value;
        });
      },
      onPanResponderMove: (_, gesture) => {
        const next = Math.min(expandedRef.current, Math.max(collapsedRef.current, heightRef.current - gesture.dy));
        sheetHeight.setValue(next);
      },
      onPanResponderRelease: (_, gesture) => {
        const current = Math.min(expandedRef.current, Math.max(collapsedRef.current, heightRef.current - gesture.dy));
        if (Math.abs(gesture.dy) < 8 && Math.abs(gesture.dx) < 8) {
          animateSheetRef.current(!openRef.current);
          return;
        }
        const shouldOpen = gesture.vy < -0.4 || (gesture.vy <= 0.4 && current > (collapsedRef.current + expandedRef.current) / 2);
        animateSheetRef.current(shouldOpen);
      },
    }),
  ).current;

  function publishRoute(
    trip: DriverMap["trip"],
    driverPoint: Point,
    camera: { follow?: boolean; fit?: "driver" | "all" | "leg"; showAll?: boolean; resume?: boolean },
    announce = false,
  ): void {
    notePassage(trip, driverPoint);
    const payload = JSON.stringify({
      coordinates: trip?.coordinates ?? [],
      legs: trip?.legs ?? [],
      stops: trip?.stops ?? [
        { kind: "driver", order: 1, latitude: String(driverPoint.latitude), longitude: String(driverPoint.longitude) },
      ],
      ...(typeof camera.follow === "boolean" ? { follow: camera.follow } : {}),
      ...(camera.fit ? { fit: camera.fit } : {}),
      ...(camera.resume ? { resume: true } : {}),
      tracking: trip?.status === "IN_PROGRESS",
      showAll: camera.showAll ?? showAllRef.current,
      passedPassengerId: passedIdRef.current ?? "",
      driver: driverPoint,
    }).replace(/</g, "\\u003c");
    const script = `${announce ? "window.expectRoutePaint=true;" : ""}window.renderRoute(${payload}); true;`;
    if (!mapReady.current && pendingRoute.current && !camera.fit) return;
    pendingRoute.current = script;
    if (mapReady.current) webRef.current?.injectJavaScript(script);
  }

  function notePassage(trip: DriverMap["trip"], here: Point): void {
    if (!trip || trip.status !== "IN_PROGRESS") {
      if (passedIdRef.current) {
        passedIdRef.current = null;
        passRef.current = null;
        setPassedPassengerId(null);
      }
      return;
    }
    const next = trip.stops.find((stop) => stop.kind === "pickup" && stop.passengerId);
    if (!next?.passengerId) {
      passRef.current = null;
      if (passedIdRef.current) {
        passedIdRef.current = null;
        setPassedPassengerId(null);
      }
      return;
    }
    const distance = movedMeters(here, { latitude: Number(next.latitude), longitude: Number(next.longitude) });
    if (!Number.isFinite(distance)) return;
    if (!passRef.current || passRef.current.id !== next.passengerId) {
      passRef.current = { id: next.passengerId, closest: distance };
    }
    const watch = passRef.current;
    watch.closest = Math.min(watch.closest, distance);
    const passed = watch.closest <= 80 && distance >= 140 && distance >= watch.closest + 50;
    if (passed && passedIdRef.current !== next.passengerId) {
      passedIdRef.current = next.passengerId;
      setPassedPassengerId(next.passengerId);
    }
  }

  function routeSignature(trip: NonNullable<DriverMap["trip"]>, fullRoute: boolean): string {
    return `${trip.id}:${trip.legs.length}:${trip.stops.map((stop) => `${stop.kind}${stop.order}`).join(".")}:${fullRoute ? "all" : "leg"}`;
  }

  async function load(next: Point, force = false): Promise<void> {
    const session = getDriverSession();
    if (!session) {
      setMap(null);
      setBooting(false);
      setMessage("سجّل الدخول من الرئيسية أولًا.");
      return;
    }
    const previous = lastFetch.current;
    if (!force && previous && Date.now() - previous.at < 12_000 && movedMeters(previous.point, next) < 40) return;
    lastFetch.current = { at: Date.now(), point: next };
    if (drawnFor.current === null) setDrawing(true);
    setBusy(true);
    try {
      const response = await fetch(
        `${session.apiUrl}/api/trips/driver-map?latitude=${encodeURIComponent(String(next.latitude))}&longitude=${encodeURIComponent(String(next.longitude))}`,
        { headers: { authorization: `Bearer ${session.accessToken}` } },
      );
      const body = (await response.json()) as DriverMap & { message?: string };
      if (!response.ok) {
        setDrawing(false);
        setMessage(body.message ?? "تعذر حساب مسار الطريق.");
        return;
      }
      setMap(body);
      mapRef.current = body;
      if (!body.trip || body.trip.status !== "IN_PROGRESS") finishLock.current = "";
      setMessage(body.phase === "none" ? "لا توجد رحلة جارية أو رحلة تالية مسندة إليك." : "");
      const trip = body.trip;
      if (!trip) {
        drawnFor.current = "none";
        setDrawing(false);
      }
      if (trip?.status === "IN_PROGRESS") {
        stickRef.current = true;
        if (!watchLiveRef.current) {
          watchLiveRef.current = true;
          void beginWatch(true);
        }
      }
      const hasRoute = Boolean(trip && (trip.coordinates.length > 0 || trip.legs.length > 0));
      if (!hasRoute || !trip) {
        if (trip) drawnFor.current = trip.id;
        setDrawing(false);
        publishRoute(null, next, { follow: true, fit: "driver" });
        return;
      }
      const announce = drawnFor.current !== trip.id;
      if (announce) setDrawing(true);
      const reveal = revealedRef.current !== trip.id;
      const toDestination = headingToDestination(trip);
      if (reveal) revealedRef.current = trip.id;
      if (toDestination) {
        showAllRef.current = false;
        setShowAll(false);
      } else if (reveal) {
        showAllRef.current = true;
        setShowAll(true);
      }
      const fullRoute = showAllRef.current;
      const signature = routeSignature(trip, fullRoute);
      const firstLook = reveal || signature !== fittedRef.current;
      if (firstLook) fittedRef.current = signature;
      if (trip.status === "IN_PROGRESS") {
        stickRef.current = true;
        resumedRef.current = true;
        publishRoute(trip, next, { follow: true, fit: "driver", resume: true, showAll: fullRoute }, announce);
        return;
      }
      if (stickRef.current) {
        const resume = !resumedRef.current;
        resumedRef.current = true;
        publishRoute(trip, next, firstLook
          ? { follow: true, fit: "all", resume: true, showAll: fullRoute }
          : { follow: true, showAll: fullRoute }, announce);
        return;
      }
      if (firstLook) {
        publishRoute(trip, next, { follow: false, fit: fullRoute ? "all" : "leg", showAll: fullRoute }, announce);
      } else {
        publishRoute(trip, next, { showAll: fullRoute }, announce);
      }
    } catch {
      setDrawing(false);
      setMessage("تعذر الوصول إلى الخادم.");
    } finally {
      setBusy(false);
      setBooting(false);
    }
  }

  function stopWatch(): void {
    watchGeneration.current += 1;
    watchRef.current?.remove();
    watchRef.current = null;
  }

  async function beginWatch(live = watchLiveRef.current): Promise<void> {
    const generation = watchGeneration.current + 1;
    watchGeneration.current = generation;
    watchRef.current?.remove();
    const subscription = await Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, distanceInterval: live ? 4 : 12, timeInterval: live ? 1_000 : 4_000 },
      (position) => {
        if (generation !== watchGeneration.current) return;
        const accuracy = position.coords.accuracy ?? 100;
        const heading = position.coords.heading;
        const next = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy,
          at: position.timestamp || Date.now(),
          heading: heading !== null && heading >= 0 ? heading : null,
        };
        const tripLive = watchLiveRef.current || mapRef.current?.trip?.status === "IN_PROGRESS";
        if (!acceptGpsFix(fixRef.current, next, tripLive)) return;
        fixRef.current = next;
        setPoint({ latitude: next.latitude, longitude: next.longitude, heading: next.heading });
      },
    );
    if (generation !== watchGeneration.current) {
      subscription.remove();
      return;
    }
    watchRef.current = subscription;
  }

  async function refreshAccess(): Promise<void> {
    const services = await Location.hasServicesEnabledAsync();
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      stopWatch();
      setGate(permission.canAskAgain ? "permission" : "blocked");
      setBooting(false);
      setMessage(permission.canAskAgain ? "اسمح باستخدام الموقع ليبدأ المسار من مكانك." : "فعّل صلاحية الموقع من إعدادات التطبيق.");
      return;
    }
    if (!services) {
      stopWatch();
      setGate("services");
      setBooting(false);
      setMessage("شغّل خدمة الموقع في الهاتف.");
      return;
    }
    setGate(null);
    await beginWatch();
  }
  refreshRef.current = refreshAccess;

  async function allowLocation(): Promise<void> {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      setGate(permission.canAskAgain ? "permission" : "blocked");
      setMessage(permission.canAskAgain ? "اسمح باستخدام الموقع ليبدأ المسار من مكانك." : "فعّل صلاحية الموقع من إعدادات التطبيق.");
      return;
    }
    await refreshAccess();
  }

  async function openLocationServices(): Promise<void> {
    if (Platform.OS === "android") {
      try {
        await Location.enableNetworkProviderAsync();
      } catch {
        const linking = Linking as typeof Linking & { sendIntent?: (action: string) => Promise<void> };
        if (linking.sendIntent) {
          try {
            await linking.sendIntent("android.settings.LOCATION_SOURCE_SETTINGS");
            return;
          } catch {
            await Linking.openSettings();
            return;
          }
        }
      }
      if (await Location.hasServicesEnabledAsync()) {
        await refreshAccess();
        return;
      }
    }
    await Linking.openSettings();
  }

  useEffect(() => {
    let active = true;
    void refreshRef.current();
    const app = AppState.addEventListener("change", (state) => {
      if (active && state === "active") void refreshRef.current();
    });
    return () => {
      active = false;
      app.remove();
      watchGeneration.current += 1;
      watchRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (!point) return;
    void load(point);
  }, [point]);

  useEffect(() => {
    if (!point) return;
    const trip = mapRef.current?.trip ?? null;
    const hasRoute = Boolean(trip && (trip.coordinates.length > 0 || trip.legs.length > 0));
    if (!hasRoute || !trip) return;
    const fullRoute = showAllRef.current;
    const signature = routeSignature(trip, fullRoute);
    const firstLook = signature !== fittedRef.current;
    if (firstLook) fittedRef.current = signature;
    if (trip.status === "IN_PROGRESS") {
      publishRoute(trip, point, { follow: true, fit: "driver", showAll: fullRoute });
    } else {
      const live = stickRef.current;
      publishRoute(trip, point, firstLook ? { follow: live, fit: fullRoute ? "all" : "leg", showAll: fullRoute } : { follow: live, showAll: fullRoute });
    }
    if (trip?.status === "IN_PROGRESS" && distanceToDestination(trip, point) <= finishRadiusMeters && finishLock.current !== trip.id) {
      finishLock.current = trip.id;
      void finishTrip(point);
    }
  }, [point]);

  useEffect(() => {
    if (!userModeRef.current || !point || !map?.trip) return;
    userModeRef.current = false;
    if (map.trip.status === "IN_PROGRESS") {
      publishRoute(map.trip, point, { follow: true, fit: "driver", showAll });
      return;
    }
    stickRef.current = false;
    resumedRef.current = false;
    fittedRef.current = routeSignature(map.trip, showAll);
    publishRoute(map.trip, point, { follow: false, fit: showAll ? "all" : "leg", showAll });
  }, [showAll]);

  useEffect(() => {
    const push = (value: number) => {
      webRef.current?.injectJavaScript(`window.setSheetInset && window.setSheetInset(${Math.round(value + bottomInset)}); true;`);
    };
    const id = sheetHeight.addListener(({ value }) => push(value));
    sheetHeight.stopAnimation(push);
    return () => sheetHeight.removeListener(id);
  }, [bottomInset, sheetHeight]);

  useEffect(() => {
    if (!drawing) return;
    const timer = setTimeout(() => {
      const id = mapRef.current?.trip?.id;
      if (id) drawnFor.current = id;
      else if (drawnFor.current === null) drawnFor.current = "none";
      setDrawing(false);
    }, 15_000);
    return () => clearTimeout(timer);
  }, [drawing]);

  useEffect(() => {
    webRef.current?.injectJavaScript(`window.selectStop(${JSON.stringify(selected ?? "")}); true;`);
    if (!sheetOpen || !selected) return;
    const index = map?.trip?.stops.findIndex((stop) => stopKey(stop) === selected) ?? -1;
    if (index >= 0) sheetScroll.current?.scrollTo({ y: Math.max(0, index * 76), animated: true });
  }, [selected, sheetOpen]);

  const trip = map?.trip ?? null;
  const phase = map?.phase ?? "none";
  const toDestination = Boolean(trip && headingToDestination(trip));
  const chosen = trip?.stops.find((stop) => stopKey(stop) === selected);
  const nearest = trip?.stops.find((stop) => stop.kind === "pickup");
  const activeTarget = nearest?.label ?? trip?.destinationName;
  const summary = chosen?.label ?? (activeTarget ? `إلى ${activeTarget}` : message);

  async function boardPassenger(passengerId: string): Promise<void> {
    const session = getDriverSession();
    if (!session || !trip || !point) return;
    setBusy(true);
    try {
      const response = await fetch(`${session.apiUrl}/api/trips/${trip.id}/passengers/${passengerId}/boarding`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "BOARDED" }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setMessage(body.message ?? "تعذر تسجيل الصعود.");
        return;
      }
      if (passRef.current?.id === passengerId) passRef.current = null;
      if (passedIdRef.current === passengerId) {
        passedIdRef.current = null;
        setPassedPassengerId(null);
      }
      setMessage("");
      setSelected(null);
      animateSheetRef.current(false);
      await load(point, true);
    } catch {
      setMessage("تعذر الوصول إلى الخادم.");
    } finally {
      setBusy(false);
    }
  }

  async function ignorePassenger(passengerId: string): Promise<void> {
    const session = getDriverSession();
    if (!session || !trip || !point) return;
    setBusy(true);
    try {
      const response = await fetch(`${session.apiUrl}/api/trips/${trip.id}/passengers/${passengerId}/boarding`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "NO_SHOW" }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setMessage(body.message ?? "تعذر تجاهل الراكب.");
        return;
      }
      if (passRef.current?.id === passengerId) passRef.current = null;
      passedIdRef.current = null;
      setPassedPassengerId(null);
      setSelected(null);
      setMessage("تم تجاهل الراكب. أجرته لا تُحتسب، والمسار يتابع إلى الراكب التالي.");
      await load(point, true);
    } catch {
      setMessage("تعذر الوصول إلى الخادم.");
    } finally {
      setBusy(false);
    }
  }

  async function startTrip(): Promise<void> {
    const session = getDriverSession();
    if (!session || !trip || !point) return;
    setBusy(true);
    try {
      const response = await fetch(`${session.apiUrl}/api/trips/${trip.id}/status`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "IN_PROGRESS" }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setMessage(body.message ?? "تعذر بدء الرحلة.");
        return;
      }
      setMessage("");
      stickRef.current = true;
      if (!watchLiveRef.current) {
        watchLiveRef.current = true;
        void beginWatch(true);
      }
      setMap((current) => (current?.trip ? { ...current, trip: { ...current.trip, status: "IN_PROGRESS" } } : current));
      await load(point, true);
    } catch {
      setMessage("تعذر الوصول إلى الخادم.");
    } finally {
      setBusy(false);
    }
  }

  async function finishTrip(next: Point): Promise<void> {
    const session = getDriverSession();
    const current = mapRef.current?.trip;
    if (!session || !current || finishing.current) {
      if (!session || !current) finishLock.current = "";
      return;
    }
    finishing.current = true;
    setBusy(true);
    try {
      const response = await fetch(`${session.apiUrl}/api/trips/${current.id}/status`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          status: "COMPLETED",
          latitude: next.latitude.toFixed(6),
          longitude: next.longitude.toFixed(6),
        }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        finishLock.current = "";
        setMessage(body.message ?? "تعذر إنهاء الرحلة.");
        return;
      }
      setMessage("انتهت الرحلة عند الوصول إلى الوجهة.");
      await load(next, true);
    } catch {
      finishLock.current = "";
      setMessage("تعذر إنهاء الرحلة.");
    } finally {
      finishing.current = false;
      setBusy(false);
    }
  }

  async function reportBreakdown(): Promise<void> {
    const session = getDriverSession();
    if (!session || !trip) return;
    setBusy(true);
    try {
      const response = await fetch(`${session.apiUrl}/api/trips/${trip.id}/breakdown`, {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ note: "عطل أو حادث" }),
      });
      const body = (await response.json()) as { message?: string };
      if (!response.ok) {
        setMessage(body.message ?? "تعذر إبلاغ الإدارة.");
        return;
      }
      setStallOpen(false);
      setMessage("وصل البلاغ إلى الإدارة. أوقف الرحلة. سيتصلون بسائق بديل هاتفيًا.");
      if (point) await load(point, true);
    } catch {
      setMessage("تعذر الوصول إلى الخادم.");
    } finally {
      setBusy(false);
    }
  }

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const departureAt = trip ? new Date(trip.plannedDepartureAt || trip.scheduledAt).getTime() : Number.NaN;
  const arrivalAt = trip ? trip.plannedArrivalAt || trip.arrivesAt : "";
  const startWindowOpen = Number.isFinite(departureAt) && now >= departureAt - earlyStartMs;
  const waitingToStart = Boolean(trip && (trip.status === "ASSIGNED" || trip.status === "DRIVER_ARRIVED") && !startWindowOpen);
  const canStart = Boolean(trip && (trip.status === "ASSIGNED" || trip.status === "DRIVER_ARRIVED") && startWindowOpen);
  const running = trip?.status === "IN_PROGRESS";
  const passedStop = trip?.stops.find((stop) => stop.passengerId && stop.passengerId === passedPassengerId) ?? null;
  const startedAt = trip?.startedAt ? new Date(trip.startedAt).getTime() : departureAt;
  const tone = running ? arrivalTone(now, arrivalAt) : "normal";
  const clockText = running && Number.isFinite(startedAt) ? formatElapsed(now - startedAt) : "";
  const canFinish = Boolean(trip && point && trip.status === "IN_PROGRESS" && distanceToDestination(trip, point) <= finishRadiusMeters);
  const canReportStall = Boolean(trip && trip.status === "IN_PROGRESS" && !trip.breakdownReportedAt);
  const arrivalLabel = trip ? arrivalLabels[trip.arrivalState] : "";

  return (
    <View
      style={styles.screen}
      onLayout={(event) => {
        expandedRef.current = Math.max(280, Math.round(event.nativeEvent.layout.height * 0.74));
        if (openRef.current) sheetHeight.setValue(expandedRef.current);
      }}
    >
      <WebView<MapViewProps>
        ref={webRef}
        originWhitelist={["*"]}
        source={source}
        style={styles.map}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        androidLayerType="hardware"
        onMessage={(event) => {
          try {
            const body = JSON.parse(event.nativeEvent.data) as { type?: string; kind?: string; order?: number };
            if (body.type === "route-ready") {
              const id = mapRef.current?.trip?.id;
              if (id) drawnFor.current = id;
              setDrawing(false);
              return;
            }
            if (body.type !== "stop" || !body.kind || typeof body.order !== "number") return;
            setSelected(`${body.kind}-${body.order}`);
            animateSheetRef.current(true);
          } catch {
            return;
          }
        }}
        onLoadEnd={() => {
          mapReady.current = true;
          fittedRef.current = "";
          sheetHeight.stopAnimation((value) => {
            webRef.current?.injectJavaScript(`window.setSheetInset && window.setSheetInset(${Math.round(value + bottomInset)}); true;`);
          });
          if (pendingRoute.current) webRef.current?.injectJavaScript(pendingRoute.current);
          if (point) void load(point, true);
        }}
      />
      <Pressable
        accessibilityLabel="فتح القائمة"
        accessibilityRole="button"
        onPress={onOpenMenu}
        style={({ pressed }) => [styles.menuButton, pressed ? styles.actionDisabled : null]}
      >
        <Ionicons name="menu" size={22} color={colors.ink} />
      </Pressable>
      {drawing ? (
        <View pointerEvents="none" style={styles.plotOverlay}>
          <View style={styles.plotCard}>
            <ActivityIndicator color={colors.primaryStrong} size="large" />
            <Text style={styles.plotLabel}>يتم رسم مسار الرحلة</Text>
          </View>
        </View>
      ) : null}
      <Animated.View pointerEvents="box-none" style={[styles.toolbar, { bottom: Animated.add(sheetHeight, 10 + bottomInset) }]}>
        {canStart ? (
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => void startTrip()} style={[styles.start, busy ? styles.actionDisabled : null]}>
            <Text style={styles.actionLabel}>بدء الرحلة</Text>
          </Pressable>
        ) : null}
        {passedStop?.passengerId ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              const passengerId = passedStop.passengerId;
              if (passengerId) void ignorePassenger(passengerId);
            }}
            style={[styles.ignore, busy ? styles.actionDisabled : null]}
          >
            <Text style={styles.actionLabel}>{`تجاهل ${passedStop.label}`}</Text>
          </Pressable>
        ) : null}
        {waitingToStart ? (
          <View style={styles.waitBox}>
            <Text style={styles.waitTitle}>بدء الرحلة غير متاح بعد</Text>
            <Text style={styles.waitBody}>يمكن البدء قبل موعد الانطلاق بساعة واحدة، وليس أبكر من ذلك.</Text>
          </View>
        ) : null}
        {canFinish && point ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              finishLock.current = trip?.id ?? "";
              void finishTrip(point);
            }}
            style={[styles.start, busy ? styles.actionDisabled : null]}
          >
            <Text style={styles.actionLabel}>إنهاء الرحلة</Text>
          </Pressable>
        ) : null}
        {trip && toDestination ? (
          <View style={styles.destinationBanner}>
            <Text style={styles.destinationTitle}>أكمل إلى الوجهة</Text>
            <Text style={styles.destinationName}>{trip.destinationName}</Text>
          </View>
        ) : trip ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              userModeRef.current = true;
              setShowAll((value) => !value);
            }}
            style={styles.mode}
          >
            <Text style={styles.modeLabel}>{showAll ? "الراكب التالي" : "المسار الكامل"}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
      <Animated.View style={[styles.sheet, { height: sheetHeight, bottom: bottomInset }]}>
        <View
          accessibilityRole="button"
          accessibilityLabel={sheetOpen ? "طي تفاصيل الرحلة" : "فتح تفاصيل الرحلة"}
          style={styles.handle}
          {...pan.panHandlers}
          onLayout={(event) => {
            const next = Math.ceil(event.nativeEvent.layout.height);
            if (next < 72) return;
            collapsedRef.current = next;
            if (!openRef.current) {
              heightRef.current = next;
              sheetHeight.setValue(next);
            }
          }}
        >
          <View style={styles.grabber} />
          <Text style={styles.kicker}>{phaseLabels[phase]}</Text>
          <Text numberOfLines={1} style={styles.handleTitle}>{summary || "تفاصيل الرحلة"}</Text>
          {trip && running ? (
            <Text style={[styles.handleClock, tone === "warning" ? styles.clockWarning : null, tone === "late" ? styles.clockLate : null]}>
              {tone === "late" ? "تأخر · " : tone === "warning" ? "تجاوز الوصول · " : "مدة الرحلة · "}
              {clockText}
            </Text>
          ) : trip ? (
            <Text style={styles.handleClock}>الانطلاق {formatWhen(trip.plannedDepartureAt || trip.scheduledAt)}</Text>
          ) : null}
        </View>
        <ScrollView ref={sheetScroll} contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {!drawing && booting && !map ? <RouteSkeleton /> : null}
          {!booting && message ? <Text style={styles.alert}>{message}</Text> : null}
          {trip ? (
            <>
              <View style={styles.summary}>
                <Text style={styles.reference}>{trip.reference}</Text>
                <Text style={styles.meta}>
                  {directionLabels[trip.direction] ?? trip.direction} · {statusLabels[trip.status] ?? trip.status}
                  {arrivalLabel ? ` · ${arrivalLabel}` : ""}
                </Text>
                <Text style={styles.meta}>الانطلاق {formatWhen(trip.plannedDepartureAt || trip.scheduledAt)}</Text>
                <Text style={styles.meta}>الوصول {formatWhen(trip.plannedArrivalAt || trip.arrivesAt)}</Text>
                {running ? (
                  <Text style={[styles.clock, tone === "warning" ? styles.clockWarning : null, tone === "late" ? styles.clockLate : null]}>
                    {clockText}
                    {tone === "warning" ? "  تجاوز وقت الوصول" : ""}
                    {tone === "late" ? "  تأخر" : ""}
                  </Text>
                ) : null}
                <Text style={styles.road}>
                  {formatDistance(trip.distanceMeters)} على الطريق · {formatDuration(trip.durationSeconds)}
                </Text>
              </View>
              <View style={styles.timeline}>
              {trip.stops.map((stop, index) => {
                const key = stopKey(stop);
                const active = key === selected;
                const last = index === trip.stops.length - 1;
                return (
                  <Pressable
                    key={key}
                    accessibilityRole="button"
                    onPress={() => setSelected(key)}
                    style={[styles.stop, active ? styles.stopActive : null]}
                  >
                    <View style={styles.rail}>
                      <View style={[styles.stem, index === 0 ? styles.stemHidden : null]} />
                      <View
                        style={[
                          styles.dot,
                          stop.kind === "destination" ? styles.dotDestination : stop.kind === "driver" ? styles.dotDriver : styles.dotPickup,
                        ]}
                      />
                      <View style={[styles.stem, last ? styles.stemHidden : null]} />
                    </View>
                    <View style={styles.stopCopy}>
                      <Text style={styles.stopTitle}>{stop.label}</Text>
                      {stop.kind === "pickup" ? (
                        <Text style={[styles.fare, stop.farePaidToCompany ? styles.farePaid : styles.fareDue]}>
                          {formatFare(stop.fareAmount, stop.fareCurrency, stop.farePaidToCompany)}
                        </Text>
                      ) : null}
                      {stop.note ? <Text style={styles.stopNote}>{stop.note}</Text> : null}
                      {stop.phone ? (
                        <View style={styles.phoneRow}>
                          <Text style={styles.phone}>{stop.phone}</Text>
                          <Pressable
                            accessibilityLabel={`اتصال بـ ${stop.label}`}
                            accessibilityRole="button"
                            onPress={() => {
                              const phone = stop.phone;
                              if (phone) void Linking.openURL(`tel:${phone}`);
                            }}
                            style={({ pressed }) => [styles.call, pressed ? styles.actionDisabled : null]}
                          >
                            <Ionicons name="call" size={16} color={colors.card} />
                            <Text style={styles.callLabel}>اتصال</Text>
                          </Pressable>
                        </View>
                      ) : null}
                      {stop.kind === "pickup" && stop.passengerId ? (
                        <View style={styles.stopActions}>
                          <Pressable
                            accessibilityRole="button"
                            disabled={busy}
                            onPress={() => {
                              const passengerId = stop.passengerId;
                              if (passengerId) void boardPassenger(passengerId);
                            }}
                            style={styles.board}
                          >
                            <Text style={styles.boardLabel}>تم الصعود</Text>
                          </Pressable>
                          {stop.passengerId === passedPassengerId ? (
                            <Pressable
                              accessibilityRole="button"
                              disabled={busy}
                              onPress={() => {
                                const passengerId = stop.passengerId;
                                if (passengerId) void ignorePassenger(passengerId);
                              }}
                              style={styles.ignoreInline}
                            >
                              <Text style={styles.ignoreInlineLabel}>تجاهل</Text>
                            </Pressable>
                          ) : null}
                        </View>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })}
              </View>
              {trip.unlocatedPassengers.length > 0 ? (
                <Text style={styles.alert}>بدون موقع على الخريطة: {trip.unlocatedPassengers.join("، ")}</Text>
              ) : null}
            </>
          ) : null}
          {trip?.breakdownReportedAt ? (
            <Text style={styles.alert}>تم إبلاغ الإدارة بتعثر الرحلة. الإسناد البديل يتم هاتفيًا خارج التطبيق.</Text>
          ) : null}
          {canReportStall ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => setStallOpen(true)}
              style={[styles.stall, busy ? styles.actionDisabled : null]}
            >
              <Text style={styles.actionLabel}>تعثر الرحلة</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={busy || !point}
            onPress={() => {
              if (point) void load(point, true);
            }}
            style={[styles.action, busy || !point ? styles.actionDisabled : null]}
          >
            <Text style={styles.actionLabel}>{busy ? "جارٍ حساب الطريق" : "تحديث المسار"}</Text>
          </Pressable>
          <Text style={styles.safety}>أوقف المركبة قبل استخدام الهاتف.</Text>
        </ScrollView>
      </Animated.View>
      <Modal visible={stallOpen} transparent animationType="fade" onRequestClose={() => setStallOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>تعثر الرحلة</Text>
            <Text style={styles.dialogBody}>
              استخدم هذا الزر عند عطل أو حادث. يصل البلاغ إلى الإدارة، وتبقى الرحلة مفتوحة حتى يلغيها المسؤول. السائق البديل يُتفق معه هاتفيًا خارج التطبيق.
            </Text>
            <Pressable accessibilityRole="button" disabled={busy} onPress={() => void reportBreakdown()} style={styles.stall}>
              <Text style={styles.actionLabel}>{busy ? "جارٍ الإبلاغ" : "إبلاغ الإدارة"}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setStallOpen(false)} style={styles.dialogAction}>
              <Text style={styles.dialogActionLabel}>رجوع</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={gate !== null} transparent animationType="fade" onRequestClose={() => undefined}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogIcon}>📍</Text>
            <Text style={styles.dialogTitle}>{gate ? locationCopy[gate].title : ""}</Text>
            <Text style={styles.dialogBody}>{gate ? locationCopy[gate].body : ""}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                if (gate === "permission") void allowLocation();
                else if (gate === "services") void openLocationServices();
                else void Linking.openSettings();
              }}
              style={styles.dialogAction}
            >
              <Text style={styles.dialogActionLabel}>{gate ? locationCopy[gate].action : ""}</Text>
            </Pressable>
            <Text style={styles.dialogHint}>بعد التفعيل ارجع إلى الرحلة ويبدأ التتبع تلقائيًا.</Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#d7ebf8" },
  map: { ...StyleSheet.absoluteFillObject, backgroundColor: "#d7ebf8" },
  menuButton: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
    elevation: 6,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  plotOverlay: {
    position: "absolute",
    top: 72,
    left: 16,
    right: 72,
    zIndex: 30,
    elevation: 30,
    alignItems: "flex-end",
  },
  plotCard: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  plotLabel: { color: colors.ink, fontWeight: "700", textAlign: "right" },
  toolbar: { position: "absolute", left: 12, right: 12, gap: 8 },
  start: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.primaryStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  mode: {
    alignSelf: "flex-end",
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: "center",
    justifyContent: "center",
  },
  modeLabel: { color: colors.ink, fontWeight: "700" },
  destinationBanner: {
    alignSelf: "flex-end",
    maxWidth: "80%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    gap: 2,
  },
  destinationTitle: { color: colors.primaryStrong, fontWeight: "700", textAlign: "right" },
  destinationName: { color: colors.ink, fontWeight: "700", textAlign: "right" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    overflow: "hidden",
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderColor: colors.line,
    elevation: 8,
    shadowColor: colors.ink,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
  },
  handle: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, gap: 2 },
  grabber: { alignSelf: "center", width: 48, height: 5, borderRadius: 3, backgroundColor: colors.line, marginBottom: 6 },
  kicker: { color: colors.primaryStrong, fontWeight: "700", textAlign: "right", fontSize: 12 },
  handleTitle: { color: colors.ink, fontSize: 16, fontWeight: "700", textAlign: "right" },
  handleClock: { color: colors.ink, fontSize: 13, fontWeight: "700", textAlign: "right" },
  clock: { color: colors.ink, fontSize: 28, fontWeight: "700", textAlign: "right" },
  clockWarning: { color: colors.warning },
  clockLate: { color: colors.danger },
  waitBox: {
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 2,
  },
  ignore: {
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: colors.warning,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  stopActions: { flexDirection: "row-reverse", gap: 8 },
  ignoreInline: {
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.warning,
    alignItems: "center",
    justifyContent: "center",
  },
  ignoreInlineLabel: { color: colors.warning, fontWeight: "700" },
  waitTitle: { color: colors.ink, fontWeight: "700", textAlign: "right" },
  waitBody: { color: colors.muted, textAlign: "right", lineHeight: 20 },
  sheetContent: { paddingHorizontal: 16, paddingBottom: 20, gap: 10 },
  alert: { color: colors.danger, textAlign: "right", lineHeight: 22 },
  summary: { gap: 4, padding: 14, borderRadius: 18, backgroundColor: colors.surface },
  reference: { color: colors.ink, fontSize: 18, fontWeight: "700", textAlign: "right" },
  meta: { color: colors.muted, textAlign: "right" },
  road: { color: colors.tealStrong, fontWeight: "700", textAlign: "right" },
  timeline: { gap: 0 },
  stop: { flexDirection: "row-reverse", gap: 10, alignItems: "stretch", borderRadius: 12, paddingHorizontal: 8 },
  stopActive: { backgroundColor: colors.infoSoft },
  rail: { width: 28, alignItems: "center" },
  stem: { width: 2, flex: 1, minHeight: 12, backgroundColor: colors.line },
  stemHidden: { backgroundColor: "transparent" },
  dot: { width: 14, height: 14, borderRadius: 7, marginVertical: 2 },
  dotDriver: { backgroundColor: colors.primaryStrong },
  dotPickup: { backgroundColor: colors.teal },
  dotDestination: { backgroundColor: colors.warning, borderRadius: 3 },
  stopCopy: { flex: 1, gap: 2, paddingVertical: 8 },
  fare: { textAlign: "right", fontWeight: "700" },
  farePaid: { color: colors.tealStrong },
  fareDue: { color: colors.warning },
  stopTitle: { color: colors.ink, fontSize: 16, fontWeight: "700", textAlign: "right" },
  stopNote: { color: colors.muted, textAlign: "right" },
  phoneRow: { flexDirection: "row-reverse", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 },
  phone: { flex: 1, color: colors.primaryStrong, fontWeight: "700", textAlign: "right" },
  call: {
    flexDirection: "row-reverse",
    alignItems: "center",
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.primaryStrong,
  },
  callLabel: { color: colors.card, fontWeight: "700" },
  board: {
    alignSelf: "flex-end",
    marginTop: 4,
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: colors.teal,
    alignItems: "center",
    justifyContent: "center",
  },
  boardLabel: { color: colors.card, fontWeight: "700" },
  stall: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.danger,
    alignItems: "center",
    justifyContent: "center",
  },
  action: {
    minHeight: 48,
    borderRadius: 12,
    backgroundColor: colors.primaryStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  actionDisabled: { opacity: 0.6 },
  actionLabel: { color: colors.card, fontSize: 16, fontWeight: "700" },
  safety: { color: colors.warning, textAlign: "right" },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 39, 66, 0.46)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  dialog: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.card,
    borderRadius: 28,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    gap: 10,
    borderWidth: 1,
    borderColor: colors.line,
    elevation: 12,
    shadowColor: colors.ink,
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
  },
  dialogIcon: { fontSize: 36, textAlign: "center" },
  dialogTitle: { color: colors.ink, fontSize: 22, fontWeight: "700", textAlign: "center" },
  dialogBody: { color: colors.muted, fontSize: 16, lineHeight: 26, textAlign: "center" },
  dialogAction: {
    minHeight: 52,
    marginTop: 6,
    borderRadius: 16,
    backgroundColor: colors.primaryStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  dialogActionLabel: { color: colors.card, fontSize: 17, fontWeight: "700" },
  dialogHint: { color: colors.muted, fontSize: 13, lineHeight: 20, textAlign: "center" },
});
