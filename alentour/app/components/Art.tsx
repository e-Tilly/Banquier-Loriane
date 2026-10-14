/**
 * Artwork for an activity. A real photo when the business has one; otherwise generated art — a
 * category gradient with large soft shapes, placed from the activity's id so every listing gets a
 * stable, different composition. It stands in for photography the catalog doesn't have yet.
 */
import React from "react";
import { View, Image, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { mediaUrl } from "../lib/config.ts";

const PALETTES: Record<string, [string, string, string]> = {
  "category.outdoors": ["#2F6B4F", "#8DBE8A", "#E9D58B"],
  "category.water": ["#1C5D8C", "#4FA3C7", "#BDE3EA"],
  "category.winter": ["#3B4F8F", "#8DA7D9", "#E3ECF8"],
  "category.sports": ["#C4512F", "#EE8F4C", "#F6D08A"],
  "category.thrill": ["#B02A3E", "#E2634F", "#5A2A6B"],
  "category.arts": ["#6B3F8F", "#C77DB0", "#F3C9B8"],
  "category.learning": ["#B7791F", "#E6B655", "#F6E3B0"],
  "category.games": ["#1F7A78", "#5FB6A6", "#7A5FB6"],
  "category.food": ["#B8501F", "#E88F3E", "#F5D27A"],
  "category.nightlife": ["#35317F", "#8B4FA8", "#E266A0"],
  "category.wellness": ["#2C7A74", "#7CC2B3", "#DDEFE3"],
  "category.family": ["#C27A2C", "#EFB868", "#F7E2B5"],
  "category.animals": ["#7A5230", "#C49A62", "#E8D5AE"],
  "category.community": ["#3F6E8F", "#82B0C9", "#E1ECA9"],
  "category.markets": ["#A23B52", "#E4807A", "#F4D3A0"],
  "category.seasonal": ["#6A8F2F", "#C4C94F", "#F3E4A0"],
};
const FALLBACK: [string, string, string] = ["#4A5A63", "#8FA3AD", "#DDE5E8"];

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
  const [c1, c2, c3] = PALETTES[category] ?? FALLBACK;
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
