/**
 * Word-wrap algorithm for {@link MSDFText}, factored out as a pure function so
 * it can be reasoned about (and tested) on its own. The Class keeps thin
 * `computeWrap`/`wrapText` methods that just feed it the current
 * `wordWrapCharCode`, `letterSpacing` and `fontData`.
 */

import type { MSDFFont, SizeScales } from './MSDFFont';

/**
 * Word wrap text to fit within `maxWidth`, returning both the wrapped string
 * and a parallel source-index map that records where each wrapped character
 * came from in the original `text`.
 *
 * `srcIndex[i]` is the index into `text` of wrapped character `i`, **except**
 * for a wrap-inserted (soft) newline, which gets the sentinel `-1`. An original
 * (hard) `'\n'` keeps its real source index. That single sentinel is what lets
 * `rebuildText` tell soft breaks from hard breaks — so `srcLine` counts only the
 * hard ones while `line` counts both.
 *
 * When `maxWidth <= 0` (no wrapping) the map is the identity and every newline
 * is hard. The map is always built so the layout path is uniform.
 *
 * @param text             The text to wrap.
 * @param maxWidth         Maximum width in pixels (`<= 0` disables wrapping).
 * @param fontSize         Font size the wrap is measured at.
 * @param wordWrapCharCode Character code word wrapping breaks on (usually space).
 * @param letterSpacing    Extra per-character spacing, in px (affects measurement).
 * @param fontData         Font used to measure candidate lines.
 * @param scales           Optional per-character size multipliers, indexed by
 *   position in `text` (rich-text `fontScale` runs). `null` = uniform size.
 */
export function wrapLines(
    text: string,
    maxWidth: number,
    fontSize: number,
    wordWrapCharCode: number,
    letterSpacing: number,
    fontData: MSDFFont,
    scales: SizeScales = null
): { text: string; srcIndex: number[] } {
    const n = text ? text.length : 0;
    const outSrc: number[] = [];

    // No wrapping (or empty): identity map — text unchanged, every newline hard.
    if (maxWidth <= 0 || n === 0) {
        for (let i = 0; i < n; i++) {
            outSrc.push(i);
        }
        return { text: text || '', srcIndex: outSrc };
    }

    const wrapCode = wordWrapCharCode;
    let outText = '';

    // The committed part of the current output line and the pending word, held
    // as parallel (charCode, srcIndex) runs. The source index is what lets a
    // measurement look up the character's `fontScale`.
    let lineChars: number[] = [], lineSrc: number[] = [];
    let wordChars: number[] = [], wordSrc: number[] = [];

    /**
     * Width of `line + word`, optionally plus one more character (the wrap char
     * being tested). Walks the parallel arrays rather than a concatenated string
     * so each character can be measured at its own size. Kerning is skipped
     * across a size change, matching `MSDFFont.measureSpan` and the layout pass.
     */
    const measure = (extraCode: number, extraSrc: number): number => {
        let width = 0, prevCode = 0, prevScale = 1, count = 0;

        const add = (code: number, src: number): void => {
            const char = fontData.getChar(code);
            if (!char) { prevCode = 0; return; }
            const scale = scales ? scales[src] : 1;
            const size = fontSize * scale;
            if (prevCode !== 0 && scale === prevScale) {
                width += fontData.getKerning(prevCode, code) * size;
            }
            width += char.xAdvance * size;
            prevCode = code; prevScale = scale; count++;
        };

        for (let k = 0; k < lineChars.length; k++) add(lineChars[k], lineSrc[k]);
        for (let k = 0; k < wordChars.length; k++) add(wordChars[k], wordSrc[k]);
        if (extraCode >= 0) add(extraCode, extraSrc);

        if (letterSpacing !== 0 && count > 0) width += letterSpacing * count;
        return width;
    };

    // Emit the current line, trimming a trailing wrap char on a soft break
    // (mirrors the old `currentLine.trim()`), then emit the break newline.
    // breakSrc: -1 = soft/inserted, >= 0 = hard/original, null = final line.
    const commitLine = (breakSrc: number | null): void => {
        let end = lineChars.length;
        if (breakSrc === -1) {
            while (end > 0 && lineChars[end - 1] === wrapCode) end--;
        }
        for (let k = 0; k < end; k++) {
            outText += String.fromCharCode(lineChars[k]);
            outSrc.push(lineSrc[k]);
        }
        if (breakSrc !== null) {
            outText += '\n';
            outSrc.push(breakSrc);
        }
        lineChars = []; lineSrc = [];
    };

    // End of a source paragraph (hard '\n' or end of string): place the
    // pending word, wrapping it to its own line if the line now overflows.
    const finishParagraph = (): void => {
        if (wordChars.length === 0) return;
        if (measure(-1, 0) > maxWidth && lineChars.length > 0) {
            commitLine(-1);                                  // push the filled line (soft break)
            lineChars = wordChars; lineSrc = wordSrc;        // word starts the next line
        } else {
            for (let k = 0; k < wordChars.length; k++) { lineChars.push(wordChars[k]); lineSrc.push(wordSrc[k]); }
        }
        wordChars = []; wordSrc = [];
    };

    for (let i = 0; i < n; i++) {
        const code = text.charCodeAt(i);

        if (code === 10) {                                   // hard newline from the source
            finishParagraph();
            commitLine(i);                                   // break carries the real source index
            continue;
        }

        if (code === wrapCode) {                             // word boundary
            if (measure(code, i) > maxWidth && lineChars.length > 0) {
                commitLine(-1);                              // soft break: the current word overflows
                lineChars = wordChars; lineSrc = wordSrc;
                lineChars.push(code); lineSrc.push(i);
            } else {
                for (let k = 0; k < wordChars.length; k++) { lineChars.push(wordChars[k]); lineSrc.push(wordSrc[k]); }
                lineChars.push(code); lineSrc.push(i);
            }
            wordChars = []; wordSrc = [];
        } else {                                             // ordinary character: extend the word
            wordChars.push(code); wordSrc.push(i);
        }
    }

    finishParagraph();
    commitLine(null);                                        // final line, no trailing newline

    return { text: outText, srcIndex: outSrc };
}
