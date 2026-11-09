import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { AccessibilityInfo, Animated, StyleSheet, View, type DimensionValue } from "react-native";
import { colors } from "@flyvan/ui/tokens";

const Pulse = createContext<Animated.Value | null>(null);

export function Skeleton({ children }: { children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0.55)).current;
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduce(value);
    });
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduce) {
      opacity.setValue(0.72);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduce]);

  return (
    <Pulse.Provider value={opacity}>
      <View accessibilityLabel="جارٍ التحميل" accessibilityState={{ busy: true }} style={styles.stack}>
        {children}
      </View>
    </Pulse.Provider>
  );
}

export function Bone({
  width = "100%",
  height = 14,
  radius = 8,
  tone = "line",
}: {
  width?: DimensionValue;
  height?: number;
  radius?: number;
  tone?: "line" | "ink";
}) {
  const opacity = useContext(Pulse);
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={{
        width,
        height,
        borderRadius: radius,
        backgroundColor: tone === "ink" ? "rgba(255,255,255,0.28)" : colors.line,
        opacity: opacity ?? 0.7,
      }}
    />
  );
}

export function HomeSkeleton() {
  return (
    <Skeleton>
      <View style={styles.hero}>
        <Bone width="28%" tone="ink" />
        <Bone height={28} width="62%" tone="ink" />
        <Bone width="92%" tone="ink" />
        <Bone height={52} radius={16} tone="ink" />
      </View>
      <TripListSkeleton bare />
    </Skeleton>
  );
}

export function TripListSkeleton({ bare = false }: { bare?: boolean }) {
  const body = (
    <>
      <Bone width="46%" />
      <TripCardSkeleton />
      <TripCardSkeleton />
    </>
  );
  if (bare) return <View style={styles.stack}>{body}</View>;
  return <Skeleton>{body}</Skeleton>;
}

export function FinanceSkeleton() {
  return (
    <Skeleton>
      <View style={styles.hero}>
        <Bone width="38%" tone="ink" />
        <Bone height={36} width="48%" tone="ink" />
        <Bone width="28%" tone="ink" />
      </View>
      <Bone height={72} radius={18} />
      <Bone height={96} radius={20} />
      <Bone height={96} radius={20} />
    </Skeleton>
  );
}

export function ProfileSkeleton() {
  return (
    <Skeleton>
      <Bone height={84} radius={24} />
      <View style={styles.card}>
        <Bone width="72%" />
        <Bone width="88%" />
        <Bone height={56} radius={16} />
      </View>
      <Bone height={88} radius={20} />
    </Skeleton>
  );
}

export function AreasSkeleton() {
  return (
    <Skeleton>
      <View style={styles.card}>
        <Bone width="40%" height={18} />
        <Bone width="86%" />
        <Bone height={48} radius={14} />
      </View>
      <Bone height={52} radius={16} />
      <Bone height={52} radius={16} />
    </Skeleton>
  );
}

export function RouteSkeleton() {
  return (
    <Skeleton>
      <Bone width="36%" />
      <Bone height={18} width="68%" />
      <Bone width="52%" />
      <Bone height={84} radius={18} />
    </Skeleton>
  );
}

function TripCardSkeleton() {
  return (
    <View style={styles.card}>
      <Bone height={18} width="64%" />
      <Bone width="80%" />
      <Bone width="46%" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  hero: { gap: 10, padding: 20, borderRadius: 24, backgroundColor: colors.ink },
  card: { gap: 10, padding: 16, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
});
