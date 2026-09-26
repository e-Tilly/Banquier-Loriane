/**
 * Activity detail. The accessibility block is explicit about what is unknown — "we don't
 * know" is honest and useful; a missing row implying "no" is neither.
 */
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Linking, Share, Platform, Image, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { haversineKm, a11yValue } from "@core/catalog/filter.ts";
import { isOpenAt } from "@core/catalog/hours.ts";
import { useStore } from "../../lib/store.tsx";
import { config, mediaUrl } from "../../lib/config.ts";
import { usePalette, space, radius, typography, type Palette } from "../../lib/theme.ts";
import { formatPrice, formatDuration, formatDistance, effortLabel, formatDate } from "../../lib/format.ts";
import { ListSheet } from "../../components/ListSheet.tsx";
import { ReportSheet } from "../../components/ReportSheet.tsx";
import { GoTogether } from "../../components/GoTogether.tsx";
import { communityApi } from "../../lib/community.ts";

const A11Y_SLUGS = [
  "a11y.step_free_entry", "a11y.wheelchair_throughout", "a11y.accessible_washroom",
  "a11y.seating_available", "a11y.low_sensory", "a11y.service_animals",
];

export default function ActivityDetail() {
  const p = usePalette();
  const s = styles(p);
  const { id } = useLocalSearchParams<{ id: string }>();
  const { catalog, lang, t, rankContext, isSaved, toggleSave, account } = useStore();
  const [listOpen, setListOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  // Accept either the id or the slug: shared links use the slug, which survives re-imports.
  const activity = useMemo(
    () => catalog?.activities.find((a) => a.id === id || a.slug === id) ?? null,
    [catalog, id],
  );
  const venue = useMemo(
    () => catalog?.venues.find((v) => v.id === activity?.venueId) ?? null,
    [catalog, activity],
  );

  if (!catalog || !activity) {
    return <SafeAreaView style={s.center}><Text style={s.body}>{t("detail.notFound")}</Text></SafeAreaView>;
  }

  const distance = haversineKm(rankContext.lat, rankContext.lon, activity.lat, activity.lon);
  const open = isOpenAt(activity.hours, rankContext.now);
  const saved = isSaved(activity.id);
  const known = A11Y_SLUGS.filter((slug) => a11yValue(activity, slug) !== null);
  const unknown = A11Y_SLUGS.filter((slug) => catalog.tagLabels[slug] && a11yValue(activity, slug) === null);

  const openMaps = () => {
    const label = encodeURIComponent(venue?.name ?? activity.title);
    const url = Platform.OS === "ios"
      ? `https://maps.apple.com/?q=${label}&ll=${activity.lat},${activity.lon}`
      : `https://www.google.com/maps/search/?api=1&query=${activity.lat},${activity.lon}`;
    void Linking.openURL(url);
  };

  const share = async () => {
    const url = `${config.webUrl}/a/${activity.slug}`;
    const message = t("detail.shareMessage", { title: activity.title });
    try {
      if (Platform.OS === "web" && typeof navigator !== "undefined" && "share" in navigator) {
        await (navigator as Navigator & { share: (d: object) => Promise<void> }).share({ title: activity.title, text: message, url });
      } else {
        await Share.share(Platform.OS === "ios" ? { message, url } : { message: `${message}\n${url}` });
      }
    } catch { /* the user cancelled */ }
  };

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.content}>
        {activity.img ? (
          <Image
            source={{ uri: mediaUrl(activity.img.key) }}
            style={[s.hero, activity.img.w && activity.img.h ? { aspectRatio: activity.img.w / activity.img.h } : null]}
            accessibilityIgnoresInvertColors
          />
        ) : null}
        <Text style={s.kicker}>{catalog.tagLabels[activity.cat] ?? activity.cat}</Text>
        <Text style={s.title}>{activity.title}</Text>
        {activity.summary ? <Text style={s.summary}>{activity.summary}</Text> : null}

        <View style={s.factRow}>
          <Fact p={p} label={t("detail.price")} value={formatPrice(activity, lang) || "—"} />
          <Fact p={p} label={t("detail.duration")} value={formatDuration(activity, lang) || "—"} />
          <Fact p={p} label={t("detail.distance")} value={formatDistance(distance, lang)} />
          <Fact p={p} label={t("detail.effort")} value={effortLabel(activity, lang) ?? t("effort.1")} />
        </View>

        <View style={s.quick}>
          <Quick p={p} label={t("detail.share")} onPress={share} />
          <Quick p={p} label={t("detail.addToList")} onPress={() => setListOpen(true)} />
          <Quick p={p} label={t("detail.report")} onPress={() => setReportOpen(true)} />
        </View>

        {activity.description ? (
          <Section p={p} title={t("detail.about")}><Text style={s.body}>{activity.description}</Text></Section>
        ) : null}
        {activity.whatToBring ? (
          <Section p={p} title={t("detail.bring")}><Text style={s.body}>{activity.whatToBring}</Text></Section>
        ) : null}

        <Section p={p} title={t("detail.hours")}>
          <Text style={[s.body, open === "open" && s.open, open === "closed" && s.closed]}>
            {open === "unknown" ? t("card.hoursUnknown") : open === "open" ? t("card.open") : t("card.closed")}
          </Text>
          {activity.hours ? <Text style={s.mono}>{activity.hours}</Text> : null}
        </Section>

        <Section p={p} title={t("detail.a11y")}>
          {known.length === 0 && unknown.length === 0 ? <Text style={s.muted}>{t("detail.a11yNone")}</Text> : null}
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
              <Text style={s.unknownLabel}>{t("detail.a11yUnverified")}</Text>
              <Text style={s.muted}>{unknown.map((slug) => catalog.tagLabels[slug]).join(", ")}</Text>
              <Text style={s.unknownNote}>{t("detail.a11yCallAhead")}</Text>
            </View>
          ) : null}
        </Section>

        {activity.tags.length > 0 ? (
          <Section p={p} title={t("detail.tags")}>
            <View style={s.tagWrap}>
              {activity.tags.map((slug) => (
                <View key={slug} style={s.tag}><Text style={s.tagText}>{catalog.tagLabels[slug] ?? slug}</Text></View>
              ))}
            </View>
          </Section>
        ) : null}

        <GoTogether activityId={activity.id} />

        {venue ? (
          <Section p={p} title={t("detail.where")}>
            <Text style={s.body}>{venue.name}</Text>
            {venue.address ? <Text style={s.muted}>{venue.address}</Text> : null}
            {venue.neighbourhood ? <Text style={s.muted}>{venue.neighbourhood}</Text> : null}
          </Section>
        ) : null}

        {account && saved && !confirmed ? (
          <View style={s.confirm}>
            <Text style={s.body}>{t("detail.stillAccurate")}</Text>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {([true, false] as const).map((ok) => (
                <Pressable key={String(ok)} style={s.confirmBtn} accessibilityRole="button"
                  onPress={() => { void communityApi(account.token).confirm(activity.id, ok).catch(() => {}); setConfirmed(true); }}>
                  <Text style={s.secondaryText}>{t(ok ? "detail.accurateYes" : "detail.accurateNo")}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : confirmed ? <Text style={s.muted}>{t("detail.accurateThanks")}</Text> : null}

        <Text style={s.verified}>
          {activity.verifiedAt ? t("detail.verified", { date: formatDate(activity.verifiedAt, lang) }) : t("detail.unverified")}
        </Text>
      </ScrollView>

      <View style={s.actions}>
        <Pressable style={[s.action, s.secondary]} onPress={() => toggleSave(activity.id)}
          accessibilityRole="button" accessibilityState={{ selected: saved }}>
          <Text style={s.secondaryText}>{saved ? t("detail.saved") : t("detail.save")}</Text>
        </Pressable>
        {activity.bookingUrl ? (
          <Pressable style={[s.action, s.secondary]} onPress={() => void Linking.openURL(activity.bookingUrl!)} accessibilityRole="link">
            <Text style={s.secondaryText}>{t("detail.book")}</Text>
          </Pressable>
        ) : null}
        <Pressable style={[s.action, s.primary]} onPress={openMaps} accessibilityRole="button">
          <Text style={s.primaryText}>{t("detail.go")}</Text>
        </Pressable>
      </View>

      <ListSheet activityId={activity.id} visible={listOpen} onClose={() => setListOpen(false)} />
      <ReportSheet activityId={activity.id} visible={reportOpen} onClose={() => setReportOpen(false)} />
    </SafeAreaView>
  );
}

function Section({ p, title, children }: { p: Palette; title: string; children: React.ReactNode }) {
  const s = styles(p);
  return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text>{children}</View>;
}

function Fact({ p, label, value }: { p: Palette; label: string; value: string }) {
  const s = styles(p);
  return <View style={s.fact}><Text style={s.factLabel}>{label}</Text><Text style={s.factValue}>{value}</Text></View>;
}

function Quick({ p, label, onPress }: { p: Palette; label: string; onPress: () => void }) {
  const s = styles(p);
  return (
    <Pressable style={s.quickBtn} onPress={onPress} accessibilityRole="button">
      <Text style={s.quickText}>{label}</Text>
    </Pressable>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: p.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  confirm: { gap: space.sm, padding: space.md, backgroundColor: p.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule },
  confirmBtn: { backgroundColor: p.accentSoft, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  hero: { width: "100%", aspectRatio: 4 / 3, maxHeight: 360, borderRadius: radius.lg, backgroundColor: p.surfaceAlt },
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
  quick: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  quickBtn: {
    paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill, minHeight: 36,
    backgroundColor: p.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule, justifyContent: "center",
  },
  quickText: { ...typography.small, color: p.ink2, fontWeight: "500" },
  section: { gap: space.xs },
  sectionTitle: { ...typography.heading, color: p.ink },
  body: { ...typography.body, color: p.ink2, lineHeight: 22 },
  muted: { ...typography.small, color: p.ink3 },
  mono: { ...typography.small, color: p.ink3, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
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
  tag: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: p.surfaceAlt },
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
