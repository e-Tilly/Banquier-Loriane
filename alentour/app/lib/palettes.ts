/** Category colours: [deep, mid, light]. Used by the generated artwork and by the ambient backdrop. */
export const PALETTES: Record<string, [string, string, string]> = {
  "category.outdoors": ["#2F6B4F", "#8DBE8A", "#E9D58B"],
  "category.water": ["#1C5D8C", "#4FA3C7", "#BDE3EA"],
  "category.winter": ["#3B4F8F", "#8DA7D9", "#E3ECF8"],
  "category.sports": ["#C4512F", "#EE8F4C", "#F6D08A"],
  "category.thrill": ["#B02A3E", "#E2634F", "#5A2A6B"],
  "category.arts": ["#6B3F8F", "#C77DB0", "#F3C9B8"],
  "category.learning": ["#B7791F", "#E6B655", "#F6E3B0"],
  "category.games": ["#1F7A78", "#5FB6A6", "#7A5FB6"],
  "category.food": ["#B8501F", "#E88F3E", "#F5D27A"],
  "category.nightlife": ["#35317F", "#8B4FA8", "#E266A0"],
  "category.wellness": ["#2C7A74", "#7CC2B3", "#DDEFE3"],
  "category.family": ["#C27A2C", "#EFB868", "#F7E2B5"],
  "category.animals": ["#7A5230", "#C49A62", "#E8D5AE"],
  "category.community": ["#3F6E8F", "#82B0C9", "#E1ECA9"],
  "category.markets": ["#A23B52", "#E4807A", "#F4D3A0"],
  "category.seasonal": ["#6A8F2F", "#C4C94F", "#F3E4A0"],
};
export const FALLBACK: [string, string, string] = ["#4A5A63", "#8FA3AD", "#DDE5E8"];

export const paletteFor = (category: string): [string, string, string] => PALETTES[category] ?? FALLBACK;

export function mix(a: string, b: string, t: number): string {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = n(a), [r2, g2, b2] = n(b);
  const m = (x: number, y: number) => Math.round(x + (y - x) * t).toString(16).padStart(2, "0");
  return `#${m(r1, r2)}${m(g1, g2)}${m(b1, b2)}`;
}

/** Up to four backdrop colours from the categories of whatever is on screen, most prominent first. */
export function ambientFor(categories: string[]): string[] {
  const out: string[] = [];
  for (const c of categories) { const [, mid, light] = paletteFor(c); if (!out.includes(mid)) out.push(mid); if (out.length < 4 && !out.includes(light)) out.push(light); }
  return out.slice(0, 4);
}
