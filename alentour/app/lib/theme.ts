/** Design tokens. LIGHT ONLY. A soft pastel backdrop sits behind everything and the layers on top
 *  of it are frosted glass: translucent white, a blurred view of what is behind, a bright hairline
 *  edge and a soft shadow. Near-black pills stay for the things that act. */
import { Platform, type ViewStyle } from "react-native";

/** Web gets a real backdrop blur through CSS. Native uses <GlassLayer> (expo-blur) where it matters,
 *  and plain translucency elsewhere. */
const web = (v: Record<string, string>) => (Platform.OS === "web" ? v : {}) as unknown as ViewStyle;

const glassBase = {
  backgroundColor: "rgba(255,255,255,0.52)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.85)",
  ...web({ backdropFilter: "blur(22px) saturate(170%)", WebkitBackdropFilter: "blur(22px) saturate(170%)", boxShadow: "0 8px 32px rgba(50,60,110,0.10)" }),
} as ViewStyle;

const glassStrong = {
  backgroundColor: "rgba(255,255,255,0.72)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.9)",
  ...web({ backdropFilter: "blur(30px) saturate(180%)", WebkitBackdropFilter: "blur(30px) saturate(180%)", boxShadow: "0 12px 40px rgba(50,60,110,0.14)" }),
} as ViewStyle;

/** Translucent without blur — for small items inside scrolling rows, where a blur layer misrenders. */
const glassFlat = {
  backgroundColor: "rgba(255,255,255,0.62)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.9)",
} as ViewStyle;

/** Glass that sits on artwork or photos: lighter, so the picture stays visible through it. */
const glassOnArt = {
  backgroundColor: "rgba(255,255,255,0.30)",
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.55)",
  ...web({ backdropFilter: "blur(16px) saturate(160%)", WebkitBackdropFilter: "blur(16px) saturate(160%)" }),
} as ViewStyle;

const light = {
  /** Solid fallback ground — used by modal sheets. Screens use `canvas` and show the backdrop. */
  bg: "#EEF1F8", canvas: "transparent", surface: "#FFFFFF", surfaceAlt: "rgba(40,50,90,0.07)",
  ink: "#1B1F2A", ink2: "#3A4152", ink3: "#6C7385", ink4: "#9CA2B2",
  rule: "rgba(40,50,90,0.10)", accent: "#1F2433", accentSoft: "rgba(40,50,90,0.08)", onAccent: "#FFFFFF",
  brand: "#1F5F4B", brandSoft: "rgba(31,95,75,0.12)",
  warm: "#8F5E16", warmSoft: "rgba(214,160,60,0.18)", danger: "#B03A2E",
  navActive: "#1F2433", navActiveFg: "#FFFFFF", navFg: "#5B6275",
  glass: glassBase, glassStrong, glassOnArt, glassFlat,
};

export type Palette = typeof light;

/** One palette. The app is light by design; the glass needs a bright backdrop to read. */
export function usePalette(): Palette {
  return light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 14, lg: 22, xl: 30, pill: 999 };
export const typography = {
  display: { fontSize: 30, fontWeight: "600" as const, letterSpacing: -0.8 },
  title: { fontSize: 21, fontWeight: "600" as const, letterSpacing: -0.4 },
  heading: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  small: { fontSize: 13, fontWeight: "400" as const },
  micro: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.6 },
};
