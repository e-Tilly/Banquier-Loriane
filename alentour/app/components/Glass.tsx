/**
 * GlassLayer: the frosted background of a panel. Put it as the FIRST child of a container that has
 * `overflow: "hidden"` and a borderRadius; it fills the container. Web blurs with CSS; iOS and
 * Android blur with expo-blur, so the same panel looks the same everywhere.
 */
import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { BlurView } from "expo-blur";
import { usePalette } from "../lib/theme.ts";

export function GlassLayer({ strong, onArt, radius = 0 }: { strong?: boolean; onArt?: boolean; radius?: number }) {
  const p = usePalette();
  const g = onArt ? p.glassOnArt : strong ? p.glassStrong : p.glass;
  if (Platform.OS === "web") return <View pointerEvents="none" style={[StyleSheet.absoluteFill, g, { borderRadius: radius }]} />;
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: "hidden" }]}>
      <BlurView intensity={onArt ? 40 : strong ? 70 : 55} tint="light" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: g.backgroundColor }]} />
    </View>
  );
}
