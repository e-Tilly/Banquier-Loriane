/** Passwordless sign-in: email → 6-digit code. */
import React, { useState } from "react";
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import type { Key } from "../lib/i18n.ts";

const KNOWN_ERRORS = new Set(["invalid_email", "invalid_code", "expired", "too_many_attempts", "rate_limited", "network"]);

export default function SignIn() {
  const p = usePalette();
  const s = styles(p);
  const router = useRouter();
  const { t, startSignIn, verifySignIn } = useStore();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Key | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); }
    catch (err) {
      const c = (err as { code?: string }).code ?? "";
      setError((KNOWN_ERRORS.has(c) ? `error.${c}` : "error.generic") as Key);
    } finally { setBusy(false); }
  };

  const send = () => run(async () => { await startSignIn(email.trim()); setStep("code"); setCode(""); });
  const verify = () => run(async () => { await verifySignIn(email.trim(), code); router.back(); });

  return (
    <SafeAreaView style={s.screen} edges={["bottom"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={s.body}>
        <Text style={s.pitch}>{t("account.pitch")}</Text>

        {step === "email" ? (
          <>
            <Text style={s.label}>{t("signin.emailLabel")}</Text>
            <TextInput
              value={email} onChangeText={setEmail} onSubmitEditing={send}
              autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="emailAddress"
              autoFocus style={s.input} placeholder="toi@exemple.com" placeholderTextColor={p.ink4}
              accessibilityLabel={t("signin.emailLabel")}
            />
            <Primary p={p} label={t("signin.sendCode")} onPress={send} disabled={busy || !email.includes("@")} busy={busy} />
          </>
        ) : (
          <>
            <Text style={s.label}>{t("signin.codeSent", { email: email.trim() })}</Text>
            <TextInput
              value={code} onChangeText={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
              onSubmitEditing={verify} keyboardType="number-pad" textContentType="oneTimeCode" autoComplete="one-time-code"
              autoFocus maxLength={6} style={[s.input, s.codeInput]} placeholder="••••••" placeholderTextColor={p.ink4}
              accessibilityLabel={t("signin.codeLabel")}
            />
            <Primary p={p} label={t("signin.verify")} onPress={verify} disabled={busy || code.length !== 6} busy={busy} />
            <View style={s.secondaryRow}>
              <Pressable onPress={send} disabled={busy} hitSlop={8} accessibilityRole="button">
                <Text style={s.secondary}>{t("signin.resend")}</Text>
              </Pressable>
              <Pressable onPress={() => { setStep("email"); setError(null); }} hitSlop={8} accessibilityRole="button">
                <Text style={s.secondary}>{t("signin.changeEmail")}</Text>
              </Pressable>
            </View>
          </>
        )}

        {error ? <Text style={s.error} accessibilityRole="alert">{t(error)}</Text> : null}
        <Text style={s.privacy}>{t("signin.privacy")}</Text>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Primary({ p, label, onPress, disabled, busy }: { p: Palette; label: string; onPress: () => void; disabled: boolean; busy: boolean }) {
  const s = styles(p);
  return (
    <Pressable style={[s.primary, disabled && s.disabled]} onPress={onPress} disabled={disabled} accessibilityRole="button">
      {busy ? <ActivityIndicator color={p.onAccent} /> : <Text style={s.primaryText}>{label}</Text>}
    </Pressable>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: p.bg },
  body: { flex: 1, padding: space.lg, gap: space.md },
  pitch: { ...typography.title, color: p.ink, marginBottom: space.sm },
  label: { ...typography.small, color: p.ink2 },
  input: {
    backgroundColor: p.surface, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 48,
    ...typography.body, color: p.ink, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  codeInput: { fontSize: 24, letterSpacing: 8, textAlign: "center" },
  primary: { backgroundColor: p.accent, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.45 },
  primaryText: { ...typography.heading, color: p.onAccent },
  secondaryRow: { flexDirection: "row", justifyContent: "space-between" },
  secondary: { ...typography.small, color: p.accent, fontWeight: "600" },
  error: { ...typography.small, color: p.danger, fontWeight: "600" },
  privacy: { ...typography.small, color: p.ink3, marginTop: "auto" },
});
