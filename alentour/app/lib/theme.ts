/** Design tokens. Montréal, 18-30, outdoors-adjacent: a pine accent on green-biased
 *  neutrals, with warm signal colours reserved for price and effort. */
import { useColorScheme } from "react-native";

const light = {
  bg: "#F4F6F3", surface: "#FFFFFF", surfaceAlt: "#EAEEE9",
  ink: "#151A18", ink2: "#3C443F", ink3: "#6B746F", ink4: "#98A09B",
  rule: "#DCE2DD", accent: "#1F5F4B", accentSoft: "#E2EEE8", onAccent: "#FFFFFF",
  warm: "#8F5E16", warmSoft: "#F5EDDD", danger: "#93372A",
};

const dark: typeof light = {
  bg: "#121614", surface: "#1A201D", surfaceAlt: "#222926",
  ink: "#E9EDEA", ink2: "#C2CAC5", ink3: "#8E9791", ink4: "#6D766F",
  rule: "#2D3532", accent: "#79C3A6", accentSoft: "#17302A", onAccent: "#0E1513",
  warm: "#D7A45C", warmSoft: "#2E2517", danger: "#D98B7A",
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 };
export const typography = {
  display: { fontSize: 28, fontWeight: "700" as const, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: "700" as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: "600" as const },
  body: { fontSize: 15, fontWeight: "400" as const },
  small: { fontSize: 13, fontWeight: "400" as const },
  micro: { fontSize: 11, fontWeight: "600" as const, letterSpacing: 0.6 },
};
