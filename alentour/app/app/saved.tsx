/** Saved activities, and the user's lists. Everything here works offline. */
import React, { useMemo, useState } from "react";
import { View, Text, FlatList, Pressable, ScrollView, StyleSheet, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { haversineKm, type Scored } from "@core/catalog/filter.ts";
import { isOpenAt } from "@core/catalog/hours.ts";
import { savedIds, visibleLists } from "@core/user/library.ts";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { ActivityCard } from "../components/ActivityCard.tsx";

export default function Saved() {
  const p = usePalette();
  const s = styles(p);
  const { catalog, lang, t, library, isSaved, toggleSave, deleteList, rankContext } = useStore();
  const [listId, setListId] = useState<string | null>(null);   // null = all saves
  const lists = visibleLists(library);
  const activeList = lists.find((l) => l.id === listId) ?? null;

  const items: Scored[] = useMemo(() => {
    if (!catalog) return [];
    const ids = activeList ? activeList.items : savedIds(library);
    const byId = new Map(catalog.activities.map((a) => [a.id, a]));
    return ids
      .map((id) => byId.get(id))
      .filter((a): a is NonNullable<typeof a> => !!a)          // may have left the catalog
      .map((a) => ({
        activity: a,
        distanceKm: haversineKm(rankContext.lat, rankContext.lon, a.lat, a.lon),
        openState: isOpenAt(a.hours, rankContext.now),
        score: 0,
      }));
  }, [catalog, library, activeList, rankContext]);

  const confirmDelete = (id: string, name: string) => {
    if (Platform.OS === "web") { deleteList(id); setListId(null); return; }
    Alert.alert(t("lists.delete"), name, [
      { text: t("report.cancel"), style: "cancel" },
      { text: t("lists.delete"), style: "destructive", onPress: () => { deleteList(id); setListId(null); } },
    ]);
  };

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      {lists.length > 0 ? (
        <View style={s.tabsWrap}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.tabs}>
            <Tab p={p} label={t("saved.all")} active={listId === null} onPress={() => setListId(null)} />
            {lists.map((l) => (
              <Tab key={l.id} p={p} label={`${l.name} · ${l.items.length}`} active={listId === l.id}
                onPress={() => setListId(l.id)} onLongPress={() => confirmDelete(l.id, l.name)} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {items.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyTitle}>{t("saved.empty")}</Text>
          <Text style={s.emptyBody}>{t("saved.emptyBody")}</Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.activity.id}
          contentContainerStyle={s.list}
          renderItem={({ item }) => (
            <View style={s.cardWrap}>
              <ActivityCard item={item} lang={lang} saved={isSaved(item.activity.id)} onToggleSave={toggleSave} />
            </View>
          )}
          ListFooterComponent={activeList ? (
            <Pressable style={s.deleteBtn} onPress={() => confirmDelete(activeList.id, activeList.name)}
              accessibilityRole="button">
              <Text style={s.deleteText}>{t("lists.delete")}</Text>
            </Pressable>
          ) : null}
        />
      )}
    </SafeAreaView>
  );
}

function Tab({ p, label, active, onPress, onLongPress }: {
  p: Palette; label: string; active: boolean; onPress: () => void; onLongPress?: () => void;
}) {
  const s = styles(p);
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={[s.tab, active && s.tabActive]}
      accessibilityRole="tab" accessibilityState={{ selected: active }}>
      <Text style={[s.tabText, active && s.tabTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  tabsWrap: { height: 52, flexGrow: 0, flexShrink: 0 },
  tabs: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg },
  tab: {
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: p.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  tabActive: { backgroundColor: p.accent, borderColor: p.accent },
  tabText: { ...typography.small, color: p.ink2 },
  tabTextActive: { color: p.onAccent, fontWeight: "600" },
  list: { paddingBottom: space.xxl },
  cardWrap: { paddingHorizontal: space.lg, paddingTop: space.md },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm, padding: space.xl },
  emptyTitle: { ...typography.title, color: p.ink },
  emptyBody: { ...typography.body, color: p.ink3, textAlign: "center" },
  deleteBtn: { margin: space.lg, padding: space.md, alignItems: "center" },
  deleteText: { ...typography.small, color: p.danger, fontWeight: "600" },
});
