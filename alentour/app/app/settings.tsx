/** Language, location, data freshness, and the open-data attribution the licences require. */
import React from "react";
import { View, Text, ScrollView, Pressable, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { formatDate } from "../lib/format.ts";
import type { Lang } from "../lib/i18n.ts";

export default function Settings() {
  const p = usePalette();
  const s = styles(p);
  const { t, lang, langOverride, setLangOverride, hasPreciseLocation, requestLocation, catalog } = useStore();

  const choices: { value: Lang | null; label: string }[] = [
    { value: null, label: t("settings.langAuto") },
    { value: "fr", label: "Français" },
    { value: "en", label: "English" },
  ];

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.content}>
        <Group p={p} title={t("settings.language")}>
          {choices.map((c) => {
            const on = langOverride === c.value;
            return (
              <Pressable key={String(c.value)} style={s.row} onPress={() => setLangOverride(c.value)}
                accessibilityRole="radio" accessibilityState={{ selected: on }}>
                <Text style={s.rowText}>{c.label}</Text>
                {on ? <Text style={s.tick}>✓</Text> : null}
              </Pressable>
            );
          })}
        </Group>

        <Group p={p} title={t("settings.location")}>
          <View style={s.row}>
            <Text style={s.rowText}>{hasPreciseLocation ? t("settings.locationOn") : t("settings.locationOff")}</Text>
          </View>
          {!hasPreciseLocation ? (
            <Pressable style={s.row} onPress={requestLocation} accessibilityRole="button">
              <Text style={[s.rowText, s.link]}>{t("settings.locationEnable")}</Text>
            </Pressable>
          ) : null}
          <Text style={s.note}>{t("settings.locationNote")}</Text>
        </Group>

        {catalog ? (
          <Group p={p} title={t("settings.data")}>
            <Text style={s.note}>
              {t("settings.catalog", { n: catalog.counts.activities, date: formatDate(catalog.generatedAt, lang) })}
            </Text>
          </Group>
        ) : null}

        <Group p={p} title={t("settings.credits")}>
          <Text style={s.note}>{t("settings.creditsBody")}</Text>
        </Group>

        <Text style={s.version}>{t("settings.version", { v: Constants.expoConfig?.version ?? "dev" })}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ p, title, children }: { p: Palette; title: string; children: React.ReactNode }) {
  const s = styles(p);
  return (
    <View style={s.group}>
      <Text style={s.groupTitle}>{title}</Text>
      <View style={s.card}>{children}</View>
    </View>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  group: { gap: space.sm },
  groupTitle: { ...typography.micro, color: p.ink3, textTransform: "uppercase" },
  card: {
    backgroundColor: p.surface, borderRadius: radius.md, overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  row: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 48,
    paddingHorizontal: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.rule,
  },
  rowText: { ...typography.body, color: p.ink },
  link: { color: p.accent, fontWeight: "600" },
  tick: { ...typography.heading, color: p.accent },
  note: { ...typography.small, color: p.ink3, padding: space.md, lineHeight: 19 },
  version: { ...typography.micro, color: p.ink4, textAlign: "center" },
});
