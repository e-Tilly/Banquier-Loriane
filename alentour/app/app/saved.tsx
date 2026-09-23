import React, { useMemo } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { haversineKm, type Scored } from "@core/catalog/filter.ts";
import { isOpenAt } from "@core/catalog/hours.ts";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, typography, type Palette } from "../lib/theme.ts";
import { ActivityCard } from "../components/ActivityCard.tsx";
import { t } from "../lib/format.ts";

export default function Saved() {
  const p = usePalette();
  const s = styles(p);
  const { catalog, lang, saved, toggleSave, rankContext } = useStore();

  const items: Scored[] = useMemo(() => {
    if (!catalog) return [];
    return catalog.activities
      .filter((a) => saved.has(a.id))
      .map((a) => ({
        activity: a,
        distanceKm: haversineKm(rankContext.lat, rankContext.lon, a.lat, a.lon),
        openState: isOpenAt(a.hours, rankContext.now),
        score: 0,
      }))
      .sort((x, y) => x.distanceKm - y.distanceKm);
  }, [catalog, saved, rankContext]);

  if (items.length === 0) {
    return (
      <SafeAreaView style={s.empty} edges={["bottom"]}>
        <Text style={s.emptyTitle}>{t("savedEmpty", lang)}</Text>
        <Text style={s.emptyBody}>
          {lang === "fr"
            ? "Touche l'étoile sur une activité pour la garder ici. Ça marche hors ligne."
            : "Tap the star on an activity to keep it here. Works offline."}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.activity.id}
        contentContainerStyle={s.list}
        renderItem={({ item }) => (
          <View style={s.cardWrap}>
            <ActivityCard item={item} lang={lang} saved onToggleSave={toggleSave} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  list: { paddingBottom: space.xxl },
  cardWrap: { paddingHorizontal: space.lg, paddingTop: space.md },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.xl, backgroundColor: p.bg },
  emptyTitle: { ...typography.title, color: p.ink },
  emptyBody: { ...typography.body, color: p.ink3, textAlign: "center" },
});
