/**
 * A horizontal row that snaps to the start of each item, like pages on a grid. Item positions are
 * measured, so it works for equal cards and for chips of different widths. Native uses
 * snapToOffsets; web uses CSS scroll-snap on the same items.
 */
import React, { useCallback, useRef, useState } from "react";
import { Platform, ScrollView, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent, type StyleProp, type ViewStyle } from "react-native";

interface Props {
  children: React.ReactNode;
  gap: number;
  /** Space before the first and after the last item. */
  inset: number;
  /** Called with the index of the item nearest the left edge while scrolling. */
  onIndexChange?: (index: number) => void;
  style?: StyleProp<ViewStyle>;
}

export function SnapRow({ children, gap, inset, onIndexChange, style }: Props) {
  const items = React.Children.toArray(children);
  const xs = useRef<number[]>([]);
  const [offsets, setOffsets] = useState<number[]>([]);
  const last = useRef(-1);

  const onItemLayout = useCallback((i: number) => (e: LayoutChangeEvent) => {
    xs.current[i] = e.nativeEvent.layout.x - inset;
    if (xs.current.filter((v) => v !== undefined).length === items.length) setOffsets([...xs.current]);
  }, [inset, items.length]);

  const onScroll = onIndexChange ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    let best = 0;
    for (let i = 0; i < xs.current.length; i++) if (Math.abs((xs.current[i] ?? 0) - x) < Math.abs((xs.current[best] ?? 0) - x)) best = i;
    if (best !== last.current) { last.current = best; onIndexChange(best); }
  } : undefined;

  const web = Platform.OS === "web";
  return (
    <ScrollView
      horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast"
      snapToOffsets={offsets.length ? offsets : undefined} snapToAlignment="start"
      onScroll={onScroll} scrollEventThrottle={16}
      style={[web ? ({ scrollSnapType: "x mandatory", scrollPaddingLeft: inset } as object) : null, style]}
      contentContainerStyle={{ paddingHorizontal: inset, gap }}
    >
      {items.map((child, i) => (
        <View key={(child as React.ReactElement).key ?? i} onLayout={onItemLayout(i)}
          style={web ? ({ scrollSnapAlign: "start" } as object) : undefined}>
          {child}
        </View>
      ))}
    </ScrollView>
  );
}
