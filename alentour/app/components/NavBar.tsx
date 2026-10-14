/** The floating dark pill: Home, Explore, Map, Saved, Outings. The active item is a light circle. */
import React from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius } from "../lib/theme.ts";
import { Icon, type IconName } from "./Icon.tsx";
import type { Key } from "../lib/i18n.ts";

type Tab = "home" | "explore" | "map" | "saved" | "outings";
const ITEMS: { tab: Tab; href: string; icon: IconName; label: Key; needsApi?: boolean }[] = [
  { tab: "home", href: "/", icon: "home", label: "nav.home" },
  { tab: "explore", href: "/browse", icon: "compass", label: "nav.explore" },
  { tab: "map", href: "/map", icon: "map", label: "nav.map" },
  { tab: "saved", href: "/saved", icon: "heart", label: "nav.saved" },
  { tab: "outings", href: "/outings", icon: "users", label: "nav.outings", needsApi: true },
];

/** Height the screens must leave free at the bottom. */
export const NAV_SPACE = 104;

export function NavBar({ active }: { active: Tab | null }) {
  const p = usePalette();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { t, apiEnabled } = useStore();
  const items = ITEMS.filter((i) => !i.needsApi || apiEnabled);
  return (
    <View style={[s.wrap, { bottom: Math.max(insets.bottom, 12) + 6 }]} pointerEvents="box-none">
      <View style={[s.bar, { backgroundColor: p.navBg }]} accessibilityRole="tablist">
        {items.map((i) => {
          const on = i.tab === active;
          return (
            <Pressable key={i.tab} onPress={() => { if (!on) router.replace(i.href as never); }}
              accessibilityRole="tab" accessibilityLabel={t(i.label)} accessibilityState={{ selected: on }}
              style={[s.item, on && { backgroundColor: p.navActiveBg }]} hitSlop={4}>
              <Icon name={i.icon} size={22} color={on ? p.navActiveFg : p.navFg} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  bar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm,
    paddingHorizontal: 10, paddingVertical: 10, borderRadius: radius.pill, minWidth: 260,
    shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  item: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
});
