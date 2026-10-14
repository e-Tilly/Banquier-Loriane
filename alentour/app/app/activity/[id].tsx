/**
 * Activity detail. The accessibility block is explicit about what is unknown — "we don't
 * know" is honest and useful; a missing row implying "no" is neither.
 */
import React, { useMemo, useState } from "react";
import { View, Text, ScrollView, Pressable, Linking, Share, Platform, StyleSheet } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { haversineKm, a11yValue } from "@core/catalog/filter.ts";
import { isOpenAt } from "@core/catalog/hours.ts";
import { useStore } from "../../lib/store.tsx";
import { config } from "../../lib/config.ts";
import { usePalette, space, radius, typography, type Palette } from "../../lib/theme.ts";
import { formatPrice, formatDuration, formatDistance, effortLabel, formatDate } from "../../lib/format.ts";
import { ListSheet } from "../../components/ListSheet.tsx";
import { ReportSheet } from "../../components/ReportSheet.tsx";
import { GoTogether } from "../../components/GoTogether.tsx";
import { communityApi } from "../../lib/community.ts";
import { Art } from "../../components/Art.tsx";
import { useAmbientCategories } from "../../lib/ambient.tsx";
import { Icon } from "../../components/Icon.tsx";
import { Pill } from "../../components/ActivityCard.tsx";

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
  const [more, setMore] = useState(false);
  const router = useRouter();
  const insets = useSafeAreaInsets();
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

  useAmbientCategories([activity?.cat]);

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

  const circle = (name: "arrow-left" | "share", onPress: () => void, label: string) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={s.roundBtn}>
      <Icon name={name} size={22} color="#1F2326" />
    </Pressable>
  );
  const longText = (activity.description ?? "").length > 150;

  return (
    <View style={s.screen}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <Art id={activity.id} category={activity.cat} img={activity.img} scrim style={s.hero}>
          <View style={[s.heroTop, { top: Math.max(insets.top, 14) + 6 }]}>
            {circle("arrow-left", () => (router.canGoBack() ? router.back() : router.replace("/")), t("nav.back"))}
            <View style={{ flexDirection: "row", gap: space.sm }}>
              {circle("share", share, t("detail.share"))}
              <Pressable onPress={() => toggleSave(activity.id)} accessibilityRole="button" accessibilityState={{ selected: saved }}
                accessibilityLabel={t(saved ? "card.unsave" : "card.save")} style={s.roundBtn}>
                <Icon name={saved ? "heart-fill" : "heart"} size={22} color={saved ? "#D6455D" : "#1F2326"} />
              </Pressable>
            </View>
          </View>
        </Art>

        <View style={[s.sheet, { paddingBottom: 130 + Math.max(insets.bottom, 12) }]}>
          <View style={s.handle} />
          <Text style={s.kicker}>{catalog.tagLabels[activity.cat] ?? activity.cat}</Text>
          <Text style={s.title}>{activity.title}</Text>

          <View style={s.chipRow}>
            <View style={s.priceChip}><Text style={s.priceText}>{formatPrice(activity, lang) || "—"}</Text></View>
            {open === "open" ? <Pill p={p} label={t("card.open")} tone="brand" /> : open === "closed" ? <Pill p={p} label={t("card.closed")} tone="muted" /> : null}
          </View>

          {venue ? (
            <View style={s.place}>
              <Icon name="pin" size={18} color={p.ink2} />
              <Text style={s.placeText}>{venue.name}{venue.neighbourhood ? ` · ${venue.neighbourhood}` : ""}</Text>
            </View>
          ) : null}

          {activity.summary || activity.description ? (
            <View style={{ gap: 6 }}>
              <Text style={s.body} numberOfLines={more ? undefined : 3}>{activity.description ?? activity.summary}</Text>
              {longText ? (
                <Pressable onPress={() => setMore(!more)} accessibilityRole="button">
                  <Text style={s.readMore}>{t(more ? "detail.readLess" : "detail.readMore")}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          <View style={s.facts}>
            <Fact p={p} label={t("detail.duration")} value={formatDuration(activity, lang) || "—"} />
            <Fact p={p} label={t("detail.distance")} value={formatDistance(distance, lang)} />
            <Fact p={p} label={t("detail.effort")} value={effortLabel(activity, lang) ?? t("effort.1")} />
          </View>

          <View style={s.quick}>
            <Quick p={p} label={t("detail.addToList")} onPress={() => setListOpen(true)} />
            <Quick p={p} label={t("detail.report")} onPress={() => setReportOpen(true)} />
          </View>

          <GoTogether activityId={activity.id} />

          <Accordion p={p} title={t("detail.hours")} startOpen>
            <Text style={[s.body, open === "open" && s.open, open === "closed" && s.closed]}>
              {open === "unknown" ? t("card.hoursUnknown") : open === "open" ? t("card.open") : t("card.closed")}
            </Text>
            {activity.hours ? <Text style={s.mono}>{activity.hours}</Text> : null}
          </Accordion>

          <Accordion p={p} title={t("detail.a11y")} startOpen>
            {known.length === 0 && unknown.length === 0 ? <Text style={s.muted}>{t("detail.a11yNone")}</Text> : null}
            {known.map((slug) => {
              const v = a11yValue(activity, slug);
              return (
                <View key={slug} style={s.a11yRow}>
                  <Icon name={v ? "check" : "x"} size={18} color={v ? p.brand : p.danger} strokeWidth={2.2} />
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
          </Accordion>

          {activity.whatToBring ? (
            <Accordion p={p} title={t("detail.bring")}><Text style={s.body}>{activity.whatToBring}</Text></Accordion>
          ) : null}

          {activity.tags.length > 0 ? (
            <Accordion p={p} title={t("detail.tags")}>
              <View style={s.tagWrap}>
                {activity.tags.map((slug) => (
                  <View key={slug} style={s.tag}><Text style={s.tagText}>{catalog.tagLabels[slug] ?? slug}</Text></View>
                ))}
              </View>
            </Accordion>
          ) : null}

          {venue ? (
            <Accordion p={p} title={t("detail.where")}>
              <Text style={s.body}>{venue.name}</Text>
              {venue.address ? <Text style={s.muted}>{venue.address}</Text> : null}
              {venue.neighbourhood ? <Text style={s.muted}>{venue.neighbourhood}</Text> : null}
            </Accordion>
          ) : null}

          {account && saved && !confirmed ? (
            <View style={s.confirm}>
              <Text style={s.body}>{t("detail.stillAccurate")}</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {([true, false] as const).map((ok) => (
                  <Pressable key={String(ok)} style={s.confirmBtn} accessibilityRole="button"
                    onPress={() => { void communityApi(account.token).confirm(activity.id, ok).catch(() => {}); setConfirmed(true); }}>
                    <Text style={s.confirmText}>{t(ok ? "detail.accurateYes" : "detail.accurateNo")}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : confirmed ? <Text style={s.muted}>{t("detail.accurateThanks")}</Text> : null}

          <Text style={s.verified}>
            {activity.verifiedAt ? t("detail.verified", { date: formatDate(activity.verifiedAt, lang) }) : t("detail.unverified")}
          </Text>
        </View>
      </ScrollView>

      <View style={[s.cta, { bottom: Math.max(insets.bottom, 12) + 8 }]} pointerEvents="box-none">
        {activity.bookingUrl ? (
          <Pressable style={s.ctaSecondary} onPress={() => void Linking.openURL(activity.bookingUrl!)} accessibilityRole="link">
            <Text style={s.ctaSecondaryText}>{t("detail.book")}</Text>
          </Pressable>
        ) : null}
        <Pressable style={s.ctaPrimary} onPress={openMaps} accessibilityRole="button">
          <Text style={s.ctaPrimaryText}>{t("detail.go")}</Text>
        </Pressable>
      </View>

      <ListSheet activityId={activity.id} visible={listOpen} onClose={() => setListOpen(false)} />
      <ReportSheet activityId={activity.id} visible={reportOpen} onClose={() => setReportOpen(false)} />
    </View>
  );
}

/** A white card whose body opens and closes — the reference's day-by-day cards. */
function Accordion({ p, title, children, startOpen }: { p: Palette; title: string; children: React.ReactNode; startOpen?: boolean }) {
  const s = styles(p);
  const [open, setOpen] = useState(!!startOpen);
  return (
    <View style={s.acc}>
      <Pressable style={s.accHead} onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={s.accTitle}>{title}</Text>
        <Icon name={open ? "chevron-up" : "chevron-down"} size={22} color={p.ink2} />
      </Pressable>
      {open ? <View style={s.accBody}>{children}</View> : null}
    </View>
  );
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
  screen: { flex: 1, backgroundColor: p.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: p.canvas },
  hero: { height: 360 },
  heroTop: { position: "absolute", left: space.lg, right: space.lg, flexDirection: "row", justifyContent: "space-between" },
  roundBtn: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", ...p.glassStrong },
  sheet: {
    marginTop: -34, ...p.glassStrong, borderBottomWidth: 0, borderTopLeftRadius: radius.xl + 4, borderTopRightRadius: radius.xl + 4,
    paddingHorizontal: space.lg, paddingTop: space.lg + 4, gap: space.lg, minHeight: 640, flexGrow: 1,
  },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: "rgba(40,50,90,0.18)" },
  kicker: { ...typography.micro, color: p.brand, textTransform: "uppercase", marginBottom: -space.sm },
  title: { ...typography.display, color: p.ink, marginTop: -space.md },
  chipRow: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: -space.sm },
  priceChip: { backgroundColor: p.accent, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill },
  priceText: { ...typography.small, color: p.onAccent, fontWeight: "600" },
  place: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: -space.xs },
  placeText: { ...typography.body, color: p.ink2, flexShrink: 1 },
  body: { ...typography.body, color: p.ink2, lineHeight: 22 },
  readMore: { ...typography.body, color: p.ink, textDecorationLine: "underline", fontWeight: "500" },
  facts: { flexDirection: "row", gap: space.sm },
  fact: { flex: 1, ...p.glass, borderRadius: radius.md + 2, padding: space.md, gap: 2 },
  factLabel: { ...typography.micro, color: p.ink4, textTransform: "uppercase" },
  factValue: { ...typography.body, color: p.ink, fontWeight: "600" },
  quick: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  quickBtn: { paddingHorizontal: 16, height: 40, borderRadius: radius.pill, ...p.glass, justifyContent: "center" },
  quickText: { ...typography.small, color: p.ink2, fontWeight: "500" },
  acc: { ...p.glass, borderRadius: radius.lg },
  accHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg, paddingVertical: 18 },
  accTitle: { ...typography.heading, color: p.ink },
  accBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.xs },
  muted: { ...typography.small, color: p.ink3 },
  mono: { ...typography.small, color: p.ink3, fontFamily: Platform.select({ ios: "Menlo", default: "monospace" }) },
  open: { color: p.brand, fontWeight: "600" },
  closed: { color: p.ink3 },
  a11yRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingVertical: 3 },
  unknownBox: { backgroundColor: p.warmSoft, padding: space.md, borderRadius: radius.md, gap: 3, marginTop: space.xs },
  unknownLabel: { ...typography.micro, color: p.warm, textTransform: "uppercase" },
  unknownNote: { ...typography.small, color: p.ink3, marginTop: 4 },
  tagWrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  tag: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: p.surfaceAlt },
  tagText: { ...typography.small, color: p.ink2 },
  confirm: { gap: space.sm, padding: space.lg, ...p.glass, borderRadius: radius.lg },
  confirmBtn: { backgroundColor: p.accentSoft, paddingHorizontal: space.lg, height: 40, justifyContent: "center", borderRadius: radius.pill },
  confirmText: { ...typography.small, color: p.ink, fontWeight: "600" },
  verified: { ...typography.micro, color: p.ink4, textAlign: "center" },
  cta: { position: "absolute", left: space.lg, right: space.lg, flexDirection: "row", gap: space.sm },
  ctaPrimary: {
    flex: 1, height: 60, borderRadius: 30, backgroundColor: p.accent, alignItems: "center", justifyContent: "center",
    shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  ctaPrimaryText: { ...typography.heading, color: p.onAccent },
  ctaSecondary: { paddingHorizontal: 26, height: 60, borderRadius: 30, ...p.glass, alignItems: "center", justifyContent: "center" },
  ctaSecondaryText: { ...typography.heading, color: p.ink },
});
