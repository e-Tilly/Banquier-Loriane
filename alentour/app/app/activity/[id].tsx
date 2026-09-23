/**
 * Activity detail. The accessibility block is deliberately explicit about what is unknown —
 * "we don't know" is honest and useful; a missing row implying "no" is neither.
 */
import React, { useMemo } from "react";
import { View, Text, ScrollView, Pressable, Linking, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { haversineKm, a11yValue } from "@core/catalog/filter.ts";
import { isOpenAt } from "@core/catalog/hours.ts";
import { useStore } from "../../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../../lib/theme.ts";
import { formatPrice, formatDuration, formatDistance, effortLabel, t } from "../../lib/format.ts";

const A11Y_SLUGS = [
  "a11y.step_free_entry", "a11y.wheelchair_throughout", "a11y.accessible_washroom",
  "a11y.seating_available", "a11y.low_sensory", "a11y.service_animals",
];

export default function ActivityDetail() {
  const p = usePalette();
  const s = styles(p);
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const { catalog, lang, rankContext, saved, toggleSave } = useStore();

  const activity = useMemo(
    () => catalog?.activities.find((a) => a.id === id) ?? null,
    [catalog, id],
  );
  const venue = useMemo(
    () => catalog?.venues.find((v) => v.id === activity?.venueId) ?? null,
    [catalog, activity],
  );

  React.useLayoutEffect(() => {
    if (activity) navigation.setOptions({ title: "" });
  }, [navigation, activity]);

  if (!catalog || !activity) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.body}>{lang === "fr" ? "Activité introuvable" : "Activity not found"}</Text>
      </SafeAreaView>
    );
  }

  const distance = haversineKm(rankContext.lat, rankContext.lon, activity.lat, activity.lon);
  const open = isOpenAt(activity.hours, rankContext.now);
  const isSaved = saved.has(activity.id);
  const known = A11Y_SLUGS.filter((slug) => a11yValue(activity, slug) !== null);
  const unknown = A11Y_SLUGS.filter(
    (slug) => catalog.tagLabels[slug] && a11yValue(activity, slug) === null,
  );

  const openMaps = () => {
    const label = encodeURIComponent(venue?.name ?? activity.title);
    Linking.openURL(`https://maps.apple.com/?q=${label}&ll=${activity.lat},${activity.lon}`);
  };

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.kicker}>{catalog.tagLabels[activity.cat] ?? activity.cat}</Text>
        <Text style={s.title}>{activity.title}</Text>
        {activity.summary ? <Text style={s.summary}>{activity.summary}</Text> : null}

        <View style={s.factRow}>
          <Fact p={p} label={lang === "fr" ? "Prix" : "Price"} value={formatPrice(activity, lang) || "—"} />
          <Fact p={p} label={lang === "fr" ? "Durée" : "Duration"} value={formatDuration(activity, lang) || "—"} />
          <Fact p={p} label={lang === "fr" ? "Distance" : "Distance"} value={formatDistance(distance, lang)} />
          <Fact p={p} label={lang === "fr" ? "Effort" : "Effort"} value={effortLabel(activity, lang) ?? (lang === "fr" ? "Léger" : "Light")} />
        </View>

        {activity.description ? (
          <Section p={p} title={lang === "fr" ? "À propos" : "About"}>
            <Text style={s.body}>{activity.description}</Text>
          </Section>
        ) : null}

        {activity.whatToBring ? (
          <Section p={p} title={lang === "fr" ? "Quoi apporter" : "What to bring"}>
            <Text style={s.body}>{activity.whatToBring}</Text>
          </Section>
        ) : null}

        <Section p={p} title={lang === "fr" ? "Horaire" : "Hours"}>
          <Text style={[s.body, open === "open" && s.open, open === "closed" && s.closed]}>
            {open === "unknown" ? t("hoursUnknown", lang)
              : open === "open" ? t("openNow", lang) : t("closed", lang)}
          </Text>
          {activity.hours ? <Text style={s.mono}>{activity.hours}</Text> : null}
        </Section>

        <Section p={p} title={lang === "fr" ? "Accessibilité" : "Accessibility"}>
          {known.length === 0 && unknown.length === 0 ? (
            <Text style={s.muted}>{lang === "fr" ? "Aucune information" : "No information"}</Text>
          ) : null}
          {known.map((slug) => {
            const v = a11yValue(activity, slug);
            return (
              <View key={slug} style={s.a11yRow}>
                <Text style={[s.a11yMark, v ? s.yes : s.no]}>{v ? "✓" : "✕"}</Text>
                <Text style={s.body}>{catalog.tagLabels[slug] ?? slug}</Text>
              </View>
            );
          })}
          {unknown.length > 0 ? (
            <View style={s.unknownBox}>
              <Text style={s.unknownLabel}>
                {lang === "fr" ? "Non vérifié :" : "Not verified:"}
              </Text>
              <Text style={s.muted}>
                {unknown.map((slug) => catalog.tagLabels[slug]).join(", ")}
              </Text>
              <Text style={s.unknownNote}>
                {lang === "fr"
                  ? "Non vérifié ne veut pas dire inaccessible. Appelle avant de te déplacer."
                  : "Not verified doesn't mean inaccessible. Call ahead."}
              </Text>
            </View>
          ) : null}
        </Section>

        {activity.tags.length > 0 ? (
          <Section p={p} title={lang === "fr" ? "Étiquettes" : "Tags"}>
            <View style={s.tagWrap}>
              {activity.tags.map((slug) => (
                <View key={slug} style={s.tag}>
                  <Text style={s.tagText}>{catalog.tagLabels[slug] ?? slug}</Text>
                </View>
              ))}
            </View>
          </Section>
        ) : null}

        {venue ? (
          <Section p={p} title={lang === "fr" ? "Où" : "Where"}>
            <Text style={s.body}>{venue.name}</Text>
            {venue.address ? <Text style={s.muted}>{venue.address}</Text> : null}
            {venue.neighbourhood ? <Text style={s.muted}>{venue.neighbourhood}</Text> : null}
          </Section>
        ) : null}

        {activity.verifiedAt ? (
          <Text style={s.verified}>
            {lang === "fr" ? "Vérifié le " : "Verified "}
            {new Date(activity.verifiedAt).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA")}
          </Text>
        ) : (
          <Text style={s.verified}>{t("unverified", lang)}</Text>
        )}
      </ScrollView>

      <View style={s.actions}>
        <Pressable
          style={[s.action, s.secondary]} onPress={() => toggleSave(activity.id)}
          accessibilityRole="button" accessibilityState={{ selected: isSaved }}
        >
          <Text style={s.secondaryText}>
            {isSaved ? (lang === "fr" ? "★ Enregistré" : "★ Saved")
                     : (lang === "fr" ? "☆ Enregistrer" : "☆ Save")}
          </Text>
        </Pressable>
        <Pressable style={[s.action, s.primary]} onPress={openMaps} accessibilityRole="button">
          <Text style={s.primaryText}>{lang === "fr" ? "Y aller" : "Directions"}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Section({ p, title, children }: { p: Palette; title: string; children: React.ReactNode }) {
  const s = styles(p);
  return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text>{children}</View>;
}

function Fact({ p, label, value }: { p: Palette; label: string; value: string }) {
  const s = styles(p);
  return (
    <View style={s.fact}>
      <Text style={s.factLabel}>{label}</Text>
      <Text style={s.factValue}>{value}</Text>
    </View>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: p.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  kicker: { ...typography.micro, color: p.accent, textTransform: "uppercase" },
  title: { ...typography.display, color: p.ink, marginTop: -space.sm },
  summary: { ...typography.body, color: p.ink2, marginTop: -space.sm },
  factRow: {
    flexDirection: "row", flexWrap: "wrap", backgroundColor: p.surface,
    borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  fact: { flexGrow: 1, flexBasis: "25%", padding: space.md, gap: 2 },
  factLabel: { ...typography.micro, color: p.ink4, textTransform: "uppercase" },
  factValue: { ...typography.body, color: p.ink, fontWeight: "600" },
  section: { gap: space.xs },
  sectionTitle: { ...typography.heading, color: p.ink },
  body: { ...typography.body, color: p.ink2, lineHeight: 22 },
  muted: { ...typography.small, color: p.ink3 },
  mono: { ...typography.small, color: p.ink3, fontFamily: "monospace" },
  open: { color: p.accent, fontWeight: "600" },
  closed: { color: p.ink3 },
  a11yRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 3 },
  a11yMark: { fontSize: 15, fontWeight: "700", width: 18 },
  yes: { color: p.accent },
  no: { color: p.danger },
  unknownBox: { backgroundColor: p.warmSoft, padding: space.md, borderRadius: radius.md, gap: 3, marginTop: space.xs },
  unknownLabel: { ...typography.micro, color: p.warm, textTransform: "uppercase" },
  unknownNote: { ...typography.small, color: p.ink3, marginTop: 4 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tag: {
    paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill,
    backgroundColor: p.surfaceAlt,
  },
  tagText: { ...typography.small, color: p.ink2 },
  verified: { ...typography.micro, color: p.ink4, textAlign: "center", marginTop: space.md },
  actions: {
    flexDirection: "row", gap: space.sm, padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.rule, backgroundColor: p.surface,
  },
  action: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: "center", minHeight: 48, justifyContent: "center" },
  primary: { backgroundColor: p.accent },
  primaryText: { ...typography.heading, color: p.onAccent },
  secondary: { backgroundColor: p.surfaceAlt },
  secondaryText: { ...typography.heading, color: p.ink2 },
});
