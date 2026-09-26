/**
 * "Go with others" on an activity: upcoming outings for it, and a way to suggest one. Only
 * shown when an API is configured and someone is signed in — the dictionary never depends on it.
 */
import React, { useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Link, useFocusEffect, useRouter } from "expo-router";
import { useStore } from "../lib/store.tsx";
import { ApiError } from "../lib/api.ts";
import { outingsApi, type OutingSummary } from "../lib/outings.ts";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { formatWhen } from "../lib/format.ts";
import type { Key } from "../lib/i18n.ts";

export function GoTogether({ activityId }: { activityId: string }) {
  const p = usePalette();
  const s = styles(p);
  const router = useRouter();
  const { t, lang, account, apiEnabled } = useStore();
  const [items, setItems] = useState<OutingSummary[] | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!account) return;
    try { setItems((await outingsApi(account.token).list({ activityId })).outings); } catch { setItems([]); }
  }, [account, activityId]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (!apiEnabled || !account) return null;

  const propose = async () => {
    setNote(null);
    try {
      const r = await outingsApi(account.token).propose(activityId);
      setNote(t("outings.proposed", { n: r.invited }));
      await load();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : "network";
      if (code === "ineligible") { router.push("/outings/setup"); return; }
      const known = ["paused", "rate_limited", "no_slots", "too_risky", "not_enough_interest", "network"];
      setNote(t((known.includes(code) ? `error.${code}` : "error.generic") as Key));
    }
  };

  return (
    <View style={s.section}>
      <Text style={s.title}>{t("outings.withOthers")}</Text>
      {items && !items.length ? <Text style={s.muted}>{t("outings.none")}</Text> : null}
      {(items ?? []).slice(0, 4).map((o) => (
        <Link key={o.id} href={{ pathname: "/outings/[id]", params: { id: o.id } }} asChild>
          <Pressable style={s.row} accessibilityRole="button">
            <Text style={s.body}>{o.startsAt ? formatWhen(o.startsAt, lang) : t("outings.voting")}</Text>
            <Text style={s.muted}>{o.status === "voting" ? "" : t("outings.going", { n: o.going, cap: o.capacity })}</Text>
          </Pressable>
        </Link>
      ))}
      {note ? <Text style={s.note}>{note}</Text> : null}
      <Pressable style={s.button} onPress={() => void propose()} accessibilityRole="button">
        <Text style={s.buttonText}>{t("outings.propose")}</Text>
      </Pressable>
    </View>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  section: { gap: space.sm },
  title: { ...typography.micro, color: p.ink3, textTransform: "uppercase" },
  body: { ...typography.body, color: p.ink },
  muted: { ...typography.small, color: p.ink3 },
  note: { ...typography.small, color: p.accent },
  row: { flexDirection: "row", justifyContent: "space-between", padding: space.md, backgroundColor: p.surface, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule },
  button: { alignSelf: "flex-start", backgroundColor: p.accentSoft, paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
  buttonText: { ...typography.heading, color: p.accent },
});
