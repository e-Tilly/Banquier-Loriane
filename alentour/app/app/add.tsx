/**
 * Add an activity (docs/alentour/07 §3): name → category → where → up to three tags → send.
 * The model suggests tags from the name; the person confirms by keeping or removing each one.
 * A likely duplicate is shown before anything is created.
 */
import React, { useMemo, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Switch, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, useRouter } from "expo-router";
import { useStore } from "../lib/store.tsx";
import { ApiError } from "../lib/api.ts";
import { communityApi, type NewActivity, type Similar } from "../lib/community.ts";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import type { Key } from "../lib/i18n.ts";

const KNOWN = new Set(["duplicate", "prohibited", "contact_details", "outside_city", "rate_limited", "invalid", "network"]);

export default function Add() {
  const p = usePalette();
  const s = styles(p);
  const router = useRouter();
  const { t, lang, account, catalog, position, hasPreciseLocation, requestLocation } = useStore();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [where, setWhere] = useState<"venue" | "here">("venue");
  const [venueQuery, setVenueQuery] = useState("");
  const [venueId, setVenueId] = useState<string | null>(null);
  const [placeName, setPlaceName] = useState("");
  const [free, setFree] = useState(true);
  const [similar, setSimilar] = useState<Similar[] | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const categories = useMemo(
    () => Object.entries(catalog?.tagLabels ?? {}).filter(([k]) => k.startsWith("category.")),
    [catalog]);
  const venues = useMemo(() => {
    const q = venueQuery.trim().toLowerCase();
    if (q.length < 2 || !catalog) return [];
    return catalog.venues.filter((v) => v.name.toLowerCase().includes(q)).slice(0, 5);
  }, [catalog, venueQuery]);

  if (!account) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.body}>{t("outings.signIn")}</Text>
        <Pressable style={s.primary} onPress={() => router.push("/signin")}><Text style={s.primaryText}>{t("account.signIn")}</Text></Pressable>
      </SafeAreaView>
    );
  }
  const api = communityApi(account.token);

  const suggest = async () => {
    if (title.trim().length < 3) return;
    try {
      const r = await api.suggest(title.trim(), description.trim());
      if (r.category && !category) setCategory(r.category);
      setTags(r.tags.slice(0, 3));
    } catch { /* suggestions are optional */ }
  };

  const ready = title.trim().length >= 3 && !!category
    && (where === "venue" ? !!venueId : hasPreciseLocation && placeName.trim().length >= 2);

  const submit = async (confirmNotDuplicate = false) => {
    if (!ready) return;
    setBusy(true); setError(null);
    const body: NewActivity = {
      title: title.trim(), description: description.trim(), category: category!, tags, isFree: free,
      locale: lang === "fr" ? "fr-CA" : "en-CA", confirmNotDuplicate,
      ...(where === "venue" ? { venueId: venueId! } : { place: { name: placeName.trim(), lat: position.lat, lon: position.lon } }),
    };
    try {
      const r = await api.submit(body);
      setSimilar(null);
      setResult(t(r.status === "published" ? "add.published" : "add.pending"));
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError(0, "network");
      if (e.code === "duplicate") { setSimilar((e.body.similar as Similar[]) ?? []); return; }
      setError(t((KNOWN.has(e.code) ? `error.${e.code}` : "error.generic") as Key));
    } finally { setBusy(false); }
  };

  if (result) {
    return (
      <SafeAreaView style={s.center}>
        <Text style={s.done}>{result}</Text>
        <Pressable style={s.primary} onPress={() => router.back()}><Text style={s.primaryText}>{t("lists.done")}</Text></Pressable>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Text style={s.muted}>{t("add.intro")}</Text>

        <Text style={s.label}>{t("add.title")}</Text>
        <TextInput value={title} onChangeText={setTitle} onBlur={() => void suggest()} maxLength={90} style={s.input} accessibilityLabel={t("add.title")} />
        <Text style={s.label}>{t("add.description")}</Text>
        <TextInput value={description} onChangeText={setDescription} multiline maxLength={1000} style={[s.input, { minHeight: 80 }]} accessibilityLabel={t("add.description")} />

        <Text style={s.label}>{t("add.category")}</Text>
        <View style={s.wrap}>
          {categories.map(([slug, label]) => (
            <Pressable key={slug} onPress={() => setCategory(slug)} style={[s.chip, category === slug && s.chipOn]}
              accessibilityRole="button" accessibilityState={{ selected: category === slug }}>
              <Text style={[s.chipText, category === slug && s.chipTextOn]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={s.row}>
          <Text style={[s.label, { flex: 1 }]}>{t("add.tags")}</Text>
          <Pressable onPress={() => void suggest()}><Text style={s.link}>{t("add.suggest")}</Text></Pressable>
        </View>
        <View style={s.wrap}>
          {tags.map((tag) => (
            <Pressable key={tag} onPress={() => setTags(tags.filter((x) => x !== tag))} style={[s.chip, s.chipOn]} accessibilityRole="button">
              <Text style={[s.chipText, s.chipTextOn]}>{catalog?.tagLabels[tag] ?? tag} ✕</Text>
            </Pressable>
          ))}
        </View>

        <Text style={s.label}>{t("add.where")}</Text>
        <View style={s.wrap}>
          {(["venue", "here"] as const).map((w) => (
            <Pressable key={w} onPress={() => setWhere(w)} style={[s.chip, where === w && s.chipOn]}>
              <Text style={[s.chipText, where === w && s.chipTextOn]}>{t(w === "venue" ? "add.atVenue" : "add.here")}</Text>
            </Pressable>
          ))}
        </View>
        {where === "venue" ? (
          <>
            <TextInput value={venueQuery} onChangeText={(v) => { setVenueQuery(v); setVenueId(null); }} placeholder={t("add.searchVenue")}
              placeholderTextColor={p.ink4} style={s.input} accessibilityLabel={t("add.searchVenue")} />
            {venues.map((v) => (
              <Pressable key={v.id} onPress={() => { setVenueId(v.id); setVenueQuery(v.name); }} style={[s.venue, venueId === v.id && s.venueOn]}>
                <Text style={s.body}>{v.name}</Text>
                {v.neighbourhood ? <Text style={s.muted}>{v.neighbourhood}</Text> : null}
              </Pressable>
            ))}
          </>
        ) : hasPreciseLocation ? (
          <TextInput value={placeName} onChangeText={setPlaceName} placeholder={t("add.placeName")} placeholderTextColor={p.ink4}
            maxLength={90} style={s.input} accessibilityLabel={t("add.placeName")} />
        ) : (
          <Pressable onPress={requestLocation}><Text style={s.link}>{t("add.needLocation")}</Text></Pressable>
        )}
        <Text style={s.tiny}>{t("add.privacy")}</Text>

        <View style={s.row}>
          <Switch value={free} onValueChange={setFree} accessibilityLabel={t("add.free")} />
          <Text style={s.body}>{t("add.free")}</Text>
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}
        {similar ? (
          <View style={s.card}>
            <Text style={s.label}>{t("add.similar")}</Text>
            {similar.map((x) => (
              <Link key={x.id} href={{ pathname: "/activity/[id]", params: { id: x.id } }}>
                <Text style={s.link}>{x.title} — {x.venue}</Text>
              </Link>
            ))}
            <Pressable style={s.secondary} onPress={() => void submit(true)} disabled={busy}><Text style={s.secondaryText}>{t("add.different")}</Text></Pressable>
          </View>
        ) : null}

        <Pressable style={[s.primary, !ready && s.disabled]} disabled={!ready || busy} onPress={() => void submit()}>
          <Text style={s.primaryText}>{t("add.submit")}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.lg, padding: space.xl, backgroundColor: p.bg },
  content: { padding: space.lg, gap: space.sm, paddingBottom: space.xxl },
  label: { ...typography.heading, color: p.ink, marginTop: space.sm },
  body: { ...typography.body, color: p.ink },
  muted: { ...typography.small, color: p.ink3 },
  tiny: { ...typography.small, color: p.ink4 },
  done: { ...typography.heading, color: p.accent, textAlign: "center" },
  error: { ...typography.body, color: p.danger },
  link: { ...typography.body, color: p.accent, textDecorationLine: "underline" },
  input: { borderWidth: 1, borderColor: p.rule, borderRadius: radius.md, padding: space.md, color: p.ink, backgroundColor: p.surface, fontSize: 16 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: space.md },
  chip: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: p.rule, backgroundColor: p.surface },
  chipOn: { backgroundColor: p.accent, borderColor: p.accent },
  chipText: { ...typography.small, color: p.ink2 },
  chipTextOn: { color: p.onAccent, fontWeight: "600" },
  venue: { padding: space.md, borderRadius: radius.md, backgroundColor: p.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule },
  venueOn: { borderColor: p.accent, borderWidth: 2 },
  card: { gap: space.sm, padding: space.md, backgroundColor: p.warmSoft, borderRadius: radius.lg },
  primary: { backgroundColor: p.accent, padding: space.md, borderRadius: radius.pill, alignItems: "center", marginTop: space.md },
  primaryText: { ...typography.heading, color: p.onAccent },
  secondary: { backgroundColor: p.accentSoft, padding: space.md, borderRadius: radius.pill, alignItems: "center" },
  secondaryText: { ...typography.heading, color: p.accent },
  disabled: { opacity: 0.5 },
});
