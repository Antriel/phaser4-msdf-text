/**
 * Run-aware text measurement.
 *
 * Measurement used to be a method on a single `MSDFFont`. Per-run **font**
 * breaks that: the advance, kerning, ascender and line height of a character all
 * depend on *its own* run's font, not on the text object's base font. So the
 * primitives move here and take a {@link LayoutRuns} — a font/size source keyed
 * by character index — while `MSDFFont` keeps thin single-font wrappers for
 * direct callers.
 *
 * Both maps are `null` on the uniform fast path, which is the overwhelmingly
 * common case: no allocation, no lookup, one font.
 *
 * The wrap pass (`MSDFTextWrap.wrapLines`), the measurement pass here, and the
 * layout pass (`MSDFText.rebuildText`) must make **identical** advance and
 * kerning decisions, or a wrapped line will not match its measured width. The
 * three rules they share:
 *
 *   - a character missing from *its run's* font is skipped entirely — no
 *     advance, and no fallback to any other run's font;
 *   - kerning applies only between two characters in the same font at the same
 *     size. A kern pair across a font boundary does not exist, and one across a
 *     size boundary has no well-defined size to scale by;
 *   - the `space` pads (`padBefore` / `padAfter`) ride a character's own advance,
 *     inside the same "is it in the font" guard, so a skipped character takes its
 *     pads with it and the three passes cannot drift apart.
 */

import type { MSDFFont } from './MSDFFont';

/**
 * The font and size of every character position, for one measurement pass.
 *
 * `scales` and `fonts` are indexed by position in whatever string is being
 * measured — source text for the wrap pass, wrapped text for everything after
 * it (see `MSDFText.wrappedRuns`, which re-indexes them). Either may be `null`,
 * meaning "uniform": the base font, or a multiplier of 1, everywhere.
 */
export interface LayoutRuns {
    /** The text object's own font. Also `fontList[0]`, when `fontList` exists. */
    base: MSDFFont;
    /** Per-index font-size multipliers (rich-text `fontScale`), or `null`. */
    scales: ArrayLike<number> | null;
    /** Per-index indices into `fontList` (rich-text `font`), or `null`. */
    fonts: ArrayLike<number> | null;
    /** The distinct fonts `fonts` indexes; `fontList[0]` is always `base`. */
    fontList: MSDFFont[] | null;
    /** Per-index extra advance *before* the character, in em (`space`), or `null`. */
    padBefore: ArrayLike<number> | null;
    /** Per-index extra advance *after* the character, in em (`space`), or `null`. */
    padAfter: ArrayLike<number> | null;
}

/** A {@link LayoutRuns} with one font at one size and no pads — the fast path. */
export function uniformRuns(base: MSDFFont): LayoutRuns {
    return { base, scales: null, fonts: null, fontList: null, padBefore: null, padAfter: null };
}

/** The font governing character `i`. */
export function fontAt(runs: LayoutRuns, i: number): MSDFFont {
    return runs.fonts ? runs.fontList![runs.fonts[i]] : runs.base;
}

/** The font-size multiplier governing character `i`. */
export function scaleAt(runs: LayoutRuns, i: number): number {
    return runs.scales ? runs.scales[i] : 1;
}

/**
 * The extra advance inserted before character `i`, in em of *that character's own
 * size* — so a pad on a `fontScale`d run grows with the run, and every pad scales
 * with `fontSize` (which is what keeps `fitInside`'s binary search monotone).
 *
 * A pad rides its character's advance: it is only ever applied where that
 * character's own glyph was found in its own run's font, which is what keeps this
 * pass, the wrap pass and the layout pass making identical decisions.
 */
export function padBeforeAt(runs: LayoutRuns, i: number): number {
    return runs.padBefore ? runs.padBefore[i] : 0;
}

/** The extra advance inserted after character `i`, in em. See {@link padBeforeAt}. */
export function padAfterAt(runs: LayoutRuns, i: number): number {
    return runs.padAfter ? runs.padAfter[i] : 0;
}

/**
 * Width of `text[from, to)` laid out at `fontSize`, honouring each character's
 * own font and size multiplier. This is the single primitive every measurement
 * walks, and it mirrors the advance/kerning arithmetic of `MSDFText.rebuildText`
 * exactly — see the module comment for the two rules they must share.
 */
export function measureSpan(
    text: string,
    from: number,
    to: number,
    fontSize: number,
    letterSpacing: number,
    runs: LayoutRuns
): number {
    let width = 0;
    let prevCharCode = 0;
    let prevScale = 1;
    let prevFont: MSDFFont | null = null;
    let count = 0;

    for (let i = from; i < to; i++) {
        const charCode = text.charCodeAt(i);
        const font = fontAt(runs, i);
        const char = font.getChar(charCode);

        if (!char) {
            // Not in this run's font: skipped, and never borrowed from another.
            prevCharCode = 0;
            continue;
        }

        const scale = scaleAt(runs, i);
        const size = fontSize * scale;

        if (prevCharCode !== 0 && scale === prevScale && font === prevFont) {
            width += font.getKerning(prevCharCode, charCode) * size;
        }

        // The `space` pads bracket the character's own advance. A pad does not
        // suppress kerning: where a run boundary is also a font or size change,
        // kerning was already skipped; where it is not, the two simply add.
        width += padBeforeAt(runs, i) * size;
        width += char.xAdvance * size;
        width += padAfterAt(runs, i) * size;

        prevCharCode = charCode;
        prevScale = scale;
        prevFont = font;
        count++;
    }

    // Letter spacing is added after every character's advance (matching
    // BitmapText), so a measured width includes a trailing slot. It is a
    // constant pixel amount and does not scale with a run's size.
    if (letterSpacing !== 0 && count > 0) {
        width += letterSpacing * count;
    }

    return width;
}

/**
 * The vertical metrics of the line spanning `[from, to)`.
 *
 * A line's ascent and box height are each the **largest** of that metric over
 * the characters on the line — taken independently, because with mixed fonts the
 * tallest ascender and the tallest line box need not belong to the same run.
 * (With one font they always do, so this reduces exactly to the old
 * `metric × maxScale`.) The shared ascent is what every glyph on the line sits
 * on, which is why mixed sizes and mixed fonts align by baseline, not by top.
 *
 * An empty span — a blank line — has no runs on it, so it takes the base font at
 * the object's own size.
 */
export function lineMetrics(
    from: number,
    to: number,
    fontSize: number,
    runs: LayoutRuns
): { ascent: number; height: number } {
    if (to <= from) {
        return { ascent: runs.base.getAscender(fontSize), height: runs.base.getLineHeight(fontSize) };
    }

    let ascent = 0;
    let height = 0;

    for (let i = from; i < to; i++) {
        const data = fontAt(runs, i).data;
        const size = fontSize * scaleAt(runs, i);
        // `ascender` is negative in the y-down convention the parser normalizes to.
        const a = Math.abs(data.ascender * size);
        const h = data.lineHeight * size;
        if (a > ascent) ascent = a;
        if (h > height) height = h;
    }

    return { ascent, height };
}

/** The result of {@link measureLines}. */
export interface LineMeasurement {
    lines: string[];
    widths: number[];
    baselines: number[];
    /** Each line's ascent — baseline minus this is the line's highest ascender. */
    ascents: number[];
    /** Each line's box height (the tallest `lineHeight` on it), excluding `lineSpacing`. */
    heights: number[];
    totalWidth: number;
    totalHeight: number;
    shortest: number;
    longest: number;
}

/**
 * Measure `text` line by line, returning each line's width and its resolved
 * baseline Y measured from the top of the text block.
 *
 * With mixed sizes or fonts the line metrics are **variable** (see
 * {@link lineMetrics}), so the baselines cannot be derived by the caller from a
 * uniform line height — which is why they are returned here.
 */
export function measureLines(
    text: string,
    fontSize: number,
    lineSpacing: number,
    letterSpacing: number,
    runs: LayoutRuns
): LineMeasurement {
    const lines = text.split('\n');
    const widths: number[] = [];
    const baselines: number[] = [];
    const ascents: number[] = [];
    const heights: number[] = [];
    let maxWidth = 0;
    let minWidth = Infinity;

    // Absolute Y of the current line's top edge, walking down the block.
    let top = 0;
    // Absolute index of the current line's first character in `text`.
    let start = 0;

    for (const line of lines) {
        const end = start + line.length;

        const width = measureSpan(text, start, end, fontSize, letterSpacing, runs);
        widths.push(width);
        maxWidth = Math.max(maxWidth, width);
        if (line.length > 0) {
            minWidth = Math.min(minWidth, width);
        }

        const metrics = lineMetrics(start, end, fontSize, runs);
        baselines.push(top + metrics.ascent);
        ascents.push(metrics.ascent);
        heights.push(metrics.height);
        top += metrics.height + lineSpacing;

        start = end + 1; // skip the '\n' that split() consumed
    }

    if (minWidth === Infinity) {
        minWidth = 0;
    }

    // `top` overshot by one trailing lineSpacing; there are always >= 1 lines.
    const totalHeight = top - lineSpacing;

    return {
        lines,
        widths,
        baselines,
        ascents,
        heights,
        totalWidth: maxWidth,
        totalHeight,
        shortest: minWidth,
        longest: maxWidth
    };
}
