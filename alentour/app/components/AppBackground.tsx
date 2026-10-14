/**
 * The backdrop behind every screen: a pastel gradient with a few large soft colour fields. Glass
 * panels blur this, which is what makes them read as glass. Fixed in place while screens scroll.
 */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";

const BLOBS = [
  { color: "#B9C8FF", size: 420, left: -140, top: -120 },
  { color: "#FFC9DC", size: 380, right: -150, top: 160 },
  { color: "#B8EBD8", size: 440, left: -120, bottom: -160 },
  { color: "#FFE2B8", size: 300, right: -80, bottom: 40 },
] as const;

export function AppBackground() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={["#EDF1FF", "#F8EFF7", "#EAF7F1"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      {BLOBS.map((b, i) => (
        <View key={i} style={[
          { position: "absolute", width: b.size, height: b.size, borderRadius: b.size / 2, backgroundColor: b.color, opacity: 0.75 },
          "left" in b ? { left: b.left } : { right: b.right }, "top" in b ? { top: b.top } : { bottom: b.bottom },
          Platform.OS === "web" ? ({ filter: "blur(70px)" } as object) : null,
        ]} />
      ))}
      {Platform.OS === "web" ? null : <BlurView intensity={90} tint="light" style={StyleSheet.absoluteFill} />}
    </View>
  );
}
