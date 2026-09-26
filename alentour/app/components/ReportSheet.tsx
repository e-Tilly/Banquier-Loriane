/**
 * "Report a problem". In Stage 1 this is the entire moderation system, and it works: a wrong
 * hour or a closed venue is caught by the people standing in front of it.
 */
import React, { useState } from "react";
import { View, Text, Pressable, TextInput, Modal, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useStore, type ReportReason } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import type { Key } from "../lib/i18n.ts";

const REASONS: { reason: ReportReason; key: Key }[] = [
  { reason: "closed", key: "report.closed" },
  { reason: "hours", key: "report.hours" },
  { reason: "price", key: "report.price" },
  { reason: "a11y", key: "report.a11y" },
  { reason: "missing", key: "report.missing" },
  { reason: "dangerous", key: "report.dangerous" },
  { reason: "other", key: "report.other" },
];

export function ReportSheet({ activityId, visible, onClose }: {
  activityId: string; visible: boolean; onClose: () => void;
}) {
  const p = usePalette();
  const s = styles(p);
  const { report, t } = useStore();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  const send = async () => {
    if (!reason) return;
    setState("sending");
    try {
      await report(activityId, reason, details.trim());
      setState("sent");
      setTimeout(() => { onClose(); setState("idle"); setReason(null); setDetails(""); }, 1200);
    } catch {
      setState("error");
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.sheet} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Text style={s.title}>{t("report.title")}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={s.cancel}>{t("report.cancel")}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body}>
          {REASONS.map((r) => (
            <Pressable key={r.reason} style={[s.option, reason === r.reason && s.optionOn]}
              onPress={() => setReason(r.reason)} accessibilityRole="radio"
              accessibilityState={{ selected: reason === r.reason }}>
              <Text style={[s.optionText, reason === r.reason && s.optionTextOn]}>{t(r.key)}</Text>
            </Pressable>
          ))}
          <TextInput
            value={details} onChangeText={setDetails} multiline maxLength={1000}
            placeholder={t("report.details")} placeholderTextColor={p.ink4}
            style={s.input} accessibilityLabel={t("report.details")}
          />
        </ScrollView>
        <View style={s.footer}>
          {state === "sent" ? (
            <Text style={s.thanks}>{t("report.thanks")}</Text>
          ) : (
            <Pressable style={[s.send, (!reason || state === "sending") && s.sendDisabled]}
              onPress={send} disabled={!reason || state === "sending"} accessibilityRole="button">
              <Text style={s.sendText}>{t("report.send")}</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  sheet: { flex: 1, backgroundColor: p.bg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.rule,
  },
  title: { ...typography.title, color: p.ink },
  cancel: { ...typography.heading, color: p.ink3 },
  body: { padding: space.lg, gap: space.sm },
  option: {
    padding: space.md, borderRadius: radius.md, backgroundColor: p.surface, minHeight: 48,
    justifyContent: "center", borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  optionOn: { borderColor: p.accent, backgroundColor: p.accentSoft },
  optionText: { ...typography.body, color: p.ink2 },
  optionTextOn: { color: p.accent, fontWeight: "600" },
  input: {
    marginTop: space.sm, minHeight: 96, textAlignVertical: "top", padding: space.md,
    backgroundColor: p.surface, borderRadius: radius.md, ...typography.body, color: p.ink,
    borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  footer: { padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.rule, backgroundColor: p.surface },
  send: { backgroundColor: p.accent, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center" },
  sendDisabled: { opacity: 0.4 },
  sendText: { ...typography.heading, color: p.onAccent },
  thanks: { ...typography.heading, color: p.accent, textAlign: "center", paddingVertical: space.md },
});
