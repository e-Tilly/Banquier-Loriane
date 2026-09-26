/** "Add to a list" — toggle membership in existing lists, or create one inline. */
import React, { useState } from "react";
import { View, Text, Pressable, TextInput, Modal, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { visibleLists } from "@core/user/library.ts";
import { useStore } from "../lib/store.tsx";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";

export function ListSheet({ activityId, visible, onClose }: {
  activityId: string; visible: boolean; onClose: () => void;
}) {
  const p = usePalette();
  const s = styles(p);
  const { library, toggleInList, createList, t } = useStore();
  const [name, setName] = useState("");
  const lists = visibleLists(library);

  const create = () => {
    if (!name.trim()) return;
    const id = createList(name);
    toggleInList(id, activityId);
    setName("");
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.sheet} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Text style={s.title}>{t("detail.addToList")}</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
            <Text style={s.done}>{t("lists.done")}</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={s.body}>
          {lists.map((l) => {
            const inList = l.items.includes(activityId);
            return (
              <Pressable key={l.id} style={s.row} onPress={() => toggleInList(l.id, activityId)}
                accessibilityRole="checkbox" accessibilityState={{ checked: inList }}>
                <View style={[s.check, inList && s.checkOn]}>
                  {inList ? <Text style={s.checkMark}>✓</Text> : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowTitle}>{l.name}</Text>
                  <Text style={s.rowMeta}>{t("lists.count", { n: l.items.length })}</Text>
                </View>
              </Pressable>
            );
          })}
          <View style={s.newRow}>
            <TextInput
              value={name} onChangeText={setName} onSubmitEditing={create}
              placeholder={t("lists.namePlaceholder")} placeholderTextColor={p.ink4}
              style={s.input} returnKeyType="done" maxLength={60}
              accessibilityLabel={t("lists.new")}
            />
            <Pressable style={[s.createBtn, !name.trim() && s.createDisabled]} onPress={create}
              disabled={!name.trim()} accessibilityRole="button">
              <Text style={s.createText}>{t("lists.create")}</Text>
            </Pressable>
          </View>
        </ScrollView>
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
  done: { ...typography.heading, color: p.accent },
  body: { padding: space.lg, gap: space.sm },
  row: {
    flexDirection: "row", alignItems: "center", gap: space.md, padding: space.md,
    backgroundColor: p.surface, borderRadius: radius.md, minHeight: 56,
    borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  check: {
    width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: p.ink4,
    alignItems: "center", justifyContent: "center",
  },
  checkOn: { backgroundColor: p.accent, borderColor: p.accent },
  checkMark: { color: p.onAccent, fontWeight: "700" },
  rowTitle: { ...typography.heading, color: p.ink },
  rowMeta: { ...typography.small, color: p.ink3 },
  newRow: { flexDirection: "row", gap: space.sm, marginTop: space.md },
  input: {
    flex: 1, backgroundColor: p.surface, borderRadius: radius.md, paddingHorizontal: space.md,
    minHeight: 44, ...typography.body, color: p.ink, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  createBtn: { backgroundColor: p.accent, borderRadius: radius.md, paddingHorizontal: space.lg, justifyContent: "center" },
  createDisabled: { opacity: 0.4 },
  createText: { ...typography.heading, color: p.onAccent },
});
