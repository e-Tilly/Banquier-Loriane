/**
 * Home is BROWSE, not search. Context shelves first — "Free tonight", "Rainy day" — then a
 * ranked feed. Most people never open the filter sheet, which is exactly why it can be deep.
 * See docs/alentour/03-taxonomy.md and 05-discovery-and-ranking.md.
 */
import React, { useMemo, useState } from "react";
import {
  View, Text, ScrollView, FlatList, Pressable, ActivityIndicator, StyleSheet, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { buildShelves, buildFeed, shelfItemIds } from "@core/catalog/shelves.ts";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { ActivityCard } from "../components/ActivityCard.tsx";
import { t } from "../lib/format.ts";

export default function Home() {
  const p = usePalette();
  const s = styles(p);
  const router = useRouter();
  const {
    catalog, loading, error, lang, rankContext, saved, toggleSave,
    hasPreciseLocation, requestLocation,
  } = useStore();
  const [refreshing, setRefreshing] = useState(false);

  const shelves = useMemo(
    () => (catalog ? buildShelves(catalog, rankContext) : []),
    [catalog, rankContext],
  );

  const feed = useMemo(
    () => (catalog ? buildFeed(catalog, rankContext, { maxDistanceKm: 15 }, 40, shelfItemIds(shelves)) : []),
    [catalog, rankContext, shelves],
  );

  if (loading) {
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color={p.accent} />
      </SafeAreaView>
    );
  }

  if (error || !catalog) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.errorTitle}>
          {lang === "fr" ? "Catalogue indisponible" : "Catalog unavailable"}
        </Text>
        <Text style={s.errorBody}>
          {lang === "fr"
            ? "Vérifie ta connexion. Le catalogue se garde en mémoire une fois téléchargé."
            : "Check your connection. The catalog is cached once downloaded."}
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <FlatList
        data={feed}
        keyExtractor={(item) => item.activity.id}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing} tintColor={p.ink3}
            onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 600); }}
          />
        }
        ListHeaderComponent={
          <View style={s.header}>
            <View style={s.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.kicker}>{greeting(rankContext.now, lang)}</Text>
                <Text style={s.title}>
                  {lang === "fr" ? "Quoi faire proche" : "What to do nearby"}
                </Text>
              </View>
              <Link href="/saved" asChild>
                <Pressable hitSlop={10} accessibilityRole="button" accessibilityLabel="Enregistrés">
                  <Text style={s.savedGlyph}>★</Text>
                </Pressable>
              </Link>
            </View>

            {!hasPreciseLocation ? (
              <Pressable style={s.locBanner} onPress={requestLocation} accessibilityRole="button">
                <Text style={s.locText}>
                  {lang === "fr"
                    ? "Montrer ce qui est vraiment proche de moi"
                    : "Show what's actually near me"}
                </Text>
                <Text style={s.locHint}>
                  {lang === "fr" ? "Position approximative : Plateau" : "Approximate: Plateau"}
                </Text>
              </Pressable>
            ) : null}

            <Pressable style={s.searchBtn} onPress={() => router.push("/browse")}>
              <Text style={s.searchText}>
                {lang === "fr" ? "Chercher et filtrer" : "Search and filter"}
              </Text>
            </Pressable>

            {shelves.map((shelf) => (
              <View key={shelf.key} style={s.shelf}>
                <Text style={s.shelfTitle}>{shelf.label}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}
                            contentContainerStyle={s.shelfRow}>
                  {shelf.items.map((item) => (
                    <View key={item.activity.id} style={s.shelfCard}>
                      <ActivityCard
                        item={item} lang={lang} compact
                        saved={saved.has(item.activity.id)} onToggleSave={toggleSave}
                      />
                    </View>
                  ))}
                </ScrollView>
              </View>
            ))}

            <Text style={s.feedTitle}>
              {lang === "fr" ? "Tout ce qu'il y a autour" : "Everything around you"}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.cardWrap}>
            <ActivityCard
              item={item} lang={lang}
              saved={saved.has(item.activity.id)} onToggleSave={toggleSave}
            />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function greeting(now: Date, lang: "fr" | "en"): string {
  const h = now.getHours();
  if (lang === "fr") return h < 12 ? "Ce matin" : h < 17 ? "Cet après-midi" : "Ce soir";
  return h < 12 ? "This morning" : h < 17 ? "This afternoon" : "Tonight";
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.xl, backgroundColor: p.bg },
  errorTitle: { ...typography.title, color: p.ink },
  errorBody: { ...typography.body, color: p.ink3, textAlign: "center" },
  list: { paddingBottom: space.xxl },
  header: { gap: space.lg },
  titleRow: { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: space.lg, paddingTop: space.sm },
  kicker: { ...typography.micro, color: p.accent, textTransform: "uppercase" },
  title: { ...typography.display, color: p.ink, marginTop: 2 },
  savedGlyph: { fontSize: 24, color: p.accent },
  locBanner: {
    marginHorizontal: space.lg, padding: space.md, borderRadius: radius.md,
    backgroundColor: p.accentSoft, gap: 2,
  },
  locText: { ...typography.small, color: p.accent, fontWeight: "600" },
  locHint: { ...typography.micro, color: p.ink3 },
  searchBtn: {
    marginHorizontal: space.lg, paddingVertical: 12, paddingHorizontal: space.md,
    borderRadius: radius.md, backgroundColor: p.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  searchText: { ...typography.body, color: p.ink3 },
  shelf: { gap: space.sm },
  shelfTitle: { ...typography.title, color: p.ink, paddingHorizontal: space.lg },
  shelfRow: { paddingHorizontal: space.lg, gap: space.md },
  shelfCard: { width: 280 },
  feedTitle: { ...typography.title, color: p.ink, paddingHorizontal: space.lg, marginTop: space.sm },
  cardWrap: { paddingHorizontal: space.lg, paddingTop: space.md },
});
