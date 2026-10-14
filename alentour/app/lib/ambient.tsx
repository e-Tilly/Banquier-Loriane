/**
 * The ambient colour: what the backdrop leans toward. Screens report the categories of the
 * activities in view (a snapped hero card, the rows on screen); the backdrop blends toward their
 * colours slowly, so it feels like it takes light from the pictures without ever fighting the text.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ambientFor } from "./palettes.ts";

interface Ambient { colors: string[]; set: (categories: string[]) => void }
const Ctx = createContext<Ambient>({ colors: [], set: () => {} });

export function AmbientProvider({ children }: { children: React.ReactNode }) {
  const [colors, setColors] = useState<string[]>([]);
  const set = useCallback((categories: string[]) => {
    const next = ambientFor(categories);
    setColors((cur) => (cur.join() === next.join() ? cur : next));
  }, []);
  const value = useMemo(() => ({ colors, set }), [colors, set]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useAmbient = () => useContext(Ctx);

/**
 * For a FlatList of activities: reports the categories of the rows on screen to the backdrop.
 * Spread the result onto the list. (React Native needs these two props to stay the same object.)
 */
export function useViewableAmbient<T>(categoryOf: (item: T) => string | undefined) {
  const { set } = useAmbient();
  const latest = useRef({ set, categoryOf });
  latest.current = { set, categoryOf };
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { item: T }[] }) => {
    const cats = viewableItems.map((v) => latest.current.categoryOf(v.item)).filter((c): c is string => !!c);
    if (cats.length) latest.current.set(cats);
  }).current;
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50 }).current;
  return { onViewableItemsChanged, viewabilityConfig };
}

/** Set the backdrop for as long as a screen shows these categories. */
export function useAmbientCategories(categories: (string | undefined)[]) {
  const { set } = useAmbient();
  const key = categories.join("|");
  useEffect(() => { const c = categories.filter((x): x is string => !!x); if (c.length) set(c); }, [key, set]);
}
