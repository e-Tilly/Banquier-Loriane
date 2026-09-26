/**
 * One outing: when and where, how many humans are going (a count — never a gallery of faces:
 * this is not a dating app), voting, joining, the group chat, and reporting.
 *
 * Messages from the concierge are labelled "Alentour" and styled as the app speaking. It is
 * never shown as a member, and it is never counted in "going".
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, TextInput, Alert, Platform, KeyboardAvoidingView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useStore } from "../../lib/store.tsx";
import { ApiError } from "../../lib/api.ts";
import { outingsApi, type Answer, type ChatMessage, type OutingDetail } from "../../lib/outings.ts";
import { usePalette, space, radius, typography, type Palette } from "../../lib/theme.ts";
import { formatWhen } from "../../lib/format.ts";
import type { Key } from "../../lib/i18n.ts";

const KNOWN = new Set(["ineligible", "paused", "full", "closed", "rate_limited", "contact_details", "network"]);

export default function OutingScreen() {
  const p = usePalette();
  const s = styles(p);
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, lang, account, catalog } = useStore();
  const [o, setO] = useState<OutingDetail | null>(null);
  const [missing, setMissing] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rated, setRated] = useState(false);
  const last = useRef(0);
  const api = account ? outingsApi(account.token) : null;

  const load = useCallback(async () => {
    if (!api || !id) return;
    try {
      const r = await api.get(id);
      setO(r.outing);
      const member = r.outing.me.status === "going" || r.outing.me.status === "maybe" || r.outing.me.hosting;
      if (member) {
        const m = await api.messages(id);
        setMessages(m.messages);
        last.current = m.messages.at(-1)?.id ?? 0;
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setMissing(true);
    }
  }, [account, id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Light polling while the chat is open; a socket is not worth it at eight people.
  useEffect(() => {
    if (!o?.chatOpen || !api) return;
    const timer = setInterval(async () => {
      try {
        const m = await api.messages(o.id, last.current);
        if (m.messages.length) { setMessages((x) => [...x, ...m.messages]); last.current = m.messages.at(-1)!.id; }
      } catch { /* offline */ }
    }, 8000);
    return () => clearInterval(timer);
  }, [o?.chatOpen, o?.id, account]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    setBusy(true); setNote(null);
    try { await fn(); if (ok) setNote(ok); await load(); }
    catch (err) {
      const code = err instanceof ApiError ? err.code : "network";
      if (code === "ineligible") { router.push("/outings/setup"); return; }
      setNote(t((KNOWN.has(code) ? `error.${code}` : "error.generic") as Key));
    } finally { setBusy(false); }
  };

  if (missing || !account) return <SafeAreaView style={s.center}><Text style={s.body}>{t("detail.notFound")}</Text></SafeAreaView>;
  if (!o) return <SafeAreaView style={s.center} />;

  const activity = catalog?.activities.find((a) => a.id === o.activityId);
  const going = o.me.status === "going";
  const past = o.startsAt ? new Date(o.startsAt).getTime() < Date.now() : false;

  const vote = (optionId: string, answer: Answer) => act(() => api!.vote(o.id, { [optionId]: answer }));
  const send = () => {
    const body = draft.trim();
    if (!body) return;
    void act(async () => { await api!.post(o.id, body); setDraft(""); });
  };
  const report = () => {
    const go = () => act(() => api!.report("outing", o.id, "safety"), t("outings.reported"));
    if (Platform.OS === "web") { void go(); return; }
    Alert.alert(t("outings.report"), t("outings.safety"), [
      { text: t("report.cancel"), style: "cancel" }, { text: t("report.send"), style: "destructive", onPress: () => void go() },
    ]);
  };
  const messageMenu = (m: ChatMessage) => {
    if (m.mine || m.kind !== "user") return;
    const reportIt = () => act(() => api!.report("message", String(m.id), "harassment"), t("outings.reported"));
    const block = () => act(() => api!.blockAuthor(o.id, m.id), t("outings.blocked")).then(() => router.back());
    if (Platform.OS === "web") { void reportIt(); return; }
    Alert.alert(m.author ?? "", undefined, [
      { text: t("outings.reportMessage"), onPress: () => void reportIt() },
      { text: t("outings.block"), style: "destructive", onPress: () => void block() },
      { text: t("report.cancel"), style: "cancel" },
    ]);
  };

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={s.content}>
          <Text style={s.kicker}>{t(o.mode === "rally" && o.organizer === "user" ? "outings.mode.rally_user" : `outings.mode.${o.mode}`)}</Text>
          <Text style={s.title}>{activity?.title ?? ""}</Text>
          <Text style={s.body}>{o.venue.name}{o.venue.address ? ` · ${o.venue.address}` : ""}</Text>
          {o.startsAt ? <Text style={s.when}>{formatWhen(o.startsAt, lang)}</Text> : null}
          {o.status !== "voting" ? <Text style={s.count}>{t("outings.going", { n: o.going, cap: o.capacity })}</Text> : null}
          {o.status === "paused" ? <Text style={s.paused}>{t("outings.status.paused")}</Text> : null}
          {note ? <Text style={s.note}>{note}</Text> : null}

          {o.status === "voting" ? (
            <View style={s.card}>
              <Text style={s.heading}>{t("outings.voteTitle")}</Text>
              {o.decisionDeadline ? <Text style={s.muted}>{t("outings.voteHint", { q: o.quorum, date: formatWhen(o.decisionDeadline, lang) })}</Text> : null}
              {o.options.map((opt) => (
                <View key={opt.id} style={s.option}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.body}>{formatWhen(opt.starts_at, lang)}</Text>
                    <Text style={s.muted}>{t("outings.tally", { yes: opt.yes, maybe: opt.maybe })}</Text>
                  </View>
                  {(["yes", "maybe", "no"] as const).map((a) => (
                    <Pressable key={a} disabled={busy} onPress={() => void vote(opt.id, a)}
                      style={[s.chip, opt.mine === a && s.chipOn]} accessibilityRole="button" accessibilityState={{ selected: opt.mine === a }}>
                      <Text style={[s.chipText, opt.mine === a && s.chipTextOn]}>{t(`outings.${a}`)}</Text>
                    </Pressable>
                  ))}
                </View>
              ))}
            </View>
          ) : null}

          {o.status === "confirmed" && !past ? (
            going
              ? <Pressable style={s.secondary} disabled={busy} onPress={() => void act(() => api!.leave(o.id))}><Text style={s.secondaryText}>{t("outings.youreGoing")} · {t("outings.leave")}</Text></Pressable>
              : o.going >= o.capacity
                ? <Text style={s.muted}>{t("outings.full")}</Text>
                : <Pressable style={s.primary} disabled={busy} onPress={() => void act(() => api!.join(o.id))}><Text style={s.primaryText}>{t("outings.join")}</Text></Pressable>
          ) : null}

          {going && o.status === "confirmed" && o.startsAt && Math.abs(new Date(o.startsAt).getTime() - Date.now()) < 3 * 3_600_000 ? (
            o.me.checkedIn
              ? <Text style={s.muted}>{t("outings.checkedIn")}</Text>
              : <Pressable style={s.secondary} onPress={() => void act(() => api!.checkIn(o.id))}><Text style={s.secondaryText}>{t("outings.checkin")}</Text></Pressable>
          ) : null}

          {going && past && !rated ? (
            <View style={s.card}>
              <Text style={s.heading}>{t("outings.rate")}</Text>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Pressable key={n} style={s.chip} onPress={() => void act(async () => { await api!.feedback(o.id, n, n >= 4); setRated(true); }, t("outings.thanks"))}>
                    <Text style={s.chipText}>{"★".repeat(n)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {(going || o.me.status === "maybe" || o.me.hosting) ? (
            <View style={s.card}>
              <Text style={s.heading}>{t("outings.chat")}</Text>
              {!o.chatOpen ? <Text style={s.muted}>{t("outings.chatClosed")}</Text> : null}
              {messages.map((m) => (
                <Pressable key={m.id} onLongPress={() => messageMenu(m)}
                  style={[s.msg, m.kind === "concierge" && s.msgApp, m.mine && s.msgMine]}>
                  <Text style={[s.msgAuthor, m.kind === "concierge" && { color: p.accent }]}>
                    {m.kind === "concierge" ? `✦ ${t("outings.alentour")}` : m.mine ? "" : m.author}
                  </Text>
                  <Text style={[s.body, m.status === "held" && s.muted]}>{m.status === "held" ? `${m.body ?? ""}\n(${t("outings.held")})` : m.body}</Text>
                  {!m.mine && m.kind === "user" && Platform.OS === "web" ? (
                    <View style={{ flexDirection: "row", gap: space.md }}>
                      <Pressable onPress={() => void act(() => api!.report("message", String(m.id), "harassment"), t("outings.reported"))}><Text style={s.link}>{t("outings.reportMessage")}</Text></Pressable>
                      <Pressable onPress={() => void act(() => api!.blockAuthor(o.id, m.id), t("outings.blocked"))}><Text style={s.link}>{t("outings.block")}</Text></Pressable>
                    </View>
                  ) : null}
                </Pressable>
              ))}
              {o.chatOpen ? (
                <View style={s.composer}>
                  <TextInput value={draft} onChangeText={setDraft} placeholder={t("outings.chatPlaceholder")} placeholderTextColor={p.ink4}
                    style={s.input} multiline maxLength={1000} accessibilityLabel={t("outings.chatPlaceholder")} />
                  <Pressable style={s.send} disabled={busy || !draft.trim()} onPress={send}><Text style={s.primaryText}>{t("outings.send")}</Text></Pressable>
                </View>
              ) : null}
              {o.chatOpen ? <Text style={s.tiny}>{t("outings.contactDetails")}</Text> : null}
            </View>
          ) : null}

          <Text style={s.safety}>{t("outings.safety")}</Text>
          <Pressable onPress={report} accessibilityRole="button"><Text style={s.report}>{t("outings.report")}</Text></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl, backgroundColor: p.bg },
  content: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  kicker: { ...typography.micro, color: p.accent, textTransform: "uppercase" },
  title: { ...typography.display, color: p.ink },
  when: { ...typography.heading, color: p.ink },
  count: { ...typography.body, color: p.ink2, fontWeight: "600" },
  body: { ...typography.body, color: p.ink },
  muted: { ...typography.small, color: p.ink3 },
  tiny: { ...typography.small, color: p.ink4 },
  heading: { ...typography.heading, color: p.ink },
  paused: { ...typography.body, color: p.warm, backgroundColor: p.warmSoft, padding: space.md, borderRadius: radius.md },
  note: { ...typography.body, color: p.accent, backgroundColor: p.accentSoft, padding: space.md, borderRadius: radius.md },
  card: { gap: space.sm, padding: space.md, backgroundColor: p.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule },
  option: { flexDirection: "row", alignItems: "center", gap: space.xs, paddingVertical: space.xs },
  chip: { paddingHorizontal: space.sm, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: p.rule },
  chipOn: { backgroundColor: p.accent, borderColor: p.accent },
  chipText: { ...typography.small, color: p.ink2 },
  chipTextOn: { color: p.onAccent, fontWeight: "600" },
  primary: { backgroundColor: p.accent, padding: space.md, borderRadius: radius.pill, alignItems: "center" },
  primaryText: { ...typography.heading, color: p.onAccent },
  secondary: { backgroundColor: p.accentSoft, padding: space.md, borderRadius: radius.pill, alignItems: "center" },
  secondaryText: { ...typography.heading, color: p.accent },
  msg: { padding: space.sm, borderRadius: radius.md, backgroundColor: p.surfaceAlt, gap: 2 },
  msgApp: { backgroundColor: p.accentSoft },
  msgMine: { alignSelf: "flex-end", maxWidth: "85%" },
  msgAuthor: { ...typography.micro, color: p.ink3 },
  composer: { flexDirection: "row", gap: space.sm, alignItems: "flex-end" },
  input: { flex: 1, minHeight: 40, maxHeight: 120, borderWidth: 1, borderColor: p.rule, borderRadius: radius.md, padding: space.sm, color: p.ink, backgroundColor: p.bg },
  send: { backgroundColor: p.accent, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill },
  link: { ...typography.small, color: p.ink3, textDecorationLine: "underline" },
  safety: { ...typography.small, color: p.ink3, marginTop: space.md },
  report: { ...typography.body, color: p.danger, textAlign: "center", paddingVertical: space.sm },
});
