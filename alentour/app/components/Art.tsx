/**
 * Artwork for an activity. A real photo when the business has one; otherwise generated art — a
 * category gradient with large soft shapes, placed from the activity's id so every listing gets a
 * stable, different composition. It stands in for photography the catalog doesn't have yet.
 */
import React from "react";
import { View, Image, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { mediaUrl } from "../lib/config.ts";

import { paletteFor } from "../lib/palettes.ts";

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h);
}

interface Props {
  id: string;
  category: string;
  img?: { key: string };
  style?: StyleProp<ViewStyle>;
  /** Darken the bottom so white text on top stays readable. */
  scrim?: boolean;
  children?: React.ReactNode;
}

export function Art({ id, category, img, style, scrim, children }: Props) {
  const [c1, c2, c3] = paletteFor(category);
  const h = hash(id);
  const a = (h % 100) / 100, b = ((h >> 7) % 100) / 100, c = ((h >> 14) % 100) / 100;
  return (
    <View style={[styles.box, style]}>
      {img ? (
        <Image source={{ uri: mediaUrl(img.key) }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />
      ) : (
        <>
          <LinearGradient colors={[c1, c2]} start={{ x: a, y: 0 }} end={{ x: 1 - a, y: 1 }} style={StyleSheet.absoluteFill} />
          {/* Three soft shapes, sized in % so they scale with any card. */}
          <View style={[styles.shape, { width: "92%", aspectRatio: 1, borderRadius: 999, backgroundColor: c3, opacity: 0.38, left: `${-20 + a * 50}%`, top: `${-35 + b * 40}%` }]} />
          <View style={[styles.shape, { width: "70%", aspectRatio: 1, borderRadius: 999, backgroundColor: c1, opacity: 0.5, right: `${-25 + b * 40}%`, bottom: `${-30 + c * 35}%` }]} />
          <View style={[styles.shape, { width: "44%", aspectRatio: 1, borderRadius: 40, backgroundColor: c3, opacity: 0.3, transform: [{ rotate: `${Math.round(c * 60)}deg` }], right: `${8 + a * 30}%`, top: `${8 + c * 30}%` }]} />
        </>
      )}
      {scrim ? <LinearGradient colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]} style={styles.scrim} pointerEvents="none" /> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { overflow: "hidden", backgroundColor: "#4A5A63" },
  shape: { position: "absolute" },
  scrim: { position: "absolute", left: 0, right: 0, bottom: 0, height: "62%" },
});
