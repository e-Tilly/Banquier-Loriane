import React from "react";
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { Filters } from "@core/catalog/filter.ts";
import type { CatalogFile, CatalogActivity } from "@core/catalog/types.ts";
import { applyFilters } from "@core/catalog/filter.ts";
import type { RankContext } from "@core/catalog/filter.ts";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import type { Lang } from "../lib/format.ts";

interface Props {
  visible: boolean;
  onClose: () => void;
  catalog: CatalogFile;
  filters: Filters;
  onChange: (f: Filters) => void;
  ctx: RankContext;
  lang: Lang;
}

const A11Y_SLUGS = [
  "a11y.step_free_entry", "a11y.wheelchair_throughout", "a11y.accessible_washroom",
  "a11y.seating_available", "a11y.low_sensory", "a11y.service_animals",
];

export function FilterSheet({ visible, onClose, catalog, filters, onChange, ctx, lang }: Props) {
  const p = usePalette();
  const s = styles(p);

  // Live counts on every option: never let someone tap into an empty state.
  const countWith = (patch: Partial<Filters>): number =>
    applyFilters(catalog.activities, { ...filters, ...patch }, ctx).matches.length;

  const vibeTags = Object.keys(catalog.tagFacets).filter((k) => catalog.tagFacets[k] === "vibe");
  const categories = Object.keys(catalog.tagFacets).filter((k) => catalog.tagFacets[k] === "category");

  const toggleIn = (list: string[] | undefined, slug: string): string[] | undefined => {
    const next = new Set(list ?? []);
    next.has(slug) ? next.delete(slug) : next.add(slug);
    return next.size ? [...next] : undefined;
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={s.sheet} edges={["top", "bottom"]}>
        <View style={s.header}>
          <Text style={s.headerTitle}>{lang === "fr" ? "Filtres" : "Filters"}</Text>
          <Pressable onPress={() => onChange({ maxDistanceKm: 10 })} hitSlop={8}>
            <Text style={s.reset}>{lang === "fr" ? "Réinitialiser" : "Reset"}</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={s.content}>
          <Section p={p} title={lang === "fr" ? "Envie de quoi ?" : "In the mood for"}>
            <View style={s.wrap}>
              {vibeTags.map((slug) => (
                <Option
                  key={slug} p={p}
                  label={catalog.tagLabels[slug] ?? slug}
                  count={countWith({ tags: toggleIn(filters.tags, slug) })}
                  active={filters.tags?.includes(slug) ?? false}
                  onPress={() => onChange({ ...filters, tags: toggleIn(filters.tags, slug) })}
                />
              ))}
            </View>
          </Section>

          <Section p={p} title={lang === "fr" ? "Catégorie" : "Category"}>
            <View style={s.wrap}>
              {categories.map((slug) => (
                <Option
                  key={slug} p={p}
                  label={catalog.tagLabels[slug] ?? slug}
                  count={countWith({ categories: toggleIn(filters.categories, slug) })}
                  active={filters.categories?.includes(slug) ?? false}
                  onPress={() => onChange({ ...filters, categories: toggleIn(filters.categories, slug) })}
                />
              ))}
            </View>
          </Section>

          <Section p={p} title={lang === "fr" ? "Durée maximale" : "Max duration"}>
            <View style={s.wrap}>
              {[60, 120, 240, undefined].map((m) => (
                <Option
                  key={String(m)} p={p}
                  label={m === undefined ? (lang === "fr" ? "Peu importe" : "Any")
                       : m < 120 ? `< 1 h` : m < 240 ? `< 2 h` : (lang === "fr" ? "Demi-journée" : "Half day")}
                  count={countWith({ maxDurationMinutes: m })}
                  active={filters.maxDurationMinutes === m}
                  onPress={() => onChange({ ...filters, maxDurationMinutes: m })}
                />
              ))}
            </View>
          </Section>

          <Section p={p} title={lang === "fr" ? "Effort physique" : "Physical effort"}>
            <View style={s.wrap}>
              {[0, 1, 2, undefined].map((v) => (
                <Option
                  key={String(v)} p={p}
                  label={v === undefined ? (lang === "fr" ? "Peu importe" : "Any")
                       : v === 0 ? (lang === "fr" ? "Aucun" : "None")
                       : v === 1 ? (lang === "fr" ? "Léger" : "Light")
                       : (lang === "fr" ? "Modéré" : "Moderate")}
                  count={countWith({ maxPhysical: v })}
                  active={filters.maxPhysical === v}
                  onPress={() => onChange({ ...filters, maxPhysical: v })}
                />
              ))}
            </View>
          </Section>

          <Section
            p={p}
            title={lang === "fr" ? "Accessibilité" : "Accessibility"}
            note={lang === "fr"
              ? "Les lieux non vérifiés apparaissent séparément plutôt que d'être cachés."
              : "Unverified places are shown separately rather than hidden."}
          >
            <View style={s.wrap}>
              {A11Y_SLUGS.filter((slug) => catalog.tagLabels[slug]).map((slug) => (
                <Option
                  key={slug} p={p}
                  label={catalog.tagLabels[slug] ?? slug}
                  count={countWith({ requireA11y: toggleIn(filters.requireA11y, slug) })}
                  active={filters.requireA11y?.includes(slug) ?? false}
                  onPress={() => onChange({ ...filters, requireA11y: toggleIn(filters.requireA11y, slug) })}
                />
              ))}
            </View>
          </Section>
        </ScrollView>

        <View style={s.footer}>
          <Pressable style={s.cta} onPress={onClose} accessibilityRole="button">
            <Text style={s.ctaText}>
              {lang === "fr" ? "Voir" : "Show"} {countWith({})} {lang === "fr" ? "résultats" : "results"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Section({ p, title, note, children }: {
  p: Palette; title: string; note?: string; children: React.ReactNode;
}) {
  const s = styles(p);
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {note ? <Text style={s.sectionNote}>{note}</Text> : null}
      {children}
    </View>
  );
}

function Option({ p, label, count, active, onPress }: {
  p: Palette; label: string; count: number; active: boolean; onPress: () => void;
}) {
  const s = styles(p);
  const empty = count === 0 && !active;
  return (
    <Pressable
      onPress={onPress}
      disabled={empty}
      style={[s.option, active && s.optionActive, empty && s.optionEmpty]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active, disabled: empty }}
      accessibilityLabel={`${label}, ${count} résultats`}
    >
      <Text style={[s.optionText, active && s.optionTextActive, empty && s.optionTextEmpty]}>
        {label}
      </Text>
      <Text style={[s.optionCount, active && s.optionTextActive]}>{count}</Text>
    </Pressable>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  sheet: { flex: 1, backgroundColor: p.bg },
  header: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center",
    paddingHorizontal: space.lg, paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.rule,
  },
  headerTitle: { ...typography.title, color: p.ink },
  reset: { ...typography.small, color: p.accent, fontWeight: "600" },
  content: { padding: space.lg, gap: space.xl, paddingBottom: space.xxl },
  section: { gap: space.sm },
  sectionTitle: { ...typography.heading, color: p.ink },
  sectionNote: { ...typography.small, color: p.ink3, marginTop: -2 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  option: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: space.md, paddingVertical: 8, borderRadius: radius.pill,
    backgroundColor: p.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
    minHeight: 40,
  },
  optionActive: { backgroundColor: p.accent, borderColor: p.accent },
  optionEmpty: { opacity: 0.4 },
  optionText: { ...typography.small, color: p.ink2 },
  optionTextActive: { color: p.onAccent, fontWeight: "600" },
  optionTextEmpty: { color: p.ink4 },
  optionCount: { ...typography.micro, color: p.ink4 },
  footer: {
    padding: space.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: p.rule,
    backgroundColor: p.surface,
  },
  cta: {
    backgroundColor: p.accent, borderRadius: radius.md,
    paddingVertical: 14, alignItems: "center", minHeight: 48, justifyContent: "center",
  },
  ctaText: { ...typography.heading, color: p.onAccent },
});
