/**
 * Home is BROWSE, not search. Context shelves first — "Free tonight", "Rainy day" — then a
 * ranked feed. A one-line note says WHY the order changed when the weather drove it; a feed
 * that silently rearranges itself feels random, one that explains itself feels smart.
 */
import React, { useMemo, useState } from "react";
import {
  View, Text, ScrollView, FlatList, Pressable, ActivityIndicator, StyleSheet, RefreshControl, useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { buildShelves, buildFeed, shelfItemIds } from "@core/catalog/shelves.ts";
import { config } from "../lib/config.ts";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { ActivityCard } from "../components/ActivityCard.tsx";
import { HeroCard } from "../components/HeroCard.tsx";
import { NavBar, NAV_SPACE } from "../components/NavBar.tsx";
import { Icon } from "../components/Icon.tsx";
import type { Key } from "../lib/i18n.ts";

export default function Home() {
  const p = usePalette();
  const s = styles(p);
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();
  const {
    catalog, loading, error, lang, t, rankContext, isSaved, toggleSave, conditions,
    hasPreciseLocation, requestLocation, apiEnabled, account,
  } = useStore();
  const [refreshing, setRefreshing] = useState(false);
  const [cat, setCat] = useState<string | null>(null);

  const heroW = Math.min(Math.round(screenW * 0.78), 340);
  const categories = useMemo(
    () => Object.entries(catalog?.tagLabels ?? {}).filter(([k]) => k.startsWith("category.") && catalog?.activities.some((a) => a.cat === k)),
    [catalog]);
  const heroes = useMemo(
    () => (catalog ? buildFeed(catalog, rankContext, { maxDistanceKm: 15, ...(cat ? { categories: [cat] } : {}) }, 6, new Set()) : []),
    [catalog, rankContext, cat],
  );
  const shelves = useMemo(() => (catalog ? buildShelves(catalog, rankContext) : []), [catalog, rankContext]);
  const feed = useMemo(() => {
    if (!catalog) return [];
    const taken = new Set([...shelfItemIds(shelves), ...heroes.map((h) => h.activity.id)]);
    return buildFeed(catalog, rankContext, { maxDistanceKm: 15 }, 40, taken);
  }, [catalog, rankContext, shelves, heroes]);

  const weatherNote: Key | null = !conditions.fresh ? null
    : conditions.precipitationProb > 0.5 ? "home.rainNote"
    : conditions.tempC < -15 ? "home.coldNote"
    : conditions.isDark ? "home.darkNote"
    : null;

  if (loading) {
    return <SafeAreaView style={s.center}><ActivityIndicator color={p.ink} /></SafeAreaView>;
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
  const initial = (account?.user.displayName ?? account?.user.email ?? "")[0]?.toUpperCase();

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
                <Text style={s.title}>{t("home.title")}</Text>
                <Text style={s.kicker}>{kicker}</Text>
              </View>
              {apiEnabled ? (
                <Link href="/add" asChild>
                  <Pressable style={s.circle} accessibilityRole="button" accessibilityLabel={t("nav.add")}>
                    <Icon name="plus" size={22} color={p.ink} />
                  </Pressable>
                </Link>
              ) : null}
              <Link href="/settings" asChild>
                <Pressable style={StyleSheet.flatten([s.circle, s.avatar])} accessibilityRole="button" accessibilityLabel={t("nav.settings")}>
                  {initial ? <Text style={s.avatarText}>{initial}</Text> : <Icon name="user" size={22} color={p.onAccent} />}
                </Pressable>
              </Link>
            </View>

            {config.demo ? (
              <View style={s.note} accessibilityRole="text"><Text style={s.noteText}>{t("demo.banner")}</Text></View>
            ) : null}
            {weatherNote ? (
              <View style={s.note} accessibilityRole="text"><Text style={s.noteText}>{t(weatherNote)}</Text></View>
            ) : null}

            <Pressable style={s.search} onPress={() => router.push("/browse")} accessibilityRole="search">
              <Icon name="search" size={20} color={p.ink3} />
              <Text style={s.searchText}>{t("home.search")}</Text>
              <View style={s.searchGo}><Icon name="sliders" size={20} color={p.onAccent} /></View>
            </Pressable>

            {!hasPreciseLocation ? (
              <Pressable style={s.loc} onPress={requestLocation} accessibilityRole="button">
                <Icon name="pin" size={18} color={p.ink2} />
                <Text style={s.locText} numberOfLines={1}>{t("home.locate")}</Text>
              </Pressable>
            ) : null}

            <Text style={s.section}>{t("home.pick")}</Text>
            <View style={s.chipsWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips}>
                <Chip p={p} label={t("home.all")} on={cat === null} onPress={() => setCat(null)} />
                {categories.map(([slug, label]) => (
                  <Chip key={slug} p={p} label={label} on={cat === slug} onPress={() => setCat(cat === slug ? null : slug)} />
                ))}
              </ScrollView>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={heroW + space.md} decelerationRate="fast"
              contentContainerStyle={s.heroRow}>
              {heroes.map((item) => (
                <HeroCard key={item.activity.id} item={item} lang={lang} width={heroW}
                  saved={isSaved(item.activity.id)} onToggleSave={toggleSave} />
              ))}
            </ScrollView>

            {shelves.map((shelf) => (
              <View key={shelf.key} style={s.shelf}>
                <Text style={s.section}>{shelf.label}</Text>
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

            <Text style={s.section}>{t("home.everything")}</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View style={s.cardWrap}>
            <ActivityCard item={item} lang={lang} saved={isSaved(item.activity.id)} onToggleSave={toggleSave} />
          </View>
        )}
      />
      <NavBar active="home" />
    </SafeAreaView>
  );
}

function Chip({ p, label, on, onPress }: { p: Palette; label: string; on: boolean; onPress: () => void }) {
  const s = styles(p);
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: on }}>
      <Text style={[s.chipText, on && s.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.xl, backgroundColor: p.bg },
  errorTitle: { ...typography.title, color: p.ink },
  errorBody: { ...typography.body, color: p.ink3, textAlign: "center" },
  list: { paddingBottom: NAV_SPACE + space.xl },
  header: { gap: space.md + 2 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm },
  title: { ...typography.display, color: p.ink },
  kicker: { ...typography.body, color: p.ink3, marginTop: 2 },
  circle: { width: 46, height: 46, borderRadius: 23, backgroundColor: p.surface, alignItems: "center", justifyContent: "center" },
  avatar: { backgroundColor: p.accent },
  avatarText: { ...typography.heading, color: p.onAccent },
  note: { marginHorizontal: space.lg, paddingVertical: 9, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: p.warmSoft },
  noteText: { ...typography.small, color: p.warm, fontWeight: "500", textAlign: "center" },
  search: {
    marginHorizontal: space.lg, height: 58, borderRadius: radius.pill, backgroundColor: p.surface,
    flexDirection: "row", alignItems: "center", gap: space.sm, paddingLeft: space.lg, paddingRight: 8,
  },
  searchText: { ...typography.body, color: p.ink3, flex: 1 },
  searchGo: { width: 46, height: 46, borderRadius: 23, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" },
  loc: { marginHorizontal: space.lg, paddingVertical: 10, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: p.surface, flexDirection: "row", gap: space.sm, alignItems: "center" },
  locText: { ...typography.small, color: p.ink, fontWeight: "600", flex: 1 },
  locHint: { ...typography.micro, color: p.ink3 },
  section: { ...typography.title, color: p.ink, paddingHorizontal: space.lg },
  chipsWrap: { height: 48, flexGrow: 0, flexShrink: 0, marginTop: -space.sm },
  chips: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg },
  chip: { paddingHorizontal: 18, height: 42, borderRadius: radius.pill, backgroundColor: p.surface, alignItems: "center", justifyContent: "center" },
  chipOn: { backgroundColor: p.accent },
  chipText: { ...typography.body, color: p.ink2, fontWeight: "500" },
  chipTextOn: { color: p.onAccent, fontWeight: "600" },
  heroRow: { paddingHorizontal: space.lg, gap: space.md },
  shelf: { gap: space.md },
  shelfRow: { paddingHorizontal: space.lg, gap: space.md },
  shelfCard: { width: 250 },
  cardWrap: { paddingHorizontal: space.lg, paddingTop: space.md },
});
