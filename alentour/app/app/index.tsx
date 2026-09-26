/**
 * Home is BROWSE, not search. Context shelves first — "Free tonight", "Rainy day" — then a
 * ranked feed. A one-line note says WHY the order changed when the weather drove it; a feed
 * that silently rearranges itself feels random, one that explains itself feels smart.
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
import type { Key } from "../lib/i18n.ts";

export default function Home() {
  const p = usePalette();
  const s = styles(p);
  const router = useRouter();
  const {
    catalog, loading, error, lang, t, rankContext, isSaved, toggleSave, conditions,
    hasPreciseLocation, requestLocation, apiEnabled,
  } = useStore();
  const [refreshing, setRefreshing] = useState(false);

  const shelves = useMemo(() => (catalog ? buildShelves(catalog, rankContext) : []), [catalog, rankContext]);
  const feed = useMemo(
    () => (catalog ? buildFeed(catalog, rankContext, { maxDistanceKm: 15 }, 40, shelfItemIds(shelves)) : []),
    [catalog, rankContext, shelves],
  );

  const weatherNote: Key | null = !conditions.fresh ? null
    : conditions.precipitationProb > 0.5 ? "home.rainNote"
    : conditions.tempC < -15 ? "home.coldNote"
    : conditions.isDark ? "home.darkNote"
    : null;

  if (loading) {
    return <SafeAreaView style={s.center}><ActivityIndicator color={p.accent} /></SafeAreaView>;
  }
  if (error || !catalog) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.errorTitle}>{t("home.unavailable")}</Text>
        <Text style={s.errorBody}>{t("home.unavailableBody")}</Text>
      </SafeAreaView>
    );
  }

  const h = rankContext.now.getHours();
  const kicker = t(h < 12 ? "home.morning" : h < 17 ? "home.afternoon" : "home.evening");

  return (
    <SafeAreaView style={s.screen} edges={["top"]}>
      <FlatList
        data={feed}
        keyExtractor={(item) => item.activity.id}
        contentContainerStyle={s.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} tintColor={p.ink3}
            onRefresh={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 600); }} />
        }
        ListHeaderComponent={
          <View style={s.header}>
            <View style={s.titleRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.kicker}>{kicker}</Text>
                <Text style={s.title}>{t("home.title")}</Text>
              </View>
              <View style={s.iconRow}>
                <IconLink p={p} href="/map" glyph="◎" label={t("nav.map")} />
                <IconLink p={p} href="/saved" glyph="★" label={t("nav.saved")} />
                {apiEnabled ? <IconLink p={p} href="/outings" glyph="⚑" label={t("nav.outings")} /> : null}
                {apiEnabled ? <IconLink p={p} href="/add" glyph="＋" label={t("nav.add")} /> : null}
                <IconLink p={p} href="/settings" glyph="⚙" label={t("nav.settings")} />
              </View>
            </View>

            {weatherNote ? (
              <View style={s.weather} accessibilityRole="text">
                <Text style={s.weatherText}>{t(weatherNote)}</Text>
              </View>
            ) : null}

            {!hasPreciseLocation ? (
              <Pressable style={s.locBanner} onPress={requestLocation} accessibilityRole="button">
                <Text style={s.locText}>{t("home.locate")}</Text>
                <Text style={s.locHint}>{t("home.approx")}</Text>
              </Pressable>
            ) : null}

            <Pressable style={s.searchBtn} onPress={() => router.push("/browse")} accessibilityRole="search">
              <Text style={s.searchText}>{t("home.search")}</Text>
            </Pressable>

            {shelves.map((shelf) => (
              <View key={shelf.key} style={s.shelf}>
                <Text style={s.shelfTitle}>{shelf.label}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.shelfRow}>
                  {shelf.items.map((item) => (
                    <View key={item.activity.id} style={s.shelfCard}>
                      <ActivityCard item={item} lang={lang} compact
                        saved={isSaved(item.activity.id)} onToggleSave={toggleSave} />
                    </View>
                  ))}
                </ScrollView>
              </View>
            ))}

            <Text style={s.feedTitle}>{t("home.everything")}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.cardWrap}>
            <ActivityCard item={item} lang={lang} saved={isSaved(item.activity.id)} onToggleSave={toggleSave} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function IconLink({ p, href, glyph, label }: { p: Palette; href: "/map" | "/saved" | "/settings" | "/outings" | "/add"; glyph: string; label: string }) {
  return (
    <Link href={href} asChild>
      <Pressable hitSlop={8} accessibilityRole="button" accessibilityLabel={label}
        style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 22, color: p.accent }}>{glyph}</Text>
      </Pressable>
    </Link>
  );
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
  iconRow: { flexDirection: "row", gap: 2 },
  weather: { marginHorizontal: space.lg, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: p.warmSoft },
  weatherText: { ...typography.small, color: p.warm, fontWeight: "600" },
  locBanner: { marginHorizontal: space.lg, padding: space.md, borderRadius: radius.md, backgroundColor: p.accentSoft, gap: 2 },
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
