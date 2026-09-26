import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Link } from "expo-router";
import type { Scored } from "@core/catalog/filter.ts";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { formatPrice, formatDuration, formatDistance, effortLabel, type Lang } from "../lib/format.ts";
import { translate } from "../lib/i18n.ts";

interface Props {
  item: Scored;
  lang: Lang;
  saved: boolean;
  onToggleSave: (id: string) => void;
  compact?: boolean;
}

export function ActivityCard({ item, lang, saved, onToggleSave, compact }: Props) {
  const p = usePalette();
  const s = styles(p);
  const a = item.activity;
  const price = formatPrice(a, lang);
  const duration = formatDuration(a, lang);
  const effort = effortLabel(a, lang);

  return (
    <Link href={{ pathname: "/activity/[id]", params: { id: a.id } }} asChild>
      <Pressable
        // Flattened deliberately. On web, `Link asChild` clones this element into an <a> and
        // forwards `style` to the DOM node; react-dom then iterates an ARRAY with for..in and
        // throws on the numeric keys. A plain object is safe on every platform.
        style={StyleSheet.flatten([s.card, compact && s.compact])}
        accessibilityRole="button"
        accessibilityLabel={`${a.title}. ${price}. ${formatDistance(item.distanceKm, lang)}`}
      >
        <View style={s.thumb}>
          <Text style={s.thumbGlyph}>{categoryGlyph(a.cat)}</Text>
        </View>

        <View style={s.body}>
          <Text style={s.title} numberOfLines={2}>{a.title}</Text>
          {!compact && a.summary ? <Text style={s.summary} numberOfLines={2}>{a.summary}</Text> : null}

          <View style={s.meta}>
            <Text style={[s.metaText, a.free && s.free]}>{price}</Text>
            {duration ? <><Dot p={p} /><Text style={s.metaText}>{duration}</Text></> : null}
            <Dot p={p} />
            <Text style={s.metaText}>{formatDistance(item.distanceKm, lang)}</Text>
            {effort ? <><Dot p={p} /><Text style={s.metaText}>{effort}</Text></> : null}
          </View>

          <View style={s.badges}>
            {item.openState === "open" ? (
              <Badge p={p} tone="accent" label={translate("card.open", lang)} />
            ) : item.openState === "closed" ? (
              <Badge p={p} tone="muted" label={translate("card.closed", lang)} />
            ) : null}
            {item.a11yUnknown ? <Badge p={p} tone="warm" label={translate("card.a11yUnknown", lang)} /> : null}
          </View>
        </View>

        <Pressable
          onPress={(e) => { e.preventDefault?.(); e.stopPropagation?.(); onToggleSave(a.id); }}
          hitSlop={12}
          style={s.saveBtn}
          accessibilityRole="button"
          accessibilityLabel={translate(saved ? "card.unsave" : "card.save", lang)}
          accessibilityState={{ selected: saved }}
        >
          <Text style={[s.saveGlyph, saved && s.savedGlyph]}>{saved ? "★" : "☆"}</Text>
        </Pressable>
      </Pressable>
    </Link>
  );
}

function Dot({ p }: { p: Palette }) {
  return <Text style={{ color: p.ink4, fontSize: 13 }}>·</Text>;
}

function Badge({ p, label, tone }: { p: Palette; label: string; tone: "accent" | "muted" | "warm" }) {
  const bg = tone === "accent" ? p.accentSoft : tone === "warm" ? p.warmSoft : p.surfaceAlt;
  const fg = tone === "accent" ? p.accent : tone === "warm" ? p.warm : p.ink3;
  return (
    <View style={{ backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill }}>
      <Text style={{ color: fg, ...typography.micro }}>{label}</Text>
    </View>
  );
}

/** Stand-in until real photography exists. */
export function categoryGlyph(cat: string): string {
  const map: Record<string, string> = {
    "category.sports": "⛰", "category.outdoors": "🌲", "category.water": "🛶",
    "category.winter": "❄", "category.arts": "◈", "category.learning": "✎",
    "category.games": "◉", "category.food": "◍", "category.nightlife": "♪",
    "category.wellness": "♨", "category.markets": "❖", "category.seasonal": "✳",
  };
  return map[cat] ?? "◇";
}

const styles = (p: Palette) => StyleSheet.create({
  card: {
    flexDirection: "row", gap: space.md, padding: space.md,
    backgroundColor: p.surface, borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  compact: { padding: space.sm },
  thumb: {
    width: 64, height: 64, borderRadius: radius.md,
    backgroundColor: p.surfaceAlt, alignItems: "center", justifyContent: "center",
  },
  thumbGlyph: { fontSize: 26, color: p.ink3 },
  body: { flex: 1, gap: 3 },
  title: { ...typography.heading, color: p.ink },
  summary: { ...typography.small, color: p.ink3 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 2 },
  metaText: { ...typography.small, color: p.ink2 },
  free: { color: p.accent, fontWeight: "600" },
  badges: { flexDirection: "row", gap: 6, marginTop: 6, flexWrap: "wrap" },
  saveBtn: { paddingLeft: space.xs, paddingTop: 2 },
  saveGlyph: { fontSize: 22, color: p.ink4 },
  savedGlyph: { color: p.accent },
});
