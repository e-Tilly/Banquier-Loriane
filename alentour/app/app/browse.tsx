/** Filtered list. The "never show zero" promise lives here. */
import React, { useMemo, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { applyFilters, diversify } from "@core/catalog/filter.ts";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { ActivityCard } from "../components/ActivityCard.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { FilterSheet } from "../components/FilterSheet.tsx";

const FILTER_LABELS: Record<string, { fr: string; en: string }> = {
  maxDistanceKm: { fr: "la distance", en: "distance" },
  maxPriceCents: { fr: "le prix", en: "price" },
  categories: { fr: "la catégorie", en: "category" },
  tags: { fr: "l'ambiance", en: "vibe" },
  openNow: { fr: "ouvert maintenant", en: "open now" },
  maxDurationMinutes: { fr: "la durée", en: "duration" },
  maxPhysical: { fr: "l'effort", en: "effort" },
  maxSkill: { fr: "le niveau", en: "skill" },
  indoorOnly: { fr: "intérieur", en: "indoor" },
  minIcebreaker: { fr: "le côté social", en: "sociability" },
};

export default function Browse() {
  const p = usePalette();
  const s = styles(p);
  const { catalog, lang, filters, setFilters, rankContext, saved, toggleSave } = useStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");

  const outcome = useMemo(() => {
    if (!catalog) return null;
    return applyFilters(catalog.activities, { ...filters, query: query || undefined }, rankContext);
  }, [catalog, filters, query, rankContext]);

  if (!catalog || !outcome) return <SafeAreaView style={s.screen} />;

  const primary = diversify(outcome.matches);
  const showing = primary.length > 0 ? primary : (outcome.relaxed?.matches ?? []);

  const droppedText = outcome.relaxed
    ? outcome.relaxed.droppedFilters
        .map((k) => FILTER_LABELS[k]?.[lang] ?? String(k))
        .join(lang === "fr" ? " et " : " and ")
    : null;

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <View style={s.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={lang === "fr" ? "Chercher…" : "Search…"}
          placeholderTextColor={p.ink4}
          style={s.input}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel={lang === "fr" ? "Chercher une activité" : "Search activities"}
        />
      </View>

      <FilterBar filters={filters} onChange={setFilters} onOpenSheet={() => setSheetOpen(true)} lang={lang} />

      <FlatList
        data={showing}
        keyExtractor={(item) => item.activity.id}
        contentContainerStyle={s.list}
        ListHeaderComponent={
          <View style={s.resultHeader}>
            {primary.length > 0 ? (
              <Text style={s.count}>
                {primary.length} {lang === "fr" ? "résultats" : "results"}
              </Text>
            ) : outcome.relaxed ? (
              // Never a dead end: say exactly what was ignored, and offer to put it back.
              <View style={s.relaxed}>
                <Text style={s.relaxedTitle}>
                  {lang === "fr" ? "Aucun résultat exact" : "No exact matches"}
                </Text>
                <Text style={s.relaxedBody}>
                  {lang === "fr"
                    ? `Voici ${outcome.relaxed.matches.length} suggestions en ignorant ${droppedText}.`
                    : `Showing ${outcome.relaxed.matches.length} results ignoring ${droppedText}.`}
                </Text>
              </View>
            ) : (
              <Text style={s.count}>{lang === "fr" ? "Rien à afficher" : "Nothing to show"}</Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.cardWrap}>
            <ActivityCard item={item} lang={lang} saved={saved.has(item.activity.id)} onToggleSave={toggleSave} />
          </View>
        )}
        ListFooterComponent={
          outcome.unknownA11y.length > 0 ? (
            <View style={s.unknownSection}>
              <Text style={s.unknownTitle}>
                {lang === "fr" ? "Accessibilité non vérifiée" : "Accessibility not verified"}
              </Text>
              <Text style={s.unknownBody}>
                {lang === "fr"
                  ? "On ne sait pas encore. Ces lieux ne sont pas cachés pour autant."
                  : "We don't know yet. These aren't hidden for that reason."}
              </Text>
              {outcome.unknownA11y.slice(0, 10).map((item) => (
                <View key={item.activity.id} style={s.cardWrap}>
                  <ActivityCard item={item} lang={lang} saved={saved.has(item.activity.id)} onToggleSave={toggleSave} />
                </View>
              ))}
            </View>
          ) : null
        }
      />

      <FilterSheet
        visible={sheetOpen} onClose={() => setSheetOpen(false)}
        catalog={catalog} filters={filters} onChange={setFilters}
        ctx={rankContext} lang={lang}
      />
    </SafeAreaView>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  searchRow: { paddingHorizontal: space.lg, paddingTop: space.sm },
  input: {
    backgroundColor: p.surface, borderRadius: radius.md, paddingHorizontal: space.md,
    paddingVertical: 11, ...typography.body, color: p.ink,
    borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule, minHeight: 44,
  },
  list: { paddingBottom: space.xxl },
  resultHeader: { paddingHorizontal: space.lg, paddingTop: space.xs },
  count: { ...typography.micro, color: p.ink3, textTransform: "uppercase" },
  relaxed: { backgroundColor: p.warmSoft, padding: space.md, borderRadius: radius.md, gap: 3 },
  relaxedTitle: { ...typography.heading, color: p.warm },
  relaxedBody: { ...typography.small, color: p.ink2 },
  cardWrap: { paddingHorizontal: space.lg, paddingTop: space.md },
  unknownSection: { marginTop: space.xl, paddingTop: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.rule },
  unknownTitle: { ...typography.heading, color: p.ink, paddingHorizontal: space.lg },
  unknownBody: { ...typography.small, color: p.ink3, paddingHorizontal: space.lg, marginTop: 2 },
});
