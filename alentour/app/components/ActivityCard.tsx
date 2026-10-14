import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Link } from "expo-router";
import type { Scored } from "@core/catalog/filter.ts";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { formatPrice, formatDuration, formatDistance, type Lang } from "../lib/format.ts";
import { translate } from "../lib/i18n.ts";
import { useStore } from "../lib/store.tsx";
import { Art } from "./Art.tsx";
import { Icon } from "./Icon.tsx";

interface Props {
  item: Scored;
  lang: Lang;
  saved: boolean;
  onToggleSave: (id: string) => void;
  /** Vertical card with a large image on top (shelves). Default is the compact row (lists). */
  compact?: boolean;
}

/** Round heart button that sits on artwork. Stops the tap from opening the card. */
export function HeartButton({ saved, onPress, label, size = 38, tint = "light" }: {
  saved: boolean; onPress: () => void; label: string; size?: number; tint?: "light" | "plain";
}) {
  const p = usePalette();
  const onArt = tint === "light";
  return (
    <Pressable
      onPress={(e) => { e.preventDefault?.(); e.stopPropagation?.(); onPress(); }}
      hitSlop={10} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: saved }}
      style={{
        width: size, height: size, borderRadius: size / 2, alignItems: "center", justifyContent: "center",
        backgroundColor: onArt ? "rgba(255,255,255,0.92)" : p.accentSoft,
      }}
    >
      <Icon name={saved ? "heart-fill" : "heart"} size={size * 0.5} color={saved ? "#D6455D" : onArt ? "#1F2326" : p.ink2} />
    </Pressable>
  );
}

export function ActivityCard({ item, lang, saved, onToggleSave, compact }: Props) {
  const p = usePalette();
  const s = styles(p);
  const { catalog } = useStore();
  const a = item.activity;
  const price = formatPrice(a, lang);
  const duration = formatDuration(a, lang);
  const venue = catalog?.venues.find((v) => v.id === a.venueId);
  const open = item.openState === "open";
  const label = `${a.title}. ${price}. ${formatDistance(item.distanceKm, lang)}`;

  if (compact) {
    return (
      <Link href={{ pathname: "/activity/[id]", params: { id: a.id } }} asChild>
        <Pressable style={StyleSheet.flatten(s.tall)} accessibilityRole="button" accessibilityLabel={label}>
          <Art id={a.id} category={a.cat} img={a.img} style={s.tallArt}>
            <View style={s.heartPos}>
              <HeartButton saved={saved} onPress={() => onToggleSave(a.id)} label={translate(saved ? "card.unsave" : "card.save", lang)} />
            </View>
          </Art>
          <View style={s.tallBody}>
            <Text style={s.title} numberOfLines={1}>{a.title}</Text>
            <Text style={s.meta} numberOfLines={1}>
              <Text style={a.free ? s.free : undefined}>{price}</Text>
              {duration ? `  ·  ${duration}` : ""}{`  ·  ${formatDistance(item.distanceKm, lang)}`}
            </Text>
            <View style={s.tallFoot}>
              {open ? <Pill p={p} label={translate("card.open", lang)} tone="brand" />
                : item.openState === "closed" ? <Pill p={p} label={translate("card.closed", lang)} tone="muted" /> : <View />}
              <View style={s.go}><Icon name="arrow-right" size={18} color={p.onAccent} /></View>
            </View>
          </View>
        </Pressable>
      </Link>
    );
  }

  return (
    <Link href={{ pathname: "/activity/[id]", params: { id: a.id } }} asChild>
      <Pressable
        // Flattened deliberately: `Link asChild` forwards `style` to a DOM node on web, and react-dom
        // throws on a style ARRAY. A plain object is safe on every platform.
        style={StyleSheet.flatten(s.row)} accessibilityRole="button" accessibilityLabel={label}
      >
        <Art id={a.id} category={a.cat} img={a.img} style={s.rowArt} />
        <View style={s.rowBody}>
          <Text style={s.title} numberOfLines={2}>{a.title}</Text>
          {venue ? (
            <View style={s.place}>
              <Icon name="pin" size={13} color={p.ink3} />
              <Text style={s.placeText} numberOfLines={1}>{venue.neighbourhood ?? venue.name}</Text>
            </View>
          ) : null}
          <Text style={s.meta} numberOfLines={1}>
            <Text style={a.free ? s.free : undefined}>{price}</Text>
            {duration ? `  ·  ${duration}` : ""}{`  ·  ${formatDistance(item.distanceKm, lang)}`}
          </Text>
          <View style={s.badges}>
            {open ? <Pill p={p} label={translate("card.open", lang)} tone="brand" />
              : item.openState === "closed" ? <Pill p={p} label={translate("card.closed", lang)} tone="muted" /> : null}
            {item.a11yUnknown ? <Pill p={p} label={translate("card.a11yUnknown", lang)} tone="warm" /> : null}
          </View>
        </View>
        <HeartButton tint="plain" saved={saved} onPress={() => onToggleSave(a.id)} label={translate(saved ? "card.unsave" : "card.save", lang)} />
      </Pressable>
    </Link>
  );
}

export function Pill({ p, label, tone }: { p: Palette; label: string; tone: "brand" | "muted" | "warm" }) {
  const bg = tone === "brand" ? p.brandSoft : tone === "warm" ? p.warmSoft : p.surfaceAlt;
  const fg = tone === "brand" ? p.brand : tone === "warm" ? p.warm : p.ink3;
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill }}>
      <Text style={{ color: fg, ...typography.micro }}>{label}</Text>
    </View>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  // vertical card
  tall: { backgroundColor: p.surface, borderRadius: radius.lg, padding: 10, gap: 10 },
  tallArt: { height: 150, borderRadius: radius.lg - 4 },
  heartPos: { position: "absolute", top: 10, right: 10 },
  tallBody: { paddingHorizontal: 6, paddingBottom: 4, gap: 3 },
  tallFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 },
  go: { width: 38, height: 38, borderRadius: 19, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" },
  // row
  row: { flexDirection: "row", alignItems: "center", gap: space.md, padding: 10, backgroundColor: p.surface, borderRadius: radius.lg },
  rowArt: { width: 92, height: 104, borderRadius: radius.lg - 6 },
  rowBody: { flex: 1, gap: 3, paddingVertical: 2 },
  place: { flexDirection: "row", alignItems: "center", gap: 4 },
  placeText: { ...typography.small, color: p.ink3, flexShrink: 1 },
  badges: { flexDirection: "row", gap: 6, marginTop: 4, flexWrap: "wrap" },
  // shared
  title: { ...typography.heading, color: p.ink },
  meta: { ...typography.small, color: p.ink3 },
  free: { color: p.brand, fontWeight: "600" },
});
