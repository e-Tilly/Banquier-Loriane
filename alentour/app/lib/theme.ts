/** Design tokens. Soft grey ground, white cards with large radii, and ONE strong move: near-black
 *  pills for everything that acts (primary buttons, the active chip, the floating nav). Colour comes
 *  from the content's own artwork or photo, not from the chrome. */
import { useColorScheme } from "react-native";

const light = {
  bg: "#F5F5F4", surface: "#FFFFFF", surfaceAlt: "#ECEDEC",
  ink: "#1B1F22", ink2: "#3A4146", ink3: "#70777C", ink4: "#A3A9AD",
  rule: "#E4E6E6", accent: "#1F2326", accentSoft: "#ECEDED", onAccent: "#FFFFFF",
  brand: "#1F5F4B", brandSoft: "#E3EFE9",
  warm: "#8F5E16", warmSoft: "#F5EDDD", danger: "#B03A2E",
  navBg: "#1F2326", navFg: "#9AA1A5", navActiveBg: "#FFFFFF", navActiveFg: "#1F2326",
};

const dark: typeof light = {
  bg: "#0F1112", surface: "#1A1D1F", surfaceAlt: "#25292B",
  ink: "#F0F2F2", ink2: "#CBD0D2", ink3: "#8D9599", ink4: "#656C70",
  rule: "#2B3033", accent: "#F0F2F2", accentSoft: "#25292B", onAccent: "#111314",
  brand: "#79C3A6", brandSoft: "#17302A",
  warm: "#D7A45C", warmSoft: "#2E2517", danger: "#E0948A",
  navBg: "#26292B", navFg: "#8D9599", navActiveBg: "#F0F2F2", navActiveFg: "#111314",
};

export type Palette = typeof light;

export function usePalette(): Palette {
  return useColorScheme() === "dark" ? dark : light;
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
