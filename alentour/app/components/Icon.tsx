/** Line icons (24×24, 1.75 stroke, round caps) drawn with react-native-svg, so they are crisp and
 *  identical on iOS, Android and web — no icon font to load. */
import React from "react";
import Svg, { Path, Circle, Polygon } from "react-native-svg";

export type IconName =
  | "home" | "search" | "sliders" | "map" | "heart" | "heart-fill" | "users" | "plus" | "user"
  | "arrow-right" | "arrow-left" | "chevron-down" | "chevron-up" | "star" | "pin" | "share"
  | "compass" | "check" | "x" | "clock" | "flag";

export function Icon({ name, size = 22, color = "#000", strokeWidth = 1.75 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const common = { stroke: color, strokeWidth, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {draw(name, common, color)}
    </Svg>
  );
}

function draw(name: IconName, c: Record<string, unknown>, color: string) {
  switch (name) {
    case "home": return <Path {...c} d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />;
    case "search": return <><Circle {...c} cx="11" cy="11" r="7" /><Path {...c} d="m21 21-4.3-4.3" /></>;
    case "sliders": return <><Path {...c} d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><Circle {...c} cx="15" cy="6" r="2" /><Circle {...c} cx="9" cy="12" r="2" /><Circle {...c} cx="17" cy="18" r="2" /></>;
    case "map": return <><Path {...c} d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z" /><Path {...c} d="M9 4v14M15 6v14" /></>;
    case "heart": return <Path {...c} d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />;
    case "heart-fill": return <Path stroke={color} strokeWidth={1.75} strokeLinejoin="round" fill={color} d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />;
    case "users": return <><Path {...c} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><Circle {...c} cx="9" cy="7" r="4" /><Path {...c} d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" /></>;
    case "plus": return <Path {...c} d="M12 5v14M5 12h14" />;
    case "user": return <><Path {...c} d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" /><Circle {...c} cx="12" cy="7" r="4" /></>;
    case "arrow-right": return <Path {...c} d="M5 12h14M12 5l7 7-7 7" />;
    case "arrow-left": return <Path {...c} d="M19 12H5M12 19l-7-7 7-7" />;
    case "chevron-down": return <Path {...c} d="m6 9 6 6 6-6" />;
    case "chevron-up": return <Path {...c} d="m18 15-6-6-6 6" />;
    case "star": return <Path {...c} d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.9-6.2-3.3-6.2 3.3L7 14.2 2 9.3l6.9-1z" />;
    case "pin": return <><Path {...c} d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z" /><Circle {...c} cx="12" cy="10" r="3" /></>;
    case "share": return <Path {...c} d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13" />;
    case "compass": return <><Circle {...c} cx="12" cy="12" r="10" /><Polygon {...c} points="16.2 7.8 14.1 14.1 7.8 16.2 9.9 9.9 16.2 7.8" /></>;
    case "check": return <Path {...c} d="M20 6 9 17l-5-5" />;
    case "x": return <Path {...c} d="M18 6 6 18M6 6l12 12" />;
    case "clock": return <><Circle {...c} cx="12" cy="12" r="10" /><Path {...c} d="M12 6v6l4 2" /></>;
    case "flag": return <Path {...c} d="M4 22V4M4 4h13l-2 4 2 4H4" />;
  }
}
