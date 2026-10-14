/** The big feature card: full-bleed artwork, a heart, the name, and a dark "See more" pill. */
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Link } from "expo-router";
import type { Scored } from "@core/catalog/filter.ts";
import { usePalette, space, radius, typography } from "../lib/theme.ts";
import { formatPrice, formatDuration, formatDistance, type Lang } from "../lib/format.ts";
import { translate } from "../lib/i18n.ts";
import { useStore } from "../lib/store.tsx";
import { Art } from "./Art.tsx";
import { GlassLayer } from "./Glass.tsx";
import { Icon } from "./Icon.tsx";
import { HeartButton } from "./ActivityCard.tsx";

export function HeroCard({ item, lang, saved, onToggleSave, width }: {
  item: Scored; lang: Lang; saved: boolean; onToggleSave: (id: string) => void; width: number;
}) {
  const p = usePalette();
  const { catalog } = useStore();
  const a = item.activity;
  const venue = catalog?.venues.find((v) => v.id === a.venueId);
  const facts = [formatPrice(a, lang), formatDuration(a, lang), formatDistance(item.distanceKm, lang)].filter(Boolean);
  return (
    <Link href={{ pathname: "/activity/[id]", params: { id: a.id } }} asChild>
      <Pressable style={StyleSheet.flatten({ width })} accessibilityRole="button" accessibilityLabel={`${a.title}. ${facts.join(", ")}`}>
        <Art id={a.id} category={a.cat} img={a.img} scrim style={s.card}>
          <View style={s.top}>
            <HeartButton saved={saved} onPress={() => onToggleSave(a.id)} label={translate(saved ? "card.unsave" : "card.save", lang)} size={42} />
          </View>
          <View style={s.bottom}>
            <Text style={s.place} numberOfLines={1}>{venue?.neighbourhood ?? catalog?.tagLabels[a.cat] ?? ""}</Text>
            <Text style={s.title} numberOfLines={2}>{a.title}</Text>
            <View style={s.facts}>
              {facts.map((f) => (<View key={f} style={s.fact}><GlassLayer onArt radius={999} /><Text style={s.factText}>{f}</Text></View>))}
            </View>
            <View style={s.more}>
              <GlassLayer onArt radius={999} />
              <Text style={s.moreText}>{translate("card.seeMore", lang)}</Text>
              <View style={s.moreGo}><Icon name="arrow-right" size={20} color="#1F2326" /></View>
            </View>
          </View>
        </Art>
      </Pressable>
    </Link>
  );
}

const s = StyleSheet.create({
  card: { height: 360, borderRadius: radius.xl },
  top: { position: "absolute", top: space.lg, right: space.lg },
  bottom: { position: "absolute", left: space.lg, right: space.lg, bottom: space.lg, gap: 6 },
  place: { ...typography.body, color: "rgba(255,255,255,0.82)" },
  title: { fontSize: 27, fontWeight: "600", letterSpacing: -0.6, color: "#FFFFFF" },
  facts: { flexDirection: "row", gap: 6, flexWrap: "wrap", marginTop: 2 },
  fact: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, overflow: "hidden" },
  factText: { ...typography.small, color: "#FFFFFF", fontWeight: "500" },
  more: {
    marginTop: space.md, height: 58, borderRadius: 29, overflow: "hidden",
    flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 6,
  },
  moreText: { ...typography.heading, color: "#FFFFFF", flex: 1, textAlign: "center", marginLeft: 44 },
  moreGo: { width: 46, height: 46, borderRadius: 23, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
});
