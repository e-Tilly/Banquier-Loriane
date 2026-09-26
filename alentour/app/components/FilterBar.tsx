import React from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import type { Filters } from "@core/catalog/filter.ts";
import { usePalette, space, radius, typography, type Palette } from "../lib/theme.ts";
import { translate, type Lang } from "../lib/i18n.ts";

interface Props {
  filters: Filters;
  onChange: (f: Filters) => void;
  onOpenSheet: () => void;
  lang: Lang;
}

const DISTANCE_STEPS: (number | undefined)[] = [1, 5, 10, 25, undefined];

/**
 * Four chips, maximum. Everything else lives behind the sheet — a deep taxonomy dies of its
 * own UI otherwise (docs/alentour/03-taxonomy.md).
 */
export function FilterBar({ filters, onChange, onOpenSheet, lang }: Props) {
  const p = usePalette();
  const s = styles(p);
  const tr = (k: Parameters<typeof translate>[0]) => translate(k, lang);

  const activeCount =
    (filters.tags?.length ?? 0) + (filters.categories?.length ?? 0) +
    (filters.requireA11y?.length ?? 0) +
    (filters.maxDurationMinutes !== undefined ? 1 : 0) +
    (filters.maxPhysical !== undefined ? 1 : 0);

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  return (
    // Wrapped in a plain View: a horizontal ScrollView inside a flex column gets squeezed to
    // zero height and clips its own chips. The wrapper fixes the row height explicitly.
    <View style={s.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.row} style={s.scroll}>
        <Chip
          p={p}
          label={filters.maxDistanceKm ? `${filters.maxDistanceKm} km` : tr("chip.distance")}
          active={filters.maxDistanceKm !== undefined && filters.maxDistanceKm !== 10}
          onPress={() => {
            const i = DISTANCE_STEPS.indexOf(filters.maxDistanceKm);
            set({ maxDistanceKm: DISTANCE_STEPS[(i + 1) % DISTANCE_STEPS.length] });
          }}
        />
        <Chip p={p} label={tr("chip.free")} active={!!filters.freeOnly}
          onPress={() => set({ freeOnly: filters.freeOnly ? undefined : true })} />
        <Chip p={p} label={tr("chip.openNow")} active={!!filters.openNow}
          onPress={() => set({ openNow: filters.openNow ? undefined : true })} />
        <Chip p={p} label={activeCount > 0 ? `${tr("chip.filters")} (${activeCount})` : tr("chip.filters")}
          active={activeCount > 0} onPress={onOpenSheet} />
      </ScrollView>
    </View>
  );
}

function Chip({ p, label, active, onPress }: { p: Palette; label: string; active: boolean; onPress: () => void }) {
  const s = styles(p);
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipActive]}
      accessibilityRole="button" accessibilityState={{ selected: active }}>
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = (p: Palette) => StyleSheet.create({
  wrap: { height: 52, flexGrow: 0, flexShrink: 0 },
  scroll: { flexGrow: 0, flexShrink: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.lg },
  chip: {
    paddingHorizontal: space.md, paddingVertical: 7, borderRadius: radius.pill,
    backgroundColor: p.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: p.rule,
  },
  chipActive: { backgroundColor: p.accent, borderColor: p.accent },
  chipText: { ...typography.small, color: p.ink2, fontWeight: "500" },
  chipTextActive: { color: p.onAccent, fontWeight: "600" },
});
