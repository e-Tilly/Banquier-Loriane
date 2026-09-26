/**
 * Setting up to take part: age (birth year + an explicit 18+ attestation), a verified phone,
 * and the opt-in that lets the concierge invite you. Each step says plainly why it exists.
 */
import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, ScrollView, Switch, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useStore } from "../../lib/store.tsx";
import { ApiError } from "../../lib/api.ts";
import { outingsApi, type Eligibility } from "../../lib/outings.ts";
import { usePalette, space, radius, typography, type Palette } from "../../lib/theme.ts";
import type { Key } from "../../lib/i18n.ts";

const KNOWN = new Set(["invalid_phone", "phone_in_use", "invalid_code", "rate_limited", "network"]);

export default function Setup() {
  const p = usePalette();
  const s = styles(p);
  const { t, account } = useStore();
  const [e, setE] = useState<Eligibility | null>(null);
  const [year, setYear] = useState("");
  const [adult, setAdult] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = account ? outingsApi(account.token) : null;

  const load = useCallback(async () => {
    if (!api) return;
    const r = await api.eligibility().catch(() => null);
    if (r) { setE(r); if (r.birthYear) setYear(String(r.birthYear)); setAdult(r.adultAttested); }
  }, [account]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await load(); }
    catch (err) {
      const c = err instanceof ApiError ? err.code : "network";
      setError(t((KNOWN.has(c) ? `error.${c}` : "error.generic") as Key));
    } finally { setBusy(false); }
  };

  if (!api || !e) return <SafeAreaView style={s.screen} />;
  const ageOk = !e.missing.includes("age");
  const phoneOk = !e.missing.includes("phone");
  const y = Number(year);

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <ScrollView contentContainerStyle={s.content}>
        <Text style={s.title}>{t("setup.title")}</Text>
        <Text style={s.muted}>{t("setup.why")}</Text>
        {error ? <Text style={s.error}>{error}</Text> : null}

        <View style={s.card}>
          {ageOk ? <Text style={s.done}>{t("setup.ageDone")}</Text> : (
            <>
              <Text style={s.label}>{t("setup.birthYear")}</Text>
              <TextInput value={year} onChangeText={(v) => setYear(v.replace(/\D/g, "").slice(0, 4))} keyboardType="number-pad"
                style={s.input} placeholder="1999" placeholderTextColor={p.ink4} accessibilityLabel={t("setup.birthYear")} />
              <View style={s.switchRow}>
                <Switch value={adult} onValueChange={setAdult} accessibilityLabel={t("setup.adult")} />
                <Text style={s.body}>{t("setup.adult")}</Text>
              </View>
              <Pressable style={[s.primary, (!adult || year.length !== 4) && s.disabled]} disabled={busy || !adult || year.length !== 4}
                onPress={() => void run(() => api.profile({ birthYear: y, adultAttested: true }))}>
                <Text style={s.primaryText}>{t("setup.saveAge")}</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={s.card}>
          {phoneOk ? <Text style={s.done}>{t("setup.phoneDone", { phone: e.phone ?? "" })}</Text> : (
            <>
              <Text style={s.label}>{t("setup.phone")}</Text>
              <Text style={s.muted}>{t("setup.phoneWhy")}</Text>
              <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" textContentType="telephoneNumber" autoComplete="tel"
                style={s.input} placeholder="514 555 0123" placeholderTextColor={p.ink4} accessibilityLabel={t("setup.phone")} />
              <Pressable style={s.secondary} disabled={busy || phone.replace(/\D/g, "").length < 10}
                onPress={() => void run(async () => { await api.phoneStart(phone); setCodeSent(true); })}>
                <Text style={s.secondaryText}>{t("setup.sendCode")}</Text>
              </Pressable>
              {codeSent ? (
                <>
                  <Text style={s.label}>{t("setup.code")}</Text>
                  <TextInput value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))} keyboardType="number-pad"
                    textContentType="oneTimeCode" style={s.input} placeholder="••••••" placeholderTextColor={p.ink4} accessibilityLabel={t("setup.code")} />
                  <Pressable style={s.primary} disabled={busy || code.length !== 6} onPress={() => void run(() => api.phoneVerify(code))}>
                    <Text style={s.primaryText}>{t("setup.verify")}</Text>
                  </Pressable>
                </>
              ) : null}
            </>
          )}
        </View>

        <View style={s.card}>
          <View style={s.switchRow}>
            <Switch value={e.optIn} onValueChange={(v) => void run(() => api.profile({ outingsOptIn: v }))} accessibilityLabel={t("setup.optIn")} />
            <Text style={[s.body, { flex: 1 }]}>{t("setup.optIn")}</Text>
          </View>
          <Text style={s.muted}>{t("setup.optInHint")}</Text>
        </View>

        {e.ok ? <Text style={s.done}>{t("setup.done")}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  content: { padding: space.lg, gap: space.lg, paddingBottom: space.xxl },
  title: { ...typography.title, color: p.ink },
  body: { ...typography.body, color: p.ink },
  muted: { ...typography.small, color: p.ink3 },
  label: { ...typography.heading, color: p.ink },
  error: { ...typography.body, color: p.danger },
  done: { ...typography.heading, color: p.accent },
  card: { gap: space.sm, padding: space.md, backgroundColor: p.surface, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule },
  input: { borderWidth: 1, borderColor: p.rule, borderRadius: radius.md, padding: space.md, color: p.ink, backgroundColor: p.bg, fontSize: 17 },
  switchRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  primary: { backgroundColor: p.accent, padding: space.md, borderRadius: radius.pill, alignItems: "center" },
  primaryText: { ...typography.heading, color: p.onAccent },
  secondary: { backgroundColor: p.accentSoft, padding: space.md, borderRadius: radius.pill, alignItems: "center" },
  secondaryText: { ...typography.heading, color: p.accent },
  disabled: { opacity: 0.5 },
});
