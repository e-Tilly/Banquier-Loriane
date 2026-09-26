/** Filtered list. The "never show zero" promise lives here. */
import React, { useMemo, useState } from "react";
import { View, Text, FlatList, TextInput, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { applyFilters, diversify } from "@core/catalog/filter.ts";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { ActivityCard } from "../components/ActivityCard.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { FilterSheet } from "../components/FilterSheet.tsx";
import type { Key } from "../lib/i18n.ts";

export default function Browse() {
  const p = usePalette();
  const s = styles(p);
  const { catalog, lang, t, filters, setFilters, rankContext, isSaved, toggleSave } = useStore();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [query, setQuery] = useState("");

  const outcome = useMemo(() => {
    if (!catalog) return null;
    return applyFilters(catalog.activities, { ...filters, query: query || undefined }, rankContext);
  }, [catalog, filters, query, rankContext]);

  if (!catalog || !outcome) return <SafeAreaView style={s.screen} />;

  const primary = diversify(outcome.matches);
  const showing = primary.length > 0 ? primary : (outcome.relaxed?.matches ?? []);
  const droppedText = outcome.relaxed?.droppedFilters
    .map((k) => t(`filter.${String(k)}` as Key))
    .join(t("browse.and"));

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <View style={s.searchRow}>
        <TextInput
          value={query} onChangeText={setQuery}
          placeholder={t("browse.search")} placeholderTextColor={p.ink4}
          style={s.input} returnKeyType="search" clearButtonMode="while-editing"
          accessibilityLabel={t("browse.search")}
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
              <Text style={s.count}>{t("browse.results", { n: primary.length })}</Text>
            ) : outcome.relaxed ? (
              // Never a dead end: say exactly what was ignored.
              <View style={s.relaxed}>
                <Text style={s.relaxedTitle}>{t("browse.noExact")}</Text>
                <Text style={s.relaxedBody}>
                  {t("browse.relaxed", { n: outcome.relaxed.matches.length, what: droppedText ?? "" })}
                </Text>
              </View>
            ) : (
              <Text style={s.count}>{t("browse.nothing")}</Text>
            )}
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.cardWrap}>
            <ActivityCard item={item} lang={lang} saved={isSaved(item.activity.id)} onToggleSave={toggleSave} />
          </View>
        )}
        ListFooterComponent={
          outcome.unknownA11y.length > 0 ? (
            <View style={s.unknownSection}>
              <Text style={s.unknownTitle}>{t("browse.unknownTitle")}</Text>
              <Text style={s.unknownBody}>{t("browse.unknownBody")}</Text>
              {outcome.unknownA11y.slice(0, 10).map((item) => (
                <View key={item.activity.id} style={s.cardWrap}>
                  <ActivityCard item={item} lang={lang} saved={isSaved(item.activity.id)} onToggleSave={toggleSave} />
                </View>
              ))}
            </View>
          ) : null
        }
      />

      <FilterSheet visible={sheetOpen} onClose={() => setSheetOpen(false)}
        catalog={catalog} filters={filters} onChange={setFilters} ctx={rankContext} lang={lang} />
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
