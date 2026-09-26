/**
 * Outings: what's happening this week, the rallies I'm invited to vote on, and mine.
 * Groups are a feature, not the point — this screen sits behind the dictionary, not in front.
 */
import React, { useCallback, useState } from "react";
import { View, Text, ScrollView, Pressable, RefreshControl, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useStore } from "../../lib/store.tsx";
import { outingsApi, type Eligibility, type OutingSummary } from "../../lib/outings.ts";
import { usePalette, space, radius, typography, type Palette } from "../../lib/theme.ts";
import { formatWhen } from "../../lib/format.ts";

export default function Outings() {
  const p = usePalette();
  const s = styles(p);
  const router = useRouter();
  const { t, lang, account, apiEnabled, catalog } = useStore();
  const [elig, setElig] = useState<Eligibility | null>(null);
  const [outings, setOutings] = useState<OutingSummary[]>([]);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const o = outingsApi(account.token);
      const [e, l] = await Promise.all([o.eligibility(), o.list()]);
      setElig(e); setOutings(l.outings); setPaused(l.paused);
    } catch { /* offline: keep what we had */ } finally { setLoading(false); }
  }, [account]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!apiEnabled) return <Empty p={p} text={t("outings.needApi")} />;
  if (!account) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.body}>{t("outings.signIn")}</Text>
        <Pressable style={s.primary} onPress={() => router.push("/signin")}><Text style={s.primaryText}>{t("account.signIn")}</Text></Pressable>
      </SafeAreaView>
    );
  }

  const title = (id: string) => catalog?.activities.find((a) => a.id === id)?.title ?? "";
  const mine = outings.filter((o) => o.me.status === "going" || o.me.status === "maybe" || o.me.hosting);
  const invites = outings.filter((o) => o.status === "voting" && o.me.invited && !mine.includes(o));
  const week = outings.filter((o) => o.status !== "voting" && !mine.includes(o));

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={p.ink3} />}>
        <Text style={s.intro}>{t("outings.intro")}</Text>
        {elig && !elig.ok ? (
          <Link href="/outings/setup" asChild>
            <Pressable style={s.setup} accessibilityRole="button"><Text style={s.setupText}>{t("outings.setup")} →</Text></Pressable>
          </Link>
        ) : null}
        {paused ? <Text style={s.notice}>{t("outings.paused")}</Text> : null}

        <Group p={p} title={t("outings.mine")} items={mine} title4={title} lang={lang} t={t} />
        <Group p={p} title={t("outings.invites")} items={invites} title4={title} lang={lang} t={t} />
        <Group p={p} title={t("outings.week")} items={week} title4={title} lang={lang} t={t} />
        {!outings.length && !paused ? <Text style={s.muted}>{t("outings.empty")}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({ p, title, items, title4, lang, t }: {
  p: Palette; title: string; items: OutingSummary[]; title4: (id: string) => string; lang: "fr" | "en"; t: ReturnType<typeof useStore>["t"];
}) {
  const s = styles(p);
  if (!items.length) return null;
  return (
    <View style={s.group}>
      <Text style={s.groupTitle}>{title}</Text>
      {items.map((o) => (
        <Link key={o.id} href={{ pathname: "/outings/[id]", params: { id: o.id } }} asChild>
          <Pressable style={s.row} accessibilityRole="button">
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.rowTitle} numberOfLines={1}>{title4(o.activityId)}</Text>
              <Text style={s.muted} numberOfLines={1}>{o.venue.name} · {o.startsAt ? formatWhen(o.startsAt, lang) : t("outings.voting")}</Text>
              <Text style={s.mode}>{t(o.mode === "rally" && o.organizer === "user" ? "outings.mode.rally_user" : `outings.mode.${o.mode}`)}</Text>
            </View>
            <Text style={[s.count, o.status === "paused" && { color: p.warm }]}>
              {o.status === "paused" ? "⏸" : o.status === "voting" ? "?" : t("outings.going", { n: o.going, cap: o.capacity })}
            </Text>
          </Pressable>
        </Link>
      ))}
    </View>
  );
}

function Empty({ p, text }: { p: Palette; text: string }) {
  const s = styles(p);
  return <SafeAreaView style={s.center}><Text style={s.body}>{text}</Text></SafeAreaView>;
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl, backgroundColor: p.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  intro: { ...typography.small, color: p.ink3 },
  body: { ...typography.body, color: p.ink, textAlign: "center" },
  muted: { ...typography.small, color: p.ink3 },
  notice: { ...typography.body, color: p.warm, backgroundColor: p.warmSoft, padding: space.md, borderRadius: radius.md },
  setup: { backgroundColor: p.accentSoft, padding: space.md, borderRadius: radius.md },
  setupText: { ...typography.heading, color: p.accent },
  group: { gap: space.sm },
  groupTitle: { ...typography.micro, color: p.ink3, textTransform: "uppercase" },
  row: {
    flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md, backgroundColor: p.surface,
    borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  rowTitle: { ...typography.heading, color: p.ink },
  mode: { ...typography.micro, color: p.accent },
  count: { ...typography.small, color: p.ink2, fontWeight: "600" },
  primary: { backgroundColor: p.accent, paddingHorizontal: space.xl, paddingVertical: space.md, borderRadius: radius.pill },
  primaryText: { ...typography.heading, color: p.onAccent },
});
