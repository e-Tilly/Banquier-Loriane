/**
 * The backdrop behind every screen: a pastel gradient with a few large soft colour fields. Glass
 * panels blur this, which is what makes them read as glass. The fields lean toward the colours of
 * the activities on screen (see lib/ambient.tsx) and change slowly.
 */
import React, { useEffect, useRef } from "react";
import { Animated, Platform, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { useAmbient } from "../lib/ambient.tsx";
import { mix } from "../lib/palettes.ts";

const BLOBS = [
  { color: "#B9C8FF", size: 420, left: -140, top: -120 },
  { color: "#FFC9DC", size: 380, right: -150, top: 160 },
  { color: "#B8EBD8", size: 440, left: -120, bottom: -160 },
  { color: "#FFE2B8", size: 300, right: -80, bottom: 40 },
] as const;

/** Soften the activity colour, then keep a third of the original pastel so it only drifts. */
const tint = (ambient: string | undefined, base: string) => (ambient ? mix(mix(ambient, "#FFFFFF", 0.2), base, 0.3) : base);

function Blob({ color, size, pos }: { color: string; size: number; pos: object }) {
  const from = useRef(color), to = useRef(color), t = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (color === to.current) return;
    from.current = to.current; to.current = color;
    t.setValue(0);
    Animated.timing(t, { toValue: 1, duration: 1100, useNativeDriver: false }).start();
  }, [color, t]);
  return (
    <Animated.View style={[
      { position: "absolute", width: size, height: size, borderRadius: size / 2, opacity: 0.75,
        backgroundColor: t.interpolate({ inputRange: [0, 1], outputRange: [from.current, to.current] }) },
      pos, Platform.OS === "web" ? ({ filter: "blur(70px)" } as object) : null,
    ]} />
  );
}

export function AppBackground() {
  const { colors } = useAmbient();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={["#EDF1FF", "#F8EFF7", "#EAF7F1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {BLOBS.map((b, i) => (
        <Blob key={i} size={b.size} color={tint(colors.length ? colors[i % colors.length] : undefined, b.color)}
          pos={{ ..."left" in b ? { left: b.left } : { right: b.right }, ..."top" in b ? { top: b.top } : { bottom: b.bottom } }} />
      ))}
      {Platform.OS === "web" ? null : <BlurView intensity={90} tint="light" style={StyleSheet.absoluteFill} />}
    </View>
  );
}
