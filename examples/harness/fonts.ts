import * as Phaser from "phaser";

/**
 * One typeface, available in all three forms the examples compare:
 * an MSDF atlas (this plugin), a Phaser BitmapText, and a `.ttf` for canvas
 * `Text`. All five fonts are SIL OFL licensed (see each folder's LICENSE.txt).
 */
export interface FontDef {
  /** Cache key for the MSDF font + its atlas texture, and the TTF family name. */
  key: string;
  /** Human-readable label for UI dropdowns. */
  label: string;
  /** Folder name and file prefix under `public/assets/`. */
  base: string;
  /** Cache key for the Phaser BitmapText version — must differ from `key`. */
  bitmapKey: string;
  /** Number of kerning pairs in the atlas (0 = none). */
  kerningPairs: number;
  /** True for monospaced faces. */
  mono: boolean;
}

export const FONTS: FontDef[] = [
  { key: "Anton", label: "Anton", base: "Anton_Regular", bitmapKey: "Anton-bmp", kerningPairs: 17, mono: false },
  { key: "Bangers", label: "Bangers", base: "Bangers_Regular", bitmapKey: "Bangers-bmp", kerningPairs: 1228, mono: false },
  { key: "Inter", label: "Inter", base: "Inter_Regular", bitmapKey: "Inter-bmp", kerningPairs: 62, mono: false },
  { key: "JetBrainsMono", label: "JetBrains Mono", base: "JetBrainsMono_Regular", bitmapKey: "JetBrainsMono-bmp", kerningPairs: 0, mono: true },
  { key: "RobotoCondensed", label: "Roboto Condensed", base: "RobotoCondensed_Regular", bitmapKey: "RobotoCondensed-bmp", kerningPairs: 205, mono: false },
];

/** Default font for examples that show a single typeface. */
export const DEFAULT_FONT = "Inter";

/** Look up a font by its MSDF key, falling back to the first font. */
export function fontByKey(key: string): FontDef {
  return FONTS.find((f) => f.key === key) ?? FONTS[0];
}

/** Options map for a tweakpane font dropdown: `{ label: key }`. */
export const FONT_OPTIONS: Record<string, string> = Object.fromEntries(
  FONTS.map((f) => [f.label, f.key]),
);

/**
 * Queue every font — MSDF atlas, BitmapText, and TTF — on the given loader.
 * Run once from {@link PreloadScene} so all examples share one set of caches.
 *
 * The MSDF atlas is a single **merged** atlas (msdf-atlas-gen `-and`, see
 * `public/assets/merged/`), generated with `-fontname` matching each
 * `FONTS[].key` exactly — one `load.msdfFont` call registers all five keys
 * against one shared texture, so mixed-font rich text (`per-run-font.ts`)
 * batches into a single draw call instead of flushing per font. BitmapText
 * and TTF stay per-font; only the MSDF path benefits from merging.
 */
export function preloadFonts(load: Phaser.Loader.LoaderPlugin): void {
  load.msdfFont("mergedFonts", "assets/merged/merged_mtsdf.png", "assets/merged/merged_mtsdf.json");

  for (const f of FONTS) {
    const dir = `assets/${f.base}`;
    load.bitmapFont(f.bitmapKey, `${dir}/${f.base}_bitmap.png`, `${dir}/${f.base}_bitmap.fnt`);
    load.font(f.key, `${dir}/${f.base}.ttf`);
  }
}
