/** Map of whatever the current filters return, with a card for the tapped marker. */
import React, { useMemo, useState } from "react";
import { View, Text, FlatList, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { applyFilters } from "@core/catalog/filter.ts";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { ActivityCard } from "../components/ActivityCard.tsx";
import { FilterBar } from "../components/FilterBar.tsx";
import { FilterSheet } from "../components/FilterSheet.tsx";
import { ActivityMap, mapAvailable } from "../components/ActivityMap";
import { NavBar, NAV_SPACE } from "../components/NavBar.tsx";

export default function MapScreen() {
  const p = usePalette();
  const s = styles(p);
  const dark = false;
  const { catalog, lang, t, filters, setFilters, rankContext, position, isSaved, toggleSave } = useStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const items = useMemo(() => {
    if (!catalog) return [];
    const out = applyFilters(catalog.activities, filters, rankContext);
    return out.matches.length ? out.matches : (out.relaxed?.matches ?? []);
  }, [catalog, filters, rankContext]);

  const selected = items.find((i) => i.activity.id === selectedId) ?? null;
  if (!catalog) return <SafeAreaView style={s.screen} />;

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <Text style={s.heading}>{t("nav.map")}</Text>
      <FilterBar filters={filters} onChange={setFilters} onOpenSheet={() => setSheetOpen(true)} lang={lang} />

      {mapAvailable ? (
        <View style={s.mapWrap}>
          <ActivityMap items={items} center={position} selectedId={selectedId} onSelect={setSelectedId} dark={dark} />
          {selected ? (
            <View style={s.selected} pointerEvents="box-none">
              <ActivityCard item={selected} lang={lang} saved={isSaved(selected.activity.id)} onToggleSave={toggleSave} />
            </View>
          ) : null}
        </View>
      ) : (
        // Expo Go: no native map module. A nearest-first list is the honest substitute.
        <FlatList
          data={[...items].sort((a, b) => a.distanceKm - b.distanceKm)}
          keyExtractor={(i) => i.activity.id}
          contentContainerStyle={s.list}
          ListHeaderComponent={
            <View style={s.fallback}>
              <Text style={s.fallbackTitle}>{t("map.fallbackTitle")}</Text>
              <Text style={s.fallbackBody}>{t("map.fallbackBody")}</Text>
            </View>
          }
          renderItem={({ item }) => (
            <View style={s.cardWrap}>
              <ActivityCard item={item} lang={lang} saved={isSaved(item.activity.id)} onToggleSave={toggleSave} />
            </View>
          )}
        />
      )}

      <NavBar active="map" />
      <FilterSheet visible={sheetOpen} onClose={() => setSheetOpen(false)}
        catalog={catalog} filters={filters} onChange={setFilters} ctx={rankContext} lang={lang} />
    </SafeAreaView>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.canvas },
  mapWrap: { flex: 1, position: "relative", overflow: "hidden", marginHorizontal: space.lg, marginBottom: NAV_SPACE - 8, borderRadius: radius.xl },
  heading: { ...typography.display, color: p.ink, paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: space.sm },
  selected: { position: "absolute", left: space.sm, right: space.sm, bottom: space.sm },
  list: { paddingBottom: NAV_SPACE + space.xl },
  cardWrap: { paddingHorizontal: space.lg, paddingTop: space.md },
  fallback: { margin: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: p.warmSoft, gap: 4 },
  fallbackTitle: { ...typography.heading, color: p.warm },
  fallbackBody: { ...typography.small, color: p.ink2 },
});
