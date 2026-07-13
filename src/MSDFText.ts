/**
 * MSDFText GameObject
 *
 * Renders text using MSDF (Multi-channel Signed Distance Field) fonts.
 * Characters are submitted to a custom BatchHandler so a full text object
 * typically renders in 1-2 draw calls.
 *
 * Uses Phaser's idiomatic Class system with component mixins for proper
 * integration with Phaser's GameObject ecosystem. The public surface is
 * BitmapText-flavoured but not a drop-in replacement — colour is a single base
 * `color` (no per-object Tint component), alignment is a string, and per-glyph
 * effects go through the `GlyphState` array rather than character callbacks.
 *
 * Usage:
 *   const text = scene.add.msdfText(x, y, 'arial', 'Hello World', fontSize);
 *   // or
 *   const text = scene.make.msdfText({ font: 'arial', text: 'Hello', fontSize: 42, x: 100, y: 100 });
 */

import * as Phaser from "phaser";
import { MSDFFont } from './MSDFFont';
import MSDFTextWebGLRenderer, { PASS_HIGHLIGHT, PASS_UNDERLINE, PASS_STRIKE } from './MSDFTextWebGLRenderer';
import { createGlyphState, type GlyphState } from './MSDFGlyphState';
import { createDecorState, type DecorationState } from './MSDFDecorState';
import { wrapLines } from './MSDFTextWrap';
import { measureLines, uniformRuns, type LayoutRuns, type LineMeasurement } from './MSDFMeasure';
import {
    toColorInt,
    toRoundedAmount,
    resolveStyle,
    resolveTarget,
    resolveDecoration,
    resolveHighlight,
    deriveRuns,
    isContentAnchored,
    hasStyleKeys,
    styleHasShadowKeys,
    styleHasAppearanceKeys,
    styleHasDecorationKeys,
    applyStyleToGlyph,
    type ResolvedDash,
    type ResolvedDecoration,
    type ResolvedHighlight,
    type ResolvedStyle,
    type StyleRun,
    type StyleOverlay
} from './MSDFTextStyle';
import { packColor, packSolidParams, type Corners, type PackedCorners } from './MSDFColor';
import type {
    ColorValue,
    DecorationSpec,
    HighlightSpec,
    MSDFAlign,
    RectLike,
    FitOptions,
    Segment,
    StyleSpec,
    StyleTarget,
    StyleHandle,
    DisplayCallback,
    DecorationCallback,
    SpacingCallback,
    LineInfo,
    MSDFTextStatic
} from './MSDFTextTypes';

// Re-export the public types so `'./MSDFText'` stays the canonical import path
// for consumers (index.ts, the factory/creator, the Phaser augmentations).
export type {
    ColorValue,
    DashSpec,
    DecorationSpec,
    HighlightSpec,
    HighlightPadding,
    MSDFAlign,
    PerCorner,
    SpaceSpec,
    StyleSpec,
    SegmentSpec,
    Segment,
    MatchTarget,
    SegmentTarget,
    SpanTarget,
    StyleMatcher,
    StyleTarget,
    TextStyleOpts,
    StyleHandle,
    RectLike,
    FitOptions,
    DisplayCallback,
    DecorationCallback,
    SpacingCallback,
    SpacingPads,
    LineInfo,
    MSDFTextInstance,
    MSDFTextStatic
} from './MSDFTextTypes';
export type { GlyphState } from './MSDFGlyphState';
export type { DecorationState } from './MSDFDecorState';

// Per-glyph state mode. Static = no per-glyph array (object colour used as-is);
// callback = array re-seeded + handed to `displayCallback` each frame; manual =
// user owns the array via `editGlyphs()` and it persists until the text rebuilds.
const GLYPH_MODE_STATIC = 0;
const GLYPH_MODE_CALLBACK = 1;
const GLYPH_MODE_MANUAL = 2;

// Per-rect state mode. Two, where the glyph lane has three: there is no manual
// mode for decorations, because a rect is a merge artifact with no identity that
// survives a rebuild — see `MSDFDecorState.ts`.
const DECOR_MODE_STATIC = 0;
const DECOR_MODE_CALLBACK = 1;

/** Copy all four corners of `src` into `dst`. */
function copyCorners(dst: Corners, src: Corners): void {
    dst.topLeft = src.topLeft;
    dst.topRight = src.topRight;
    dst.bottomLeft = src.bottomLeft;
    dst.bottomRight = src.bottomRight;
}

/** Write one value to all four corners of `dst`. */
function setCorners(dst: Corners, value: number): void {
    dst.topLeft = dst.topRight = dst.bottomLeft = dst.bottomRight = value;
}

// Phaser's published types describe these as interfaces/values that don't
// match the runtime shape we need, so reach through `any`.
const Class: any = (Phaser as any).Class;
const Components: any = (Phaser as any).GameObjects.Components;
const GameObject: any = (Phaser as any).GameObjects.GameObject;
const PhaserMap: any = (Phaser as any).Structs.Map;

/**
 * Warn (once per effect, per text object) when an MTSDF-only effect is used on
 * a non-MTSDF atlas. Returns whether the loaded font actually supports it.
 */
function warnNeedsMtsdf(text: any, effectName: string): boolean {
    const fieldType = text.fontData ? text.fontData.distanceField.fieldType : undefined;
    if (fieldType === 'mtsdf') {
        return true;
    }
    if (!text._mtsdfWarnings) {
        text._mtsdfWarnings = {};
    }
    if (!text._mtsdfWarnings[effectName]) {
        text._mtsdfWarnings[effectName] = true;
        console.warn(
            `[MSDFText] "${effectName}" needs an MTSDF font atlas. The font ` +
            `"${text.font}" is "${fieldType}", so the effect falls back to the ` +
            `standard look. Regenerate the atlas with msdf-atlas-gen "-type mtsdf".`
        );
    }
    return false;
}

/**
 * Element-wise equality of two size-scale maps (either may be `null`, meaning
 * "uniform size"). A rebuild is only worth paying for when this says no.
 */
function scalesEqual(a: Float32Array | null, b: Float32Array | null): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Element-wise equality of two font maps (either may be `null`, meaning "the
 * base font everywhere"). Same role as {@link scalesEqual}: it decides whether a
 * style change actually reflows the text.
 */
function fontsEqual(a: Uint8Array | null, b: Uint8Array | null): boolean {
    if (a === b) return true;
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/** Whether two font lists hold the same fonts in the same order. */
function fontListsEqual(a: MSDFFont[], b: MSDFFont[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

/**
 * Pack a pill's rounded-box geometry into the three `params` bytes a `solid`
 * quad leaves idle. Per-corner, like every other channel in the attribute.
 */
function packPillParams(h: ResolvedHighlight): PackedCorners {
    return {
        topLeft: packSolidParams(h.radius.topLeft, h.borderWidth.topLeft, h.softness.topLeft),
        topRight: packSolidParams(h.radius.topRight, h.borderWidth.topRight, h.softness.topRight),
        bottomLeft: packSolidParams(h.radius.bottomLeft, h.borderWidth.bottomLeft, h.softness.bottomLeft),
        bottomRight: packSolidParams(h.radius.bottomRight, h.borderWidth.bottomRight, h.softness.bottomRight)
    };
}

/**
 * Pack a pill's border ring, zeroing its alpha wherever the width is zero — at
 * zero width the ring's outer edge coincides with the face's, so it would only
 * ever fringe the pill's antialiased edge. The same rule, for the same reason,
 * that `packOutlineAspect` applies to a glyph's outline.
 */
function packBorder(h: ResolvedHighlight): PackedCorners {
    const c = h.borderColor, a = h.borderAlpha, w = h.borderWidth;
    return {
        topLeft: packColor(c.topLeft, w.topLeft > 0 ? a.topLeft : 0),
        topRight: packColor(c.topRight, w.topRight > 0 ? a.topRight : 0),
        bottomLeft: packColor(c.bottomLeft, w.bottomLeft > 0 ? a.bottomLeft : 0),
        bottomRight: packColor(c.bottomRight, w.bottomRight > 0 ? a.bottomRight : 0)
    };
}

/**
 * Default render nodes map for MSDF text
 * Must be a Phaser.Structs.Map, not a plain object
 */
const DefaultMSDFNodes = new PhaserMap([
    ['Submitter', 'SubmitterQuad'],
    ['BatchHandler', 'BatchHandlerMSDF']
]);

/**
 * Render function for MSDF text (mixin)
 */
const MSDFTextRender = {
    renderWebGL: function (renderer: any, src: any, drawingContext: any, parentMatrix: any): void {
        // Rebuild if needed — rebuildText clears _dirty (and _stylesDirty, since
        // it re-seeds). Otherwise apply any pending style change lazily: one
        // coalesced re-seed regardless of how many handles changed this tick.
        if (src._dirty) {
            src.rebuildText();
        } else if (src._stylesDirty) {
            src.applyStylesDirty();
        }

        // Delegate to MSDFTextWebGLRenderer
        MSDFTextWebGLRenderer(renderer, src, drawingContext, parentMatrix);
    }
};

/**
 * MSDFText GameObject with batched rendering using Phaser's Class system
 */
export const MSDFText: MSDFTextStatic = new Class({

    Extends: GameObject,

    Mixins: [
        Components.Alpha,
        Components.BlendMode,
        Components.Depth,
        Components.GetBounds,
        Components.Origin,
        Components.RenderNodes,
        Components.ScrollFactor,
        Components.Texture,
        Components.Transform,
        Components.Visible,
        MSDFTextRender
    ],

    initialize:

    function MSDFText(
        scene: Phaser.Scene,
        x: number,
        y: number,
        font: string,
        text: string = '',
        fontSize: number = 42,
        align: MSDFAlign = 'left'
    ) {
        GameObject.call(this, scene, 'MSDFText');

        // Font and text properties
        this.font = font;

        const msdfCache = scene.sys.cache.custom.msdfFont;
        const fontData: MSDFFont | undefined = msdfCache ? msdfCache.get(font) : undefined;

        if (!fontData) {
            console.warn('Invalid MSDFText font key: ' + font);
        }

        this.fontData = fontData as MSDFFont;

        // ── Backing fields ──────────────────────────────────────────────
        // These have setters that flip `_dirty` (or normalize the value), so
        // a private backing field is required. They are not part of the
        // public `MSDFTextInstance` type.
        this._text = text;
        this._fontSize = fontSize;
        this._color = { r: 1, g: 1, b: 1, a: 1 };
        this._align = align;
        this._lineSpacing = 0;
        this._letterSpacing = 0;
        this._maxWidth = 0; // 0 = no word wrapping

        // ── Plain public fields ─────────────────────────────────────────
        this.wordWrapCharCode = 32; // space character

        // Faux bold, in distance-field units. Shifts the glyph's distance
        // threshold, so it never touches layout — assign/tween directly.
        // Backing field: the accessor below flags a re-seed when rich-text
        // appearance styling is active, same as `color`.
        this._weight = 0;

        // Outline — no layout side effects, so assign/tween directly. Backing
        // fields for the same reason as `weight`. `outlineLayered` is read live
        // by the renderer every frame (never seeded into GlyphState), so it
        // stays a plain field.
        this._outlineWidth = 0;
        this._outlineColor = 0x000000;
        this._outlineAlpha = 1;
        this._outlineRounded = 0;
        this._outlineSoftness = 0;
        this.outlineLayered = false;
        // Inner end of the outline's colour ramp. `-1` means "inherit
        // `outlineColor`", i.e. no ramp — a real colour here is what turns the
        // two-tone outline on (and forces `outlineLayered` in the renderer).
        this._outlineInnerColor = -1;

        // Drop shadow — backing fields for the same reason as `weight`.
        this._shadowX = 0;
        this._shadowY = 0;
        this._shadowColor = 0x000000;
        this._shadowAlpha = 0.5;
        this._shadowSoftness = 0;
        this._shadowSpread = 0;
        // Default fully *on*, unlike `outlineRounded`. Rounding only bites once
        // the shadow's edge leaves the glyph contour — which needs a spread or a
        // softness — and where it does, a sharp dilation grows a mitre spike at
        // every corner. So `1` reproduces the old derived behaviour exactly
        // (soft ⇒ round) and is what a spread wants; `0` is opt-in spikes, and
        // the range between them files the mitres down by degrees.
        this._shadowRounded = 1;
        this._shadowInnerColor = -1;

        // Force the shadow pass in per-glyph modes (callback / manual) even when
        // the object has no shadow, so shadows set on individual glyphs render.
        // Rich-text styles that set a shadow turn this on automatically.
        this.perGlyphShadow = false;

        // ── Internal state ──────────────────────────────────────────────
        this._characters = [];
        this._width = 0;
        this._height = 0;
        // Per-line layout, kept from the rebuild that computed it. The measure
        // pass produces all of this anyway; retaining it is what lets a per-frame
        // display callback ask for its line's extent without re-wrapping the text.
        this._lines = [];
        this._shortestLine = 0;
        this._dirty = true;
        this._mtsdfWarnings = {};

        // Per-glyph display state. Static by default — no array is built until a
        // display callback is set or `editGlyphs()` is called.
        this.displayCallback = undefined;
        this._glyphMode = GLYPH_MODE_STATIC;
        this._glyphStates = [];

        // ── Rich-text styling ───────────────────────────────────────────────
        // Two layers, painted segments → overlays (then displayCallback). Within
        // the overlays, plain creation order: the style added last wins.
        this._segmentRuns = [];   // content — rebuilt with the text (setRichText)
        this._overlays = [];      // addStyle — content- or position-anchored
        this._hasStyles = false;  // any layer non-empty ⇒ lifecycle bookkeeping runs
        this._hasAppearance = false; // any run seeds a glyph ⇒ force the per-glyph array
        this._stylesHaveShadow = false; // any run sets a shadow ⇒ run the shadow pass
        this._stylesDirty = false;// a handle/segment changed ⇒ coalesced re-seed
        this._deadHandleWarned = false;

        // ── Decorations (highlight / underline / strikethrough) ─────────────
        // Appearance lane, but glyph-independent: they resolve per *source*
        // character through the same paint order as styles, then merge into
        // rects. Never seeded into GlyphState — `displayCallback` can't see them,
        // and `setDecorationCallback` is the lane that can. Rebuilt alongside the
        // styled seed (rebuild / `_stylesDirty`), since they read `_characters`,
        // which layout owns.
        this._underline = null;      // object-level default: ResolvedDecoration | null
        this._strikethrough = null;
        this._highlight = null;      // object-level default: ResolvedHighlight | null
        this._decorRects = [];
        this._hasDecorations = false;

        // Per-rect display state. Static by default — no array is built until a
        // decoration callback is set. Two modes, not three: rects have no identity
        // that survives a rebuild, so there is nothing to hand a user to own.
        this.decorationCallback = undefined;
        this._decorMode = DECOR_MODE_STATIC;
        this._decorStates = [];
        // The one decoration knob that is *not* resolved at rebuild: a dashed
        // rule's phase slides the rects' UV origin at submit time, so it is a
        // plain public field with no dirty flag — tween it and the ants march.
        this.dashPhase = 0;

        // ── Structural styling (per-run `fontScale` and `font`) ─────────────
        // Two source-indexed maps, both `null` on the uniform fast path, both
        // feeding wrap, measurement and layout — and neither ever reaching
        // `GlyphState`. `_sizeScales` holds a font-size multiplier per source
        // character; `_fontMap` holds an index into `_runFonts`, whose slot 0 is
        // always this object's own font (so `0` means "the base font").
        this._sizeScales = null;
        this._fontMap = null;
        // The `space` pads: extra advance before / after a character, in em of that
        // character's own size. Two more source-indexed maps in the same lane, and
        // `null` on the same fast path. They are *edge* pads — a run writes only its
        // first and last character — so two adjacent runs both asking for space at
        // the boundary between them land on different slots and both get it.
        this._padBefore = null;
        this._padAfter = null;
        // The per-character lane of the same two maps: a rebuild-time callback that
        // runs as their last layer, after the segments and overlays have painted.
        this.spacingCallback = undefined;
        this._runFonts = fontData ? [fontData] : [];
        // Texture frames parallel to `_runFonts`. Slot 0 stays `null`: the base
        // font's frame is the object's own `frame`, which `setTexture` owns.
        this._runFrames = [null];
        // The tallest line box any one character could produce, in units of
        // `fontSize` (`font.lineHeight * fontScale`, maximised over the text).
        // `fitInside`'s free upper bound on the font size.
        this._maxLineUnit = fontData ? fontData.data.lineHeight : 1;
        this._missingFontWarned = false;
        this._fontLimitWarned = false;

        // Bind atlas texture via the standard Texture component (no width/height
        // or origin updates — those derive from text bounds, not the atlas frame).
        if (fontData) {
            this.setTexture(fontData.textureKey, undefined, false, false);
        }

        // Set initial position using Transform component
        this.setPosition(x, y);

        // Match BitmapText: position from top-left of the rendered text.
        // Assign directly (not via setOrigin) to avoid an early width-getter
        // call that would trigger a rebuild before we're done setting up.
        this.originX = 0;
        this.originY = 0;

        // Initialize render nodes using RenderNodes component
        this.initRenderNodes(this._defaultRenderNodesMap);

        // Initial build — also computes bounds, clears _dirty, and calls updateDisplayOrigin.
        this.rebuildText();
    },

    /**
     * The default render nodes for this Game Object.
     */
    _defaultRenderNodesMap: {
        get: function () {
            return DefaultMSDFNodes;
        }
    },

    // ========================================================================
    // Alpha overrides
    // ========================================================================
    // Phaser's `Components.Alpha` mixin has no hook for "appearance changed" —
    // it just writes `_alphaTL`/etc. directly. With rich-text styles the
    // per-glyph array bakes the object's alpha in at seed time (like colour and
    // weight), so these delegate to the mixin's own logic and then flag the
    // same coalesced re-seed via `_markAppearanceDirty`.

    setAlpha: function (topLeft?: number, topRight?: number, bottomLeft?: number, bottomRight?: number) {
        Components.Alpha.setAlpha.call(this, topLeft, topRight, bottomLeft, bottomRight);
        this._markAppearanceDirty();
        return this;
    },

    alpha: {
        get: function (this: any): number { return this._alpha; },
        set: function (this: any, value: number) {
            Components.Alpha.alpha.set.call(this, value);
            this._markAppearanceDirty();
        }
    },

    alphaTopLeft: {
        get: function (this: any): number { return this._alphaTL; },
        set: function (this: any, value: number) {
            Components.Alpha.alphaTopLeft.set.call(this, value);
            this._markAppearanceDirty();
        }
    },

    alphaTopRight: {
        get: function (this: any): number { return this._alphaTR; },
        set: function (this: any, value: number) {
            Components.Alpha.alphaTopRight.set.call(this, value);
            this._markAppearanceDirty();
        }
    },

    alphaBottomLeft: {
        get: function (this: any): number { return this._alphaBL; },
        set: function (this: any, value: number) {
            Components.Alpha.alphaBottomLeft.set.call(this, value);
            this._markAppearanceDirty();
        }
    },

    alphaBottomRight: {
        get: function (this: any): number { return this._alphaBR; },
        set: function (this: any, value: number) {
            Components.Alpha.alphaBottomRight.set.call(this, value);
            this._markAppearanceDirty();
        }
    },

    // ========================================================================
    // Text Properties
    // ========================================================================

    /**
     * The text content. Assigning routes through `setText`, so arrays are
     * joined with newlines and falsy values become empty strings.
     */
    text: {
        get: function (this: any): string { return this._text; },
        set: function (this: any, value: string | string[]) {
            this.setText(value);
        }
    },

    /**
     * Set the text content (chainable).
     *
     * Arrays are joined with `'\n'`. Falsy values (other than 0) become the
     * empty string. Width/height/displayOrigin are refreshed immediately so
     * code that reads them right after `setText` sees current values.
     */
    setText: function (value: string | string[]) {
        // Permissive falsy handling matches BitmapText: 0 stays as "0", but
        // null/undefined/'' become ''.
        if (!value && (value as unknown) !== 0) {
            value = '';
        }

        if (Array.isArray(value)) {
            value = value.join('\n');
        }

        const str = String(value);
        if (str !== this._text) {
            this._text = str;
            this._dirty = true;
            // Plain setText replaces the content: segment styles go with it,
            // position anchors drop, content anchors re-derive against the new
            // text. The segment runs are cleared *first*, so a `{ segment }`
            // overlay re-derives to nothing rather than to the old spans.
            if (this._hasStyles) {
                this._segmentRuns.length = 0;
                this.onTextChanged(str);
            }
            // Force a rebuild now so width/height/displayOrigin are correct
            // for any code that reads them between setText and the next render.
            this.updateDisplayOrigin();
        }
        return this;
    },

    /**
     * Shared text-change bookkeeping for the overlay store, then a refresh of the
     * derived style state and a flagged re-seed. Segments are handled by the
     * caller (they are content, replaced with it).
     *
     * The anchor kind decides the fate: a content anchor re-derives its spans and
     * lives on; a position anchor indexed the old text, so it is dropped and
     * marked dead (which is what its handle checks). No clamping — a
     * half-surviving range is worse than none.
     *
     * "Content" for a `{ segment }` anchor means `_segmentRuns`, not the string,
     * so every caller must install its segments before calling here — `setRichText`
     * assigns them, `setText` clears them. That anchor is also the one that can
     * legitimately re-derive to *no* spans and stay alive: it is waiting for a
     * later `setRichText` to bring its id back.
     *
     * Two phases, because a `fn` anchor is the caller's code and may throw. The
     * store is compacted first, with nothing user-supplied running; only then is
     * anything re-derived, and the `finally` refreshes the derived state whatever
     * happens. So an exception reaches the caller unswallowed and still leaves the
     * text object consistent — the overlays it never reached simply keep the spans
     * they had, which the paint loops clamp like any other stale span.
     */
    onTextChanged: function (text: string): void {
        const overlays: StyleOverlay[] = this._overlays;
        let kept = 0;
        for (let i = 0; i < overlays.length; i++) {
            const o = overlays[i];
            if (!isContentAnchored(o.anchor)) {
                o.dead = true;
                continue;
            }
            overlays[kept++] = o;
        }
        overlays.length = kept;

        try {
            for (let i = 0; i < overlays.length; i++) {
                overlays[i].runs = deriveRuns(overlays[i].anchor, text, this._segmentRuns);
            }
        } finally {
            this.refreshStyleState();
            this._stylesDirty = true;
        }
    },

    /**
     * Recompute the derived state of the two style layers. Called whenever a
     * layer changes (new/updated/removed overlay, new segments, text change).
     * Four outputs:
     *
     * - `_hasStyles` — any layer non-empty. Gates the lifecycle bookkeeping in
     *   `onTextChanged` (re-deriving anchors, dropping position-anchored overlays).
     * - `_hasAppearance` — any run seeds a `GlyphState`. Gates the per-glyph
     *   array and `applyStyleRuns`; a `fontScale`-only or decoration-only run
     *   doesn't need either.
     * - `_hasDecorations` — the object or any run sets a highlight, underline or
     *   strikethrough. Gates `rebuildDecorations`, which is glyph-array-independent.
     * - `_sizeScales` / `_fontMap` — the structural maps. Because they are
     *   *layout* inputs, a change here sets `_dirty` (a rebuild), not
     *   `_stylesDirty` (a re-seed). That is the documented cost of a structural
     *   key, on any layer. The font list is rebuilt unconditionally, since
     *   `setFont` can swap the base font out from under an otherwise unchanged map.
     */
    refreshStyleState: function (): void {
        const segs: StyleRun[] = this._segmentRuns;
        const overlays: StyleOverlay[] = this._overlays;

        this._hasStyles = segs.length > 0 || overlays.length > 0;

        let appearance = false;
        for (let i = 0; i < segs.length && !appearance; i++) appearance = styleHasAppearanceKeys(segs[i].style);
        for (let i = 0; i < overlays.length && !appearance; i++) appearance = styleHasAppearanceKeys(overlays[i].style);
        this._hasAppearance = appearance;

        let decorated = this._underline !== null || this._strikethrough !== null || this._highlight !== null;
        for (let i = 0; i < segs.length && !decorated; i++) decorated = styleHasDecorationKeys(segs[i].style);
        for (let i = 0; i < overlays.length && !decorated; i++) decorated = styleHasDecorationKeys(overlays[i].style);
        this._hasDecorations = decorated;

        // `_stylesHaveShadow` is recomputed in `applyStyleRuns` (which only runs
        // while styled); clear it here so it can't linger true after all styles go.
        if (!appearance) this._stylesHaveShadow = false;

        const prevScales: Float32Array | null = this._sizeScales;
        const prevFontMap: Uint8Array | null = this._fontMap;
        const prevFontList: MSDFFont[] = this._runFonts;

        const nextScales = this.buildSizeScales();
        const nextFonts = this.buildFontMap();

        // Publish the font and size maps *before* building the pads: `buildPads`
        // runs the spacing callback, and a spacing rule's whole job is to react to
        // the structural state it is spacing (`fontAt`, `fontScaleAt` read these
        // fields). Leaving them stale for the length of that call would hand the
        // callback the previous layout's fonts.
        this._sizeScales = nextScales;
        this._fontMap = nextFonts.map;
        this._runFonts = nextFonts.fonts;
        this._runFrames = nextFonts.frames;

        const nextPads = this.buildPads();

        // A structural change reflows. The font *list* is compared as well as the
        // map, because `setFont` replaces slot 0 while leaving every index alone.
        if (!scalesEqual(prevScales, nextScales) ||
            !fontsEqual(prevFontMap, nextFonts.map) ||
            !fontListsEqual(prevFontList, nextFonts.fonts) ||
            !scalesEqual(this._padBefore, nextPads.before) ||
            !scalesEqual(this._padAfter, nextPads.after)) {
            this._dirty = true;
        }

        this._padBefore = nextPads.before;
        this._padAfter = nextPads.after;
        this._maxLineUnit = this.computeMaxLineUnit();
    },

    /**
     * Paint the structural `space` of every segment run, then every overlay match,
     * into two per-source-character em pads — the same layer order as the size,
     * font, appearance and decoration passes, so a later overlay's pad beats an
     * earlier one's and both beat an overlapping segment's.
     *
     * A run writes only its **edges**: `spaceBefore` lands on its first character,
     * `spaceAfter` on its last. That is what keeps adjacency honest — run A's
     * `after` and run B's `before` occupy *different* characters, so a boundary two
     * runs both want space at gets both of their requests, while two rules fighting
     * over the *same* edge resolve by layer order like everything else here.
     *
     * `spacingCallback` runs last, on the finished maps, and may add to or overwrite
     * anything the spans painted. That is the whole per-character lane: a span of
     * length 1 already reaches one character, so what the callback is for is *many*
     * characters with *different* values, which through the spec layers would cost
     * one overlay each.
     *
     * Returns `null` maps when nothing sets a pad, keeping the fast path
     * allocation-free and letting every measurement skip the lookup.
     */
    buildPads: function (): { before: Float32Array | null; after: Float32Array | null } {
        const n = this._text.length;
        let before: Float32Array | null = null;
        let after: Float32Array | null = null;

        const paint = (start: number, length: number, style: ResolvedStyle): void => {
            if (length <= 0 || n === 0) return;
            if (style.spaceBefore !== undefined) {
                const first = Math.max(0, start);
                if (first < n) {
                    if (!before) before = new Float32Array(n);
                    before[first] = style.spaceBefore;
                }
            }
            if (style.spaceAfter !== undefined) {
                const last = Math.min(start + length, n) - 1;
                if (last >= 0) {
                    if (!after) after = new Float32Array(n);
                    after[last] = style.spaceAfter;
                }
            }
        };

        for (let i = 0; i < this._segmentRuns.length; i++) {
            const run: StyleRun = this._segmentRuns[i];
            paint(run.start, run.length, run.style);
        }
        for (let i = 0; i < this._overlays.length; i++) {
            const overlay: StyleOverlay = this._overlays[i];
            const style: ResolvedStyle = overlay.style;
            if (style.spaceBefore === undefined && style.spaceAfter === undefined) continue;
            const runs = overlay.runs;
            for (let r = 0; r < runs.length; r++) paint(runs[r].start, runs[r].length, style);
        }

        // The per-character lane. Both maps must exist for it to write into, so a
        // text with a spacing callback leaves the null fast path — which is the
        // callback's own cost, not the feature's.
        if (this.spacingCallback && n > 0) {
            if (!before) before = new Float32Array(n);
            if (!after) after = new Float32Array(n);
            this.spacingCallback({ before, after }, this._text, this);
        }

        return { before, after };
    },

    /**
     * Resolve the structural `font` of every segment run, then every overlay
     * match, into an index per source character — the same layer order as the
     * size, appearance and decoration passes, so a later overlay's font beats an
     * earlier one's and both beat an overlapping segment's.
     *
     * Index `0` is the object's own font, so a `null` map means "one font
     * everywhere" — the fast path that skips the lookup in every measurement.
     * Keys are resolved against the scene's `msdfFont` cache here rather than in
     * `resolveStyle`, which is `this`-free and outlives any one text object.
     */
    buildFontMap: function (): { map: Uint8Array | null; fonts: MSDFFont[]; frames: any[] } {
        const n = this._text.length;
        const base: MSDFFont = this.fontData;
        const fonts: MSDFFont[] = [base];
        const frames: any[] = [null];   // slot 0 uses the object's own `frame`
        let map: Uint8Array | null = null;

        const sys = this.scene ? this.scene.sys : null;
        const cache = sys ? sys.cache.custom.msdfFont : null;

        /** The `fonts` slot for a cache key, registering the font on first use. */
        const indexOf = (key: string): number => {
            const font: MSDFFont | undefined = cache ? cache.get(key) : undefined;
            if (!font) {
                if (!this._missingFontWarned) {
                    this._missingFontWarned = true;
                    console.warn(
                        `[MSDFText] No MSDF font is loaded under the key "${key}", so the ` +
                        `run falls back to this text's own font ("${this.font}"). Load it ` +
                        `with this.load.msdfFont("${key}", ...) first.`
                    );
                }
                return 0;
            }
            const existing = fonts.indexOf(font);
            if (existing >= 0) return existing;
            // The map is a Uint8Array, so slot 255 is the last addressable one.
            if (fonts.length > 255) {
                if (!this._fontLimitWarned) {
                    this._fontLimitWarned = true;
                    console.warn('[MSDFText] More than 256 distinct per-run fonts; ignoring the rest.');
                }
                return 0;
            }
            fonts.push(font);
            frames.push(sys.textures.getFrame(font.textureKey));
            return fonts.length - 1;
        };

        const paint = (start: number, length: number, key: string): void => {
            const idx = indexOf(key);
            // Nothing to record while everything is still the base font: `null`
            // *is* "all zeroes". Once allocated, a base-font run must be written,
            // since it may be overpainting a different font.
            if (!map) {
                if (idx === 0) return;
                map = new Uint8Array(n);
            }
            const end = Math.min(start + length, n);
            for (let i = Math.max(0, start); i < end; i++) map[i] = idx;
        };

        for (let i = 0; i < this._segmentRuns.length; i++) {
            const run: StyleRun = this._segmentRuns[i];
            if (run.style.font !== undefined) paint(run.start, run.length, run.style.font);
        }
        for (let i = 0; i < this._overlays.length; i++) {
            const overlay: StyleOverlay = this._overlays[i];
            const key = overlay.style.font;
            if (key === undefined) continue;
            const runs = overlay.runs;
            for (let r = 0; r < runs.length; r++) paint(runs[r].start, runs[r].length, key);
        }
        return { map, fonts, frames };
    },

    /**
     * The tallest line box a single character of this text can produce, per unit
     * of `fontSize`: `max(font.lineHeight × fontScale)` over the source string.
     *
     * `fitInside` divides the box height by this for a free upper bound on the
     * font size — valid because the block is at least as tall as its tallest
     * line, which is at least as tall as its tallest character. With one font at
     * one size it is just that font's `lineHeight`.
     */
    computeMaxLineUnit: function (): number {
        const fonts: MSDFFont[] = this._runFonts;
        // An invalid font key warns in the constructor and leaves `fontData`
        // undefined; don't turn that into a crash here rather than at render.
        const base = fonts.length > 0 && fonts[0] ? fonts[0].data.lineHeight : 1;

        const scales: Float32Array | null = this._sizeScales;
        const map: Uint8Array | null = this._fontMap;
        if ((!scales && !map) || !fonts[0]) return base;

        const n = this._text.length;
        let max = 0;
        for (let i = 0; i < n; i++) {
            const lineHeight = map ? fonts[map[i]].data.lineHeight : base;
            const unit = lineHeight * (scales ? scales[i] : 1);
            if (unit > max) max = unit;
        }
        return max > 0 ? max : base;
    },

    /**
     * The font governing source character `index` — this text's own font unless a
     * run put another one there. See {@link MSDFTextInstance.fontAt}.
     */
    fontAt: function (index: number): MSDFFont {
        const map: Uint8Array | null = this._fontMap;
        if (!map || index < 0 || index >= map.length) return this.fontData;
        return this._runFonts[map[index]];
    },

    /**
     * The `fontScale` multiplier governing source character `index` (`1` unless a
     * run set one). See {@link MSDFTextInstance.fontScaleAt}.
     */
    fontScaleAt: function (index: number): number {
        const scales: Float32Array | null = this._sizeScales;
        if (!scales || index < 0 || index >= scales.length) return 1;
        return scales[index];
    },

    /**
     * The structural maps as a run source keyed by **source** index — what the
     * wrap pass measures against. Not part of the public `MSDFTextInstance` type.
     */
    sourceRuns: function (): LayoutRuns {
        if (!this._sizeScales && !this._fontMap && !this._padBefore && !this._padAfter) {
            return uniformRuns(this.fontData);
        }
        return {
            base: this.fontData,
            scales: this._sizeScales,
            fonts: this._fontMap,
            fontList: this._runFonts,
            padBefore: this._padBefore,
            padAfter: this._padAfter
        };
    },

    /**
     * Paint the structural `fontScale` of every segment run, then every overlay
     * match, into a multiplier per source character — the same layer order as
     * the appearance pass, so a later overlay's size beats an earlier one's and
     * both beat an overlapping segment's.
     *
     * Returns `null` when no layer sets `fontScale`, which keeps the uniform-size
     * fast path allocation-free and lets every measurement skip the lookup.
     */
    buildSizeScales: function (): Float32Array | null {
        const n = this._text.length;
        let scales: Float32Array | null = null;

        const paint = (start: number, length: number, value: number): void => {
            if (!scales) {
                scales = new Float32Array(n);
                scales.fill(1);
            }
            const end = Math.min(start + length, n);
            for (let i = Math.max(0, start); i < end; i++) scales[i] = value;
        };

        for (let i = 0; i < this._segmentRuns.length; i++) {
            const run: StyleRun = this._segmentRuns[i];
            if (run.style.fontScale !== undefined) paint(run.start, run.length, run.style.fontScale);
        }
        for (let i = 0; i < this._overlays.length; i++) {
            const overlay: StyleOverlay = this._overlays[i];
            const value = overlay.style.fontScale;
            if (value === undefined) continue;
            const runs = overlay.runs;
            for (let r = 0; r < runs.length; r++) paint(runs[r].start, runs[r].length, value);
        }
        return scales;
    },

    /**
     * Project the source-indexed structural maps onto a wrapped string, so
     * measurement and layout can index them by their own position. Wrap-inserted
     * newlines (source index `-1`) take the object's own font and size; they
     * carry no glyph. Not part of the public `MSDFTextInstance` type.
     */
    wrappedRuns: function (srcIndex: number[]): LayoutRuns {
        const scales: Float32Array | null = this._sizeScales;
        const map: Uint8Array | null = this._fontMap;
        const padB: Float32Array | null = this._padBefore;
        const padA: Float32Array | null = this._padAfter;
        if (!scales && !map && !padB && !padA) return uniformRuns(this.fontData);

        const n = srcIndex.length;
        const outScales = scales ? new Float32Array(n) : null;
        const outFonts = map ? new Uint8Array(n) : null;
        const outPadB = padB ? new Float32Array(n) : null;
        const outPadA = padA ? new Float32Array(n) : null;

        for (let i = 0; i < n; i++) {
            const si = srcIndex[i];
            if (outScales) outScales[i] = si >= 0 ? scales![si] : 1;
            if (outFonts) outFonts[i] = si >= 0 ? map![si] : 0;
            // A wrap-inserted newline (`si < 0`) carries no glyph, so it carries no
            // pad either — and the character it broke before keeps its own.
            if (outPadB) outPadB[i] = si >= 0 ? padB![si] : 0;
            if (outPadA) outPadA[i] = si >= 0 ? padA![si] : 0;
        }
        return {
            base: this.fontData,
            scales: outScales,
            fonts: outFonts,
            fontList: this._runFonts,
            padBefore: outPadB,
            padAfter: outPadA
        };
    },

    /**
     * The font size. Setting this triggers a rebuild on next render.
     */
    fontSize: {
        get: function (this: any): number { return this._fontSize; },
        set: function (this: any, value: number) {
            if (this._fontSize !== value) {
                this._fontSize = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set font size (chainable)
     */
    setFontSize: function (size: number) {
        this.fontSize = size;
        return this;
    },

    /**
     * Swap the font used by this text. Existing text, size, and alignment are
     * preserved unless overridden via the arguments.
     *
     * @param font  Key of the font in the `msdfFont` cache.
     * @param size  Optional font size in pixels. Defaults to the current size.
     * @param align Optional alignment (`'left'`, `'center'` or `'right'`).
     *              Defaults to the current alignment.
     */
    setFont: function (font: string, size?: number, align?: MSDFAlign) {
        const msdfCache = this.scene.sys.cache.custom.msdfFont;
        const fontData: MSDFFont | undefined = msdfCache ? msdfCache.get(font) : undefined;

        if (!fontData) {
            console.warn('Invalid MSDFText font key: ' + font);
            return this;
        }

        this.font = font;
        this.fontData = fontData;
        if (size !== undefined) this._fontSize = size;
        if (align !== undefined) this._align = align;

        this.setTexture(fontData.textureKey, undefined, false, false);
        this._dirty = true;
        // Slot 0 of the font list *is* the base font, so a swap invalidates it —
        // along with `_maxLineUnit`, which is derived from the list's metrics.
        this.refreshStyleState();
        this.updateDisplayOrigin();
        return this;
    },

    /**
     * Set the display size of this text (in pixels) by adjusting its scale.
     */
    setDisplaySize: function (width: number, height: number) {
        this.displayWidth = width;
        this.displayHeight = height;
        return this;
    },

    /**
     * Resize (and optionally place) the text to fit inside a box by reflowing.
     * See {@link MSDFTextInstance.fitInside} for the full contract.
     */
    fitInside: function (rect: RectLike, options: FitOptions = {}) {
        const boxW = rect.width;
        const boxH = rect.height;
        // Both dimensions must be positive; otherwise there is nothing to fit.
        if (!(boxW > 0) || !(boxH > 0)) {
            return this;
        }

        const maxFontSize = options.maxFontSize ?? this._fontSize;
        const minFontSize = options.minFontSize ?? 1;
        const precision = options.precision ?? 0.25;

        // The predicate is monotone in size: bigger font ⇒ taller lines and never
        // fewer of them (words only wrap more), so height is non-decreasing. Per-run
        // `fontScale` is a *multiplier*, so every run grows in proportion and that
        // monotonicity survives — which is precisely why it isn't absolute pixels.
        // Per-run `font` never scales, so it can't break it either.
        const fits = (size: number): boolean => {
            const wrapped = this.computeWrap(this._text, boxW, size);
            const m = measureLines(
                wrapped.text, size, this._lineSpacing, this._letterSpacing,
                this.wrappedRuns(wrapped.srcIndex)
            );
            return m.totalWidth <= boxW && m.totalHeight <= boxH;
        };

        // Free hard upper bound: any layout is at least one line tall, and the
        // tallest line is at least `size * maxLineUnit`, so size <= boxH / maxLineUnit.
        // A negative `lineSpacing` breaks the first half of that — the block can be
        // *shorter* than its tallest line — so the bound would cap `hi` below a size
        // that actually fits. Fall back to `maxFontSize` and let the bisection work.
        let hi = this._lineSpacing >= 0
            ? Math.min(maxFontSize, boxH / this._maxLineUnit)
            : maxFontSize;
        let lo = minFontSize;

        let chosen: number;
        if (hi <= lo) {
            // Box shorter than one line even at the floor — give up at the floor
            // (same clamp as the can't-fit case).
            chosen = lo;
        } else if (fits(hi)) {
            // Current (or max) size already fits — no shrink.
            chosen = hi;
        } else {
            while (hi - lo > precision) {
                const mid = (lo + hi) / 2;
                if (fits(mid)) lo = mid;
                else hi = mid;
            }
            chosen = lo; // largest tested size that still fits
        }

        // Both mutations are intended and permanent: the wrap width keeps the
        // text fitted across later content changes.
        this.fontSize = chosen;
        this.maxWidth = boxW;
        if (this._dirty) this.rebuildText(); // so width/height/displayOrigin are current
        this.placeInBox(rect, options);
        return this;
    },

    /**
     * Position the fitted block inside `rect` using `hAlign`/`vAlign`. Only runs
     * when both `rect.x` and `rect.y` are given (a partial anchor is size-only,
     * with a dev-warn). Origin-robust: uses the scaled display size and current
     * origin, so any pre-existing user scale and arbitrary origin are respected.
     * Ignores rotation. Not part of the public `MSDFTextInstance` type.
     */
    placeInBox: function (rect: RectLike, options: FitOptions) {
        const hasX = rect.x !== undefined;
        const hasY = rect.y !== undefined;
        if (!hasX && !hasY) return; // size-only
        if (hasX !== hasY) {
            console.warn(
                '[MSDFText] fitInside: `x` and `y` must be provided together to ' +
                'place the block; ignoring the partial anchor (resize only).'
            );
            return;
        }

        const dw = this.displayWidth;  // width  * scaleX (respects user scale)
        const dh = this.displayHeight; // height * scaleY
        const hf = { left: 0, center: 0.5, right: 1 }[options.hAlign ?? 'left'];
        const vf = { top: 0, middle: 0.5, bottom: 1 }[options.vAlign ?? 'top'];
        this.x = (rect.x as number) + (rect.width - dw) * hf + this.displayOriginX;
        this.y = (rect.y as number) + (rect.height - dh) * vf + this.displayOriginY;
    },

    /**
     * In plain static mode the renderer reads object-level appearance fields
     * (colour, alpha, weight, outline, shadow) fresh each frame. But with
     * rich-text styles the per-glyph array is snapshotted (seeded once, like
     * manual mode), so any of those fields need a flagged coalesced re-seed
     * to propagate a live change under the styled runs.
     */
    _markAppearanceDirty: function () {
        if (this._hasAppearance) {
            this._stylesDirty = true;
        }
    },

    /**
     * Set text color. Accepts a 0xRRGGBB number, a hex/rgb string, or an
     * `{r, g, b, a?}` object (channels in 0-255). When provided, `alpha`
     * (0-1) overrides any alpha embedded in the color value.
     */
    setColor: function (color: ColorValue, alpha?: number) {
        const c = (Phaser.Display.Color.ValueToColor as any)(color);
        this._color = {
            r: c.redGL,
            g: c.greenGL,
            b: c.blueGL,
            a: alpha !== undefined ? alpha : c.alphaGL
        };
        this._markAppearanceDirty();
        return this;
    },

    /**
     * Set the faux-bold weight in distance-field units (chainable). See
     * {@link MSDFTextInstance.weight} — it never reflows, so the underlying
     * field can also be assigned or tweened directly.
     */
    setWeight: function (weight: number) {
        this.weight = weight;
        return this;
    },

    /**
     * Faux-bold weight in distance-field units. See
     * {@link MSDFTextInstance.weight}. A plain-looking field backed by an
     * accessor solely so it can flag the same coalesced re-seed as `color`.
     */
    weight: {
        get: function (this: any): number { return this._weight; },
        set: function (this: any, value: number) {
            this._weight = value;
            this._markAppearanceDirty();
        }
    },

    /**
     * Text color as a packed `0xRRGGBB` number.
     *
     * The getter recovers it from the stored color. The setter routes through
     * `setColor`, preserving the current color alpha — pass `setColor(color,
     * alpha)` to change the alpha too. Color is consumed directly at render
     * time, so changing it does not trigger a layout rebuild.
     */
    color: {
        get: function (this: any): number {
            const c = this._color;
            return (
                (Math.round(c.r * 255) << 16) |
                (Math.round(c.g * 255) << 8) |
                Math.round(c.b * 255)
            );
        },
        set: function (this: any, value: ColorValue) {
            this.setColor(value, this._color.a);
        }
    },

    /**
     * Line alignment for multi-line text: `'left'` (default), `'center'` or
     * `'right'`. See the `setLeftAlign` / `setCenterAlign` / `setRightAlign`
     * chainable helpers. Setting this triggers a rebuild on next render.
     */
    align: {
        get: function (this: any): MSDFAlign { return this._align; },
        set: function (this: any, value: MSDFAlign) {
            if (this._align !== value) {
                this._align = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Left-align each line of text (chainable). Only affects multi-line text.
     */
    setLeftAlign: function () {
        this.align = 'left';
        return this;
    },

    /**
     * Center-align each line of text (chainable). Only affects multi-line text.
     */
    setCenterAlign: function () {
        this.align = 'center';
        return this;
    },

    /**
     * Right-align each line of text (chainable). Only affects multi-line text.
     */
    setRightAlign: function () {
        this.align = 'right';
        return this;
    },

    /**
     * Extra horizontal space (in pixels) added between every character.
     * Can be negative to tighten spacing. Setting this triggers a rebuild
     * on next render.
     */
    letterSpacing: {
        get: function (this: any): number { return this._letterSpacing; },
        set: function (this: any, value: number) {
            if (this._letterSpacing !== value) {
                this._letterSpacing = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set letter spacing in pixels (chainable). Positive widens, negative tightens.
     */
    setLetterSpacing: function (spacing: number) {
        this.letterSpacing = spacing;
        return this;
    },

    /**
     * Line spacing. Setting this triggers a rebuild on next render.
     */
    lineSpacing: {
        get: function (this: any): number { return this._lineSpacing; },
        set: function (this: any, value: number) {
            if (this._lineSpacing !== value) {
                this._lineSpacing = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set line spacing (chainable)
     */
    setLineSpacing: function (spacing: number) {
        this.lineSpacing = spacing;
        return this;
    },

    /**
     * Maximum text width for word wrapping (0 = no wrapping).
     * Setting this triggers a rebuild on next render.
     */
    maxWidth: {
        get: function (this: any): number { return this._maxWidth; },
        set: function (this: any, value: number) {
            if (this._maxWidth !== value) {
                this._maxWidth = value;
                this._dirty = true;
            }
        }
    },

    /**
     * Set maximum text width for word wrapping (chainable)
     * @param width Maximum width in pixels (0 = no wrapping)
     */
    setMaxWidth: function (width: number) {
        this.maxWidth = width;
        return this;
    },

    /**
     * Set the per-frame display callback. It receives the per-glyph state array
     * (re-seeded to the text's defaults every frame) and the text object; mutate
     * glyphs in place. Passing `undefined` clears it (same as
     * {@link clearDisplayCallback}). Switches the text into callback mode,
     * overriding any prior manual control.
     */
    setDisplayCallback: function (callback: DisplayCallback | undefined) {
        this.displayCallback = callback;
        if (callback) {
            this._glyphMode = GLYPH_MODE_CALLBACK;
        } else if (this._glyphMode === GLYPH_MODE_CALLBACK) {
            this._glyphMode = GLYPH_MODE_STATIC;
        }
        return this;
    },

    /**
     * Clear the display callback. Returns to static mode if it was in callback
     * mode; leaves manual mode untouched.
     */
    clearDisplayCallback: function () {
        this.displayCallback = undefined;
        if (this._glyphMode === GLYPH_MODE_CALLBACK) {
            this._glyphMode = GLYPH_MODE_STATIC;
        }
        return this;
    },

    /**
     * The per-glyph state array (`null` in static mode). See
     * {@link MSDFTextInstance.glyphs}.
     */
    glyphs: {
        get: function (this: any): GlyphState[] | null {
            return this._glyphMode === GLYPH_MODE_STATIC ? null : this._glyphStates;
        }
    },

    /**
     * Set the per-frame decoration callback. See
     * {@link MSDFTextInstance.setDecorationCallback}.
     */
    setDecorationCallback: function (callback: DecorationCallback | undefined) {
        this.decorationCallback = callback;
        this._decorMode = callback ? DECOR_MODE_CALLBACK : DECOR_MODE_STATIC;
        return this;
    },

    /** Clear the decoration callback, returning the rects to their built state. */
    clearDecorationCallback: function () {
        this.decorationCallback = undefined;
        this._decorMode = DECOR_MODE_STATIC;
        return this;
    },

    /**
     * Set the per-character spacing callback. See
     * {@link MSDFTextInstance.setSpacingCallback}.
     *
     * There is no *mode* to switch here, unlike the other two callbacks: the pads
     * are a layout input, so the callback is simply the last layer of the two maps
     * `refreshStyleState` already rebuilds. Setting it therefore reflows exactly
     * when it changes the pads, and no more often.
     */
    setSpacingCallback: function (callback: SpacingCallback | undefined) {
        this.spacingCallback = callback;
        this.refreshStyleState();
        return this;
    },

    /** Clear the spacing callback; the pads fall back to the `space` keys alone. */
    clearSpacingCallback: function () {
        this.spacingCallback = undefined;
        this.refreshStyleState();
        return this;
    },

    /**
     * Re-run the spacing callback. Only needed when the callback's own inputs
     * changed and the text did not — a rebuild re-runs it anyway. Costs a relayout
     * if (and only if) it actually produces different pads.
     */
    refreshSpacing: function () {
        this.refreshStyleState();
        return this;
    },

    /**
     * The per-rect state array (`null` without a decoration callback). See
     * {@link MSDFTextInstance.decorations}.
     */
    decorations: {
        get: function (this: any): DecorationState[] | null {
            return this._decorMode === DECOR_MODE_STATIC ? null : this._decorStates;
        }
    },

    /**
     * Ensure the rect-state array matches the built rect count and seed every
     * entry from the rect it mirrors. Called by the renderer each frame in
     * decoration-callback mode, immediately before the callback runs.
     *
     * `_decorRects` is to `_characters` as this array is to `_glyphStates`: a
     * pristine built array, and a mutable per-frame copy of it. There is no manual
     * mode to complicate that — a rect is a merge artifact with no stable identity
     * across a rebuild, so nothing here is worth persisting (and, with a handful of
     * rects per text, nothing here is worth *not* re-seeding).
     */
    prepareDecorStates: function (): DecorationState[] {
        const rects = this._decorRects;
        const states: DecorationState[] = this._decorStates;
        const n = rects.length;

        while (states.length < n) {
            states.push(createDecorState());
        }
        if (states.length > n) {
            states.length = n;
        }

        // The object's live colour and per-corner alpha — what a rule that named
        // no colour of its own inherits. The static submit path resolves this per
        // rect as it goes; here it is resolved once, into the state, so a callback
        // never sees the "absent means inherit" sentinel.
        const cA = this._color.a;
        const baseRgb = this.color;
        const aTL = cA * this._alphaTL, aTR = cA * this._alphaTR;
        const aBL = cA * this._alphaBL, aBR = cA * this._alphaBR;
        const phase = this.dashPhase;

        for (let i = 0; i < n; i++) {
            this.seedRect(states[i], rects[i], baseRgb, aTL, aTR, aBL, aBR, phase);
        }
        return states;
    },

    /**
     * Seed one rect state from the rect the rebuild merged. Mirrors `seedGlyph`:
     * every "absent means inherit" is resolved here, so the callback sees final
     * values and the renderer reads the state back without a fallback of its own.
     */
    seedRect: function (
        s: DecorationState,
        r: any,
        baseRgb: number,
        aTL: number, aTR: number, aBL: number, aBR: number,
        phase: number
    ): void {
        (s as any).pass = r.pass;
        (s as any).line = r.line;
        (s as any).srcStart = r.srcStart;
        (s as any).srcEnd = r.srcEnd;
        (s as any).glyphStart = r.glyphStart;
        (s as any).glyphEnd = r.glyphEnd;
        (s as any).fontIdx = r.fontIdx;

        s.visible = true;
        s.x = r.x;
        s.y = r.y;
        s.w = r.w;
        s.h = r.h;
        s.scaleX = 1;
        s.scaleY = 1;
        s.rotation = 0;
        s.clearOffset();

        // Face colour / alpha: the rect's own, or the object's where it inherited.
        const rgb: Corners | undefined = r.rgb;
        const alpha: Corners | undefined = r.alpha;
        const col = s.color;
        col.topLeft = rgb ? rgb.topLeft : baseRgb;
        col.topRight = rgb ? rgb.topRight : baseRgb;
        col.bottomLeft = rgb ? rgb.bottomLeft : baseRgb;
        col.bottomRight = rgb ? rgb.bottomRight : baseRgb;
        const al = s.alpha;
        al.topLeft = alpha ? alpha.topLeft : aTL;
        al.topRight = alpha ? alpha.topRight : aTR;
        al.bottomLeft = alpha ? alpha.bottomLeft : aBL;
        al.bottomRight = alpha ? alpha.bottomRight : aBR;

        // The two-tone inner colour, read only where the face alpha is zero. A rule
        // has none, so it seeds the face colour and the ramp is an identity.
        const inner: Corners | undefined = r.inner;
        if (inner) copyCorners(s.innerColor, inner);
        else copyCorners(s.innerColor, col);

        const h: ResolvedHighlight | undefined = r.highlight;
        const dash: ResolvedDash | undefined = r.dash;

        if (h) {
            copyCorners(s.borderColor, h.borderColor);
            copyCorners(s.borderAlpha, h.borderAlpha);
            copyCorners(s.borderWidth, h.borderWidth);
            copyCorners(s.radius, h.radius);
            copyCorners(s.softness, h.softness);
            setCorners(s.dashDuty, 0.5);
        } else {
            // A rule: no ring. Its shape, if it has one, is its dash's — and a dash
            // is uniform across the rect, so it seeds all four corners alike.
            setCorners(s.borderColor, 0);
            setCorners(s.borderAlpha, 1);
            setCorners(s.borderWidth, 0);
            setCorners(s.radius, dash ? dash.radius : 0);
            setCorners(s.softness, dash ? dash.softness : 0);
            // Seeded even on a solid rule, so that switching `dashCount` on in a
            // callback yields an even dash rather than a hairline per cell.
            setCorners(s.dashDuty, dash ? dash.duty : 0.5);
        }

        s.dashCount = r.dashCount;
        s.dashPhase = phase;
    },

    /**
     * Consume a pending rebuild / re-seed before handing the glyph array to the
     * user. The array `editGlyphs` and `resetGlyphs` return is seeded *and*
     * styled by `prepareGlyphStates`, so a still-set `_stylesDirty` has nothing
     * left to apply to it — but the next render would honour the flag anyway,
     * re-seed over the user's fresh edits and emit a `'glyphsreset'` they never
     * asked for. Decorations are the one part of the pending work that a seed
     * doesn't cover, so they still run.
     */
    consumePendingStyles: function (): void {
        if (this._dirty) {
            this.rebuildText();          // clears _stylesDirty via refreshGlyphs
        } else if (this._stylesDirty) {
            this._stylesDirty = false;
            this.rebuildDecorations();
        }
    },

    /**
     * Take manual control of per-glyph state (chainable-returning the array).
     * See {@link MSDFTextInstance.editGlyphs}.
     */
    editGlyphs: function (): GlyphState[] {
        this.consumePendingStyles();
        this.displayCallback = undefined;
        this._glyphMode = GLYPH_MODE_MANUAL;
        return this.prepareGlyphStates();
    },

    /**
     * Re-seed the manual glyph array to the text's current defaults.
     */
    resetGlyphs: function () {
        if (this._glyphMode === GLYPH_MODE_MANUAL) {
            this.consumePendingStyles();
            this.prepareGlyphStates();
        }
        return this;
    },

    /**
     * Ensure the glyph-state array matches the renderable glyph count and seed
     * every entry to the text's current defaults. Used by the renderer each
     * frame in callback mode, and on rebuild/edit/reset in manual mode.
     */
    prepareGlyphStates: function (): GlyphState[] {
        const chars = this._characters;
        const states: GlyphState[] = this._glyphStates;
        const n = chars.length;

        while (states.length < n) {
            states.push(createGlyphState());
        }
        if (states.length > n) {
            states.length = n;
        }
        for (let i = 0; i < n; i++) {
            this.seedGlyph(states[i], chars[i], i);
        }
        // Rich-text styling overrides the seeded base, before any callback runs.
        if (this._hasAppearance) {
            this.applyStyleRuns(states);
        }
        return states;
    },

    /**
     * Layer the two style stores onto already-seeded glyph states, in paint
     * order — **segments → overlays**, overlays in creation order. Applied
     * key-by-key, so a later layer that sets only `outline` leaves an earlier
     * layer's `color` intact. Glyphs are matched to runs by `srcIndex` (source
     * position, wrap-independent).
     *
     * A run that carries only the structural `fontScale`/`font` is skipped: it is
     * already baked into the character quads by the layout pass, and scanning the
     * glyph array for it would cost a pass per frame to seed nothing.
     */
    applyStyleRuns: function (states: GlyphState[]): void {
        let shadow = false;
        const seg: StyleRun[] = this._segmentRuns;
        for (let r = 0; r < seg.length; r++) {
            const style = seg[r].style;
            if (!styleHasAppearanceKeys(style)) continue;
            shadow = shadow || styleHasShadowKeys(style);
            this.applyRun(states, seg[r].start, seg[r].length, style);
        }
        const overlays: StyleOverlay[] = this._overlays;
        for (let k = 0; k < overlays.length; k++) {
            const overlay = overlays[k];
            const runs = overlay.runs;
            if (runs.length === 0 || !styleHasAppearanceKeys(overlay.style)) continue;
            shadow = shadow || styleHasShadowKeys(overlay.style);
            for (let r = 0; r < runs.length; r++) {
                this.applyRun(states, runs[r].start, runs[r].length, overlay.style);
            }
        }
        // Cached for the renderer's shadow-pass gate: in per-glyph mode the pass
        // runs if any run sets a shadow, even without an object-level shadow.
        this._stylesHaveShadow = shadow;
    },

    /**
     * Apply one resolved style to every glyph whose `srcIndex` is in the span.
     *
     * The glyph array is strictly increasing in `srcIndex` — `rebuildText` walks
     * the wrapped string in order and never emits a quad for a newline, a space
     * or a character missing from its run's font — so a source span is a
     * *contiguous window*, not a scattered subset. Binary-search its first glyph
     * and stop at its last, rather than scanning the whole array per run: a
     * RegExp anchor can hold dozens of spans, and every one of them is walked on
     * every re-seed (per frame, in callback mode).
     */
    applyRun: function (states: GlyphState[], start: number, length: number, style: ResolvedStyle): void {
        const end = start + length;
        const n = states.length;

        // Lower bound: the first glyph with `srcIndex >= start`.
        let lo = 0, hi = n;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if ((states[mid] as any).srcIndex < start) lo = mid + 1;
            else hi = mid;
        }

        for (let i = lo; i < n; i++) {
            const g = states[i];
            if ((g as any).srcIndex >= end) break;
            applyStyleToGlyph(g, style);
        }
    },

    /**
     * Lazily apply a pending style change (set `_stylesDirty` by a handle, a
     * segment update or `clearStyles`). Coalesced to one re-seed per tick by the
     * flag. In callback mode the array is re-seeded every frame anyway, so this
     * only rebuilds the decorations; in manual/static+styles it also re-seeds the
     * persistent array (and, in manual mode, emits `'glyphsreset'` so edits can
     * re-apply). A structural change never lands here — it sets `_dirty` and
     * rebuilds.
     */
    applyStylesDirty: function (): void {
        this._stylesDirty = false;
        this.rebuildDecorations();
        if (this._glyphMode === GLYPH_MODE_CALLBACK) {
            return;
        }
        if (this._glyphMode === GLYPH_MODE_MANUAL || this._hasAppearance) {
            this.prepareGlyphStates();
            if (this._glyphMode === GLYPH_MODE_MANUAL) {
                this.emit('glyphsreset', this);
            }
        }
    },

    /**
     * Seed one glyph state with the text object's effective colour, alpha,
     * outline, shadow and layout position. Mirrors the static-mode resolution in
     * the renderer so callback/manual glyphs start from the same defaults.
     */
    seedGlyph: function (g: GlyphState, char: any, index: number): void {
        (g as any).index = index;
        (g as any).charCode = char.charCode || 0;
        (g as any).srcIndex = char.srcIndex;
        (g as any).line = char.line;
        (g as any).srcLine = char.srcLine;
        // Layout facts, readonly to the caller: a deform written as a field over
        // text space needs the quad's size and the glyph's em to place its corners.
        (g as any).width = char.w;
        (g as any).height = char.h;
        (g as any).em = char.em;
        (g as any).baselineOffset = char.baselineY - char.y;
        // The `space` pads this glyph rides, in px. Layout output here — the input
        // side is `StyleSpec.space` / `setSpacingCallback`. See `GlyphState.padBefore`.
        (g as any).padBefore = char.padBefore;
        (g as any).padAfter = char.padAfter;
        g.glyph = 0;
        g.visible = true;
        g.x = char.x;
        g.y = char.y;
        g.scaleX = 1;
        g.scaleY = 1;
        g.rotation = 0;
        g.skew = 0;
        g.skewPivot = 0;
        g.clearOffset();

        const w = g.weight, ow = this.weight;
        w.topLeft = w.topRight = w.bottomLeft = w.bottomRight = ow;

        const c = this._color;
        const cA = c.a;
        const aTL = cA * this._alphaTL, aTR = cA * this._alphaTR;
        const aBL = cA * this._alphaBL, aBR = cA * this._alphaBR;

        // Single base colour, applied to all four corners. Per-corner gradients
        // are the caller's to set after seeding (e.g. in a display callback).
        const rgb = this.color;
        const ft = g.fill.color, fa = g.fill.alpha;
        ft.topLeft = ft.topRight = ft.bottomLeft = ft.bottomRight = rgb;
        fa.topLeft = aTL; fa.topRight = aTR; fa.bottomLeft = aBL; fa.bottomRight = aBR;

        const st = g.shadow.color, sa = g.shadow.alpha;
        const sc = this.shadowColor;
        // Seed a base shadow only when the object itself has one. Without it,
        // glyphs get zero shadow alpha, so when the shadow pass runs for the sake
        // of a per-run / per-glyph shadow the untouched glyphs draw nothing.
        const sAlpha = this.hasShadow() ? this.shadowAlpha : 0;
        st.topLeft = st.topRight = st.bottomLeft = st.bottomRight = sc;
        sa.topLeft = sAlpha * this._alphaTL; sa.topRight = sAlpha * this._alphaTR;
        sa.bottomLeft = sAlpha * this._alphaBL; sa.bottomRight = sAlpha * this._alphaBR;
        // `-1` means "no ramp": seed the outer colour, so the shader's mix is an
        // identity and a glyph state never carries the sentinel.
        const sin = g.shadow.innerColor;
        const sInner = this._shadowInnerColor >= 0 ? this._shadowInnerColor : sc;
        sin.topLeft = sin.topRight = sin.bottomLeft = sin.bottomRight = sInner;
        g.shadow.x = this.shadowX;
        g.shadow.y = this.shadowY;
        const ss = g.shadow.softness, sSoft = this.shadowSoftness;
        ss.topLeft = ss.topRight = ss.bottomLeft = ss.bottomRight = sSoft;
        const ssp = g.shadow.spread, sSpread = this.shadowSpread;
        ssp.topLeft = ssp.topRight = ssp.bottomLeft = ssp.bottomRight = sSpread;
        const srd = g.shadow.rounded, sRound = this.shadowRounded;
        srd.topLeft = srd.topRight = srd.bottomLeft = srd.bottomRight = sRound;

        const ot = g.outline.color, oa = g.outline.alpha;
        const oc = this.outlineColor, oAlpha = this.outlineAlpha;
        ot.topLeft = ot.topRight = ot.bottomLeft = ot.bottomRight = oc;
        oa.topLeft = oAlpha * this._alphaTL; oa.topRight = oAlpha * this._alphaTR;
        oa.bottomLeft = oAlpha * this._alphaBL; oa.bottomRight = oAlpha * this._alphaBR;
        const oin = g.outline.innerColor;
        const oInner = this._outlineInnerColor >= 0 ? this._outlineInnerColor : oc;
        oin.topLeft = oin.topRight = oin.bottomLeft = oin.bottomRight = oInner;
        // A width of 0 (with no softness to give it a body) is what "no outline"
        // means to the shader, so seeding the object's values is all the gating
        // the renderer needs.
        const owd = g.outline.width, oWidth = this.outlineWidth;
        owd.topLeft = owd.topRight = owd.bottomLeft = owd.bottomRight = oWidth;
        // Rounding is continuous per corner; the object-level amount seeds it.
        const ord = g.outline.rounded, oRound = this.outlineRounded;
        ord.topLeft = ord.topRight = ord.bottomLeft = ord.bottomRight = oRound;
        const osf = g.outline.softness, oSoft = this.outlineSoftness;
        osf.topLeft = osf.topRight = osf.bottomLeft = osf.bottomRight = oSoft;
    },

    /**
     * Set the outline for the text (chainable convenience wrapper).
     *
     * The outline edge has no layout side effects, so the underlying
     * `outlineWidth`, `outlineColor`, `outlineAlpha`, `outlineRounded` and
     * `outlineSoftness` fields can also be assigned or tweened directly.
     *
     * The maximum representable outline is roughly half the font's
     * `distanceRange` (`pxRange`). Past that, the MSDF texture's distance
     * field is saturated and the outline stops growing, showing flat edges
     * around each glyph's atlas cell. For thicker outlines, regenerate the
     * font with a larger `-pxrange` (and matching glyph padding) rather than
     * raising `width` further.
     *
     * @param width   Outline width in distance field units.
     * @param color   Outline color (number, hex/rgb string, or {r,g,b,a?} object). Defaults to black.
     * @param alpha   Outline alpha (0-1). Defaults to 1.
     * @param rounded How far to round the outer corners off the true SDF: `0`
     *   (sharp, the default) to `1` (fully rounded), or the equivalent boolean.
     *   Intermediate values blend the two edges, so this is a continuous knob and
     *   tweens. Requires an MTSDF atlas; ignored with a one-time warning on a
     *   plain MSDF font.
     * @param layered Draw the outline as a separate silhouette pass under the
     *   fill so a thick outline does not overlap the neighbouring glyph. See
     *   {@link MSDFTextInstance.outlineLayered} for the cost and the
     *   transparent-text caveat. Defaults to `false`.
     * @param softness Blur the outline's outer edge, in distance-field units.
     *   Defaults to `0` (a crisp edge). The blur straddles the outline edge, so
     *   its inner half hides under the fill and only the outside softens — with
     *   `width` at `0` that is a glow hugging the letterform, drawn in the fill's
     *   own quad with no shadow pass. Requires an MTSDF atlas; ignored with a
     *   one-time warning on a plain MSDF font.
     */
    setOutline: function (width: number, color: ColorValue = 0x000000, alpha: number = 1, rounded: number | boolean = 0, layered: boolean = false, softness: number = 0) {
        this.outlineWidth = width;
        this.outlineColor = toColorInt(color);
        this.outlineAlpha = alpha;
        this.outlineRounded = rounded;
        this.outlineLayered = !!layered;
        this.outlineSoftness = Math.max(0, softness);
        if (this.outlineRounded > 0 && width > 0) {
            warnNeedsMtsdf(this, 'rounded outline');
        }
        if (this.outlineSoftness > 0) {
            warnNeedsMtsdf(this, 'soft outline');
        }
        return this;
    },

    /**
     * Give the outline a second colour at its inner edge (chainable) — it then
     * ramps from `outlineColor` at the outer edge to `color` where it meets the
     * glyph, across the outline band. A neon tube, a chalk outline, a bevel.
     *
     * Turning this on **forces `outlineLayered`**: the inner colour rides the
     * quad's fill-colour attribute, which a combined fill+outline quad has
     * already spent. See {@link MSDFTextInstance.outlineLayered} for what
     * layering costs.
     *
     * Pass `null` to go back to a single-colour outline. Works on plain MSDF
     * atlases — the ramp is measured across the outline width, not the true SDF.
     *
     * @param color Inner-edge colour, or `null` to inherit `outlineColor`.
     */
    setOutlineInnerColor: function (color: ColorValue | null) {
        this.outlineInnerColor = color === null ? -1 : toColorInt(color);
        return this;
    },

    /**
     * Clear the outline effect (chainable).
     */
    clearOutline: function () {
        this.outlineWidth = 0;
        this.outlineRounded = 0;
        this.outlineSoftness = 0;
        return this;
    },

    /**
     * Whether an outline is currently visible — it needs a body, which is either
     * a width or (for a zero-width glow) a softness.
     */
    hasOutline: function (): boolean {
        return this.outlineWidth > 0 || this.outlineSoftness > 0;
    },

    // Outline fields — plain-looking, but each is backed by an accessor purely
    // to flag the same coalesced re-seed as `color` when appearance styling is
    // active (see `_markAppearanceDirty`). `outlineLayered` needs none of this:
    // the renderer reads it live every frame instead of seeding it, so it stays
    // a genuine plain field.
    outlineWidth: {
        get: function (this: any): number { return this._outlineWidth; },
        set: function (this: any, value: number) {
            this._outlineWidth = value;
            this._markAppearanceDirty();
        }
    },
    outlineColor: {
        get: function (this: any): number { return this._outlineColor; },
        set: function (this: any, value: number) {
            this._outlineColor = value;
            this._markAppearanceDirty();
        }
    },
    outlineAlpha: {
        get: function (this: any): number { return this._outlineAlpha; },
        set: function (this: any, value: number) {
            this._outlineAlpha = value;
            this._markAppearanceDirty();
        }
    },
    // The setter is where a `rounded` amount is normalised, so everything
    // downstream — seeding, the static pack path, a tween reading it back — sees
    // a clean `0..1` and never a boolean.
    outlineRounded: {
        get: function (this: any): number { return this._outlineRounded; },
        set: function (this: any, value: number | boolean) {
            this._outlineRounded = toRoundedAmount(value);
            this._markAppearanceDirty();
        }
    },
    outlineSoftness: {
        get: function (this: any): number { return this._outlineSoftness; },
        set: function (this: any, value: number) {
            this._outlineSoftness = value;
            this._markAppearanceDirty();
        }
    },
    outlineInnerColor: {
        get: function (this: any): number { return this._outlineInnerColor; },
        set: function (this: any, value: number) {
            this._outlineInnerColor = value;
            this._markAppearanceDirty();
        }
    },

    /**
     * Set the drop shadow for the text (chainable convenience wrapper).
     *
     * The shadow has no layout side effects, so the underlying `shadowX`,
     * `shadowY`, `shadowColor`, `shadowAlpha`, `shadowSoftness`, `shadowSpread`
     * and `shadowRounded` fields can also be assigned or tweened directly.
     *
     * Called with no arguments, this resets the shadow to its defaults
     * (effectively clearing it).
     *
     * @param x        Shadow X offset in pixels. Defaults to 0.
     * @param y        Shadow Y offset in pixels. Defaults to 0.
     * @param color    Shadow color (number, hex/rgb string, or {r,g,b,a?} object). Defaults to black.
     * @param alpha    Shadow alpha (0-1). Defaults to 0.5.
     * @param softness Shadow blur in distance-field units — so it scales with
     *   the text, like outline width. Defaults to 0 (hard edge). Any value
     *   above 0 requires an MTSDF atlas; ignored with a one-time warning on a
     *   plain MSDF font. A soft shadow with zero offset reads as a glow. The
     *   maximum usable blur is the atlas `distanceRange`.
     * @param spread Dilate the shadow's silhouette *before* blurring it, in
     *   distance-field units — Photoshop's *spread* next to its *size*. Defaults
     *   to 0 (the shadow traces the glyph). This is how you fatten a shadow
     *   without mushing it, and the only way to reach a fat *hard* shadow; unlike
     *   softness it needs no MTSDF atlas, since it dilates the same field a thick
     *   outline does. See {@link MSDFTextInstance.shadowSpread} for its bounds.
     */
    setShadow: function (x: number = 0, y: number = 0, color: ColorValue = 0x000000, alpha: number = 0.5, softness: number = 0, spread: number = 0) {
        this.shadowX = x;
        this.shadowY = y;
        this.shadowColor = toColorInt(color);
        this.shadowAlpha = alpha;
        this.shadowSoftness = Math.max(0, softness);
        this.shadowSpread = Math.max(0, spread);
        if (this.shadowSoftness > 0) {
            warnNeedsMtsdf(this, 'soft shadow');
        }
        return this;
    },

    /**
     * Give the shadow a second colour at its inner edge (chainable) — it then
     * ramps from `shadowColor` at the outer edge of the blur to `color` where it
     * meets the glyph. A soft, zero-offset shadow with a hot inner colour is the
     * classic two-tone glow: a white core inside a coloured halo.
     *
     * Unlike the outline's, this needs no layering — a shadow quad never has a
     * fill, so its colour attribute is always free. The ramp spans the blur, so
     * with `shadowSoftness` at `0` there is nothing to ramp across and the inner
     * colour simply wins.
     *
     * @param color Inner-edge colour, or `null` to inherit `shadowColor`.
     */
    setShadowInnerColor: function (color: ColorValue | null) {
        this.shadowInnerColor = color === null ? -1 : toColorInt(color);
        return this;
    },

    /**
     * Clear the drop shadow effect (chainable). Resets the offset, softness and
     * spread; leaves color and alpha so a later `setShadow` reuses them.
     */
    clearShadow: function () {
        this.shadowX = 0;
        this.shadowY = 0;
        this.shadowSoftness = 0;
        this.shadowSpread = 0;
        return this;
    },

    /**
     * Whether a drop shadow is currently visible — it needs a body, which is an
     * offset, a softness or a spread. (A shadow with none of the three is the
     * glyph's own silhouette, exactly covered by the fill drawn on top of it.)
     */
    hasShadow: function (): boolean {
        return this.shadowX !== 0 || this.shadowY !== 0 ||
            this.shadowSoftness > 0 || this.shadowSpread > 0;
    },

    // Shadow fields — same accessor-for-a-dirty-flag treatment as the outline
    // fields above.
    shadowX: {
        get: function (this: any): number { return this._shadowX; },
        set: function (this: any, value: number) {
            this._shadowX = value;
            this._markAppearanceDirty();
        }
    },
    shadowY: {
        get: function (this: any): number { return this._shadowY; },
        set: function (this: any, value: number) {
            this._shadowY = value;
            this._markAppearanceDirty();
        }
    },
    shadowColor: {
        get: function (this: any): number { return this._shadowColor; },
        set: function (this: any, value: number) {
            this._shadowColor = value;
            this._markAppearanceDirty();
        }
    },
    shadowAlpha: {
        get: function (this: any): number { return this._shadowAlpha; },
        set: function (this: any, value: number) {
            this._shadowAlpha = value;
            this._markAppearanceDirty();
        }
    },
    shadowSoftness: {
        get: function (this: any): number { return this._shadowSoftness; },
        set: function (this: any, value: number) {
            this._shadowSoftness = value;
            this._markAppearanceDirty();
        }
    },
    shadowSpread: {
        get: function (this: any): number { return this._shadowSpread; },
        set: function (this: any, value: number) {
            this._shadowSpread = value;
            this._markAppearanceDirty();
        }
    },
    shadowRounded: {
        get: function (this: any): number { return this._shadowRounded; },
        set: function (this: any, value: number | boolean) {
            this._shadowRounded = toRoundedAmount(value);
            this._markAppearanceDirty();
        }
    },
    shadowInnerColor: {
        get: function (this: any): number { return this._shadowInnerColor; },
        set: function (this: any, value: number) {
            this._shadowInnerColor = value;
            this._markAppearanceDirty();
        }
    },

    // ========================================================================
    // Decorations (highlight / underline / strikethrough)
    // ========================================================================

    /**
     * Underline the whole text (chainable). See
     * {@link MSDFTextInstance.setUnderline}.
     */
    setUnderline: function (enable: boolean | DecorationSpec) {
        this._underline = resolveDecoration(enable) ?? null;
        this.refreshStyleState();
        this._stylesDirty = true;
        return this;
    },

    /**
     * Paint a highlight pill behind the whole text (chainable). See
     * {@link MSDFTextInstance.setHighlight}.
     */
    setHighlight: function (enable: boolean | HighlightSpec) {
        this._highlight = resolveHighlight(enable) ?? null;
        this.refreshStyleState();
        this._stylesDirty = true;
        return this;
    },

    /**
     * Strike the whole text through (chainable). See
     * {@link MSDFTextInstance.setStrikethrough}.
     */
    setStrikethrough: function (enable: boolean | DecorationSpec) {
        this._strikethrough = resolveDecoration(enable) ?? null;
        this.refreshStyleState();
        this._stylesDirty = true;
        return this;
    },

    /**
     * Resolve every source character's decoration (and the colour it would
     * inherit) through the normal paint order — object level, then segments, then
     * overlays — then merge consecutive decorated characters into rects.
     *
     * Reads `_characters`, so it must run *after* layout; it is called from the
     * same coalesced pass that seeds styles, and needs no dirty flag of its own.
     * Rects deliberately live outside `_characters`: the glyph-state array,
     * `editGlyphs()` and every per-glyph loop assume one quad per renderable
     * character and must never see a rect.
     */
    rebuildDecorations: function (): void {
        const rects = this._decorRects;
        rects.length = 0;
        if (!this._hasDecorations || this._characters.length === 0) return;

        const n = this._text.length;
        const under: (ResolvedDecoration | null)[] = new Array(n).fill(this._underline);
        const strike: (ResolvedDecoration | null)[] = new Array(n).fill(this._strikethrough);
        const high: (ResolvedHighlight | null)[] = new Array(n).fill(this._highlight);
        // Which resolved style (if any) supplied each character's fill colour /
        // alpha. Reference identity is a sound proxy for "same colour run": two
        // characters sharing a source object certainly share a colour. Two that
        // don't may still match, which only costs an extra rect.
        const colorSrc: (Corners | undefined)[] = new Array(n);
        const alphaSrc: (Corners | undefined)[] = new Array(n);

        const paint = (start: number, length: number, style: ResolvedStyle): void => {
            const end = Math.min(start + length, n);
            for (let i = Math.max(0, start); i < end; i++) {
                if (style.underline !== undefined) under[i] = style.underline;
                if (style.strikethrough !== undefined) strike[i] = style.strikethrough;
                if (style.highlight !== undefined) high[i] = style.highlight;
                if (style.fillColor !== undefined) colorSrc[i] = style.fillColor;
                if (style.fillAlpha !== undefined) alphaSrc[i] = style.fillAlpha;
            }
        };

        const segs: StyleRun[] = this._segmentRuns;
        for (let i = 0; i < segs.length; i++) paint(segs[i].start, segs[i].length, segs[i].style);
        const overlays: StyleOverlay[] = this._overlays;
        for (let k = 0; k < overlays.length; k++) {
            const runs = overlays[k].runs;
            for (let r = 0; r < runs.length; r++) paint(runs[r].start, runs[r].length, overlays[k].style);
        }

        this.buildHighlightRects(high);
        this.buildDecorRects(under, colorSrc, alphaSrc, PASS_UNDERLINE);
        this.buildDecorRects(strike, colorSrc, alphaSrc, PASS_STRIKE);
    },

    /**
     * Merge the decorated characters of one lane into rects, splitting at:
     * visual line boundaries; `fontScale` **and** `font` boundaries (thickness
     * and position are size- and font-relative, so each segment uses its own
     * metrics, like a browser across font-size spans); and — only when the colour
     * is inherited — resolved fill colour/alpha changes, so each coloured word's
     * rule matches it.
     *
     * The X extent is the union of the segment's glyph quads. Spaces have no
     * entry in `_characters`, so the union bridges interior gaps but leading and
     * trailing spaces never extend a rect.
     */
    buildDecorRects: function (
        specs: (ResolvedDecoration | null)[],
        colorSrc: (Corners | undefined)[],
        alphaSrc: (Corners | undefined)[],
        pass: number
    ): void {
        const chars = this._characters;
        const scales: Float32Array | null = this._sizeScales;
        const runFonts: MSDFFont[] = this._runFonts;
        const rects = this._decorRects;
        const over = pass === PASS_STRIKE;

        let i = 0;
        while (i < chars.length) {
            const first = chars[i];
            const spec = specs[first.srcIndex];
            if (!spec) { i++; continue; }

            const line = first.line;
            const scale = scales ? scales[first.srcIndex] : 1;
            const fontIdx = first.fontIdx;
            const cs = colorSrc[first.srcIndex];
            const as = alphaSrc[first.srcIndex];
            let x0 = first.x;
            let x1 = first.x + first.w;

            let j = i + 1;
            for (; j < chars.length; j++) {
                const c = chars[j];
                const si = c.srcIndex;
                if (specs[si] !== spec || c.line !== line) break;
                if ((scales ? scales[si] : 1) !== scale) break;
                if (c.fontIdx !== fontIdx) break;
                if (spec.color === undefined && colorSrc[si] !== cs) break;
                if (spec.alpha === undefined && alphaSrc[si] !== as) break;
                if (c.x < x0) x0 = c.x;
                if (c.x + c.w > x1) x1 = c.x + c.w;
            }

            // Underline position and thickness come from the run's own font.
            const data = runFonts[fontIdx].data;
            const thicknessEm = data.underlineThickness > 0 ? data.underlineThickness : 0.05;
            const size = this._fontSize * scale;
            const h = thicknessEm * size * spec.thickness;
            // msdf-atlas-gen emits no strike metric (and no x-height), so the
            // strike sits at a fixed -0.25 em; `offset` is the tuning knob.
            const centre = over
                ? (-0.25 + spec.offset) * size
                : (data.underlineY + spec.offset) * size;

            if (h > 0 && x1 > x0) {
                // A dashed rule spans one unit of U per dash rather than 0..1, so
                // the count is the whole of what the shader needs to fold the rect
                // into cells — no vertex byte, and the phase slides for free at
                // submit. Round it, so a rule always fits a whole number of dashes
                // and therefore begins and ends the same way; the period stretches
                // by up to half a dash to pay for that, and a rule too short for
                // one and a half periods becomes a single centred dash.
                const dash = spec.dash;
                const period = dash ? dash.period * size : 0;
                const dashCount = period > 0 ? Math.max(1, Math.round((x1 - x0) / period)) : 0;

                rects.push({
                    x: x0,
                    y: first.baselineY + centre - h / 2,
                    w: x1 - x0,
                    h: h,
                    pass: pass,
                    // A rect samples no atlas (it is `solid`), but riding its own
                    // run's texture keeps it inside that run's draw call.
                    fontIdx: fontIdx,
                    // `undefined` means "inherit the object's live colour/alpha",
                    // which the renderer resolves per frame — so tweening the
                    // text's colour drags an inherited underline along with it.
                    rgb: spec.color !== undefined ? spec.color : cs,
                    alpha: spec.alpha !== undefined ? spec.alpha : as,
                    // A rule takes no border and no two-tone ramp; the renderer
                    // substitutes its constant defaults. Named anyway so both rect
                    // kinds share one hidden class.
                    inner: undefined,
                    border: undefined,
                    // A solid rule is the constant hard-edged box, so it packs
                    // nothing. A dashed one carries the dash's own shape.
                    params: dashCount > 0 ? (dash as ResolvedDash).params : undefined,
                    dashCount: dashCount,
                    // Provenance, for the decoration callback. The glyph window is
                    // free: `i`/`j` are already bracketing exactly the characters
                    // this rect was merged from, so a callback that follows its own
                    // glyphs indexes straight into the array instead of searching.
                    line: line,
                    srcStart: first.srcIndex,
                    srcEnd: chars[j - 1].srcIndex + 1,
                    glyphStart: i,
                    glyphEnd: j,
                    // The shape a state is seeded from. A rule's lives on its dash
                    // (or nowhere, for a plain box); a pill's is the spec itself.
                    highlight: undefined,
                    dash: dashCount > 0 ? (dash as ResolvedDash) : undefined
                });
            }
            i = j;
        }
    },

    /**
     * Merge the highlighted characters into pill rects, one per visual line.
     *
     * Simpler than {@link buildDecorRects} in two ways. A highlight never inherits
     * the fill colour — a slab of text-coloured paint behind the text would hide
     * it — so there is no colour-change split. And its geometry is a *union*
     * rather than a per-run metric: the vertical extent takes the highest ascender
     * and deepest descender among the characters it covers, so a pill wraps a run
     * of mixed sizes and mixed fonts as one shape instead of shattering at every
     * boundary. Only a line break, or a different resolved spec, starts a new rect.
     *
     * The pill's radius, border and softness are packed here, once, into the
     * `solid` params the shader reads as a rounded-box SDF over the rect's own
     * `0..1` UVs — the same three bytes a glyph spends on rounding, outline width
     * and shadow softness, which a `solid` quad has no use for.
     */
    buildHighlightRects: function (specs: (ResolvedHighlight | null)[]): void {
        const chars = this._characters;
        const scales: Float32Array | null = this._sizeScales;
        const runFonts: MSDFFont[] = this._runFonts;
        const rects = this._decorRects;
        const em = this._fontSize;

        let i = 0;
        while (i < chars.length) {
            const first = chars[i];
            const spec = specs[first.srcIndex];
            if (!spec) { i++; continue; }

            const line = first.line;
            const baselineY = first.baselineY;
            let x0 = first.x;
            let x1 = first.x + first.w;
            // Ascender is negative in Y-down (above the baseline), descender
            // positive. Union them over the run so mixed sizes share one pill.
            let top = Infinity;
            let bottom = -Infinity;

            let j = i;
            for (; j < chars.length; j++) {
                const c = chars[j];
                if (specs[c.srcIndex] !== spec || c.line !== line) break;
                if (c.x < x0) x0 = c.x;
                if (c.x + c.w > x1) x1 = c.x + c.w;

                const data = runFonts[c.fontIdx].data;
                const size = em * (scales ? scales[c.srcIndex] : 1);
                const t = baselineY + data.ascender * size;
                const b = baselineY + data.descender * size;
                if (t < top) top = t;
                if (b > bottom) bottom = b;
            }

            // Padding is em-relative to the *object's* size, not the run's, so a
            // pill around a mixed-size run keeps one even margin.
            x0 -= spec.padLeft * em;
            x1 += spec.padRight * em;
            top -= spec.padTop * em;
            bottom += spec.padBottom * em;

            if (x1 > x0 && bottom > top) {
                rects.push({
                    x: x0,
                    y: top,
                    w: x1 - x0,
                    h: bottom - top,
                    pass: PASS_HIGHLIGHT,
                    fontIdx: first.fontIdx,
                    rgb: spec.color,
                    alpha: spec.alpha,
                    // Read only where the face alpha is a zero byte, which is both
                    // "no face" and "this rgb is the border ramp's inner end".
                    inner: spec.innerColor,
                    border: packBorder(spec),
                    params: packPillParams(spec),
                    // A pill is never dashed — the byte a dash spends on its duty
                    // cycle is the pill's border width. Named so both rect kinds
                    // share one hidden class.
                    dashCount: 0,
                    // Provenance + the shape a state is seeded from; see the note
                    // in `buildDecorRects`.
                    line: line,
                    srcStart: first.srcIndex,
                    srcEnd: chars[j - 1].srcIndex + 1,
                    glyphStart: i,
                    glyphEnd: j,
                    highlight: spec,
                    dash: undefined
                });
            }
            i = j;
        }
    },

    // ========================================================================
    // Rich-text styling
    // ========================================================================

    /**
     * Set styled text from structured segments. See
     * {@link MSDFTextInstance.setRichText}.
     */
    setRichText: function (segments: Segment[]) {
        let text = '';
        const runs: StyleRun[] = [];

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            if (typeof seg === 'string') {
                text += seg;
                continue;
            }
            const start = text.length;
            const t = seg.text != null ? String(seg.text) : '';
            text += t;
            // A run is kept when it paints something *or* when it is named: a
            // named-but-unstyled segment exists purely so `{ segment: id }` can
            // find it. Its style is empty, so every paint loop skips it anyway —
            // the elision below is only about not allocating for anonymous,
            // unstyled strings, which are the common case.
            const named = typeof seg.id === 'string' && seg.id.length > 0;
            if (t.length > 0 && (named || hasStyleKeys(seg))) {
                const run: StyleRun = { start, length: t.length, style: resolveStyle(seg) };
                if (named) run.id = seg.id;
                runs.push(run);
            }
        }

        // Segments replace the content layer wholesale. Position-anchored overlays
        // drop with it — even when the concatenated string happens to be identical,
        // the content they were indexed against is not the content they now cover.
        const changed = text !== this._text;
        this._segmentRuns = runs;
        if (changed) {
            this._text = text;
            this._dirty = true;
            this.onTextChanged(text);      // re-derive/drop overlays, dirty flags
            this.updateDisplayOrigin();
        } else {
            // Same concatenated text ⇒ skip relayout; the content anchors would
            // re-derive to exactly what they hold, so `onTextChanged`'s loop is
            // spent only on dropping the position-anchored overlays.
            this.onTextChanged(text);
            if (this._dirty) this.updateDisplayOrigin();
        }
        return this;
    },

    /**
     * Add a style overlay over the current content. See
     * {@link MSDFTextInstance.addStyle}.
     */
    addStyle: function (target: StyleTarget, style: StyleSpec) {
        const anchor = resolveTarget(target);
        const overlay: StyleOverlay = {
            anchor,
            style: resolveStyle(style),
            runs: deriveRuns(anchor, this._text, this._segmentRuns),
            dead: false
        };
        this._overlays.push(overlay);
        this.refreshStyleState();
        this._stylesDirty = true;
        return this.makeStyleHandle(overlay);
    },

    /**
     * Remove every overlay. See {@link MSDFTextInstance.clearStyles}.
     */
    clearStyles: function () {
        const overlays: StyleOverlay[] = this._overlays;
        for (let i = 0; i < overlays.length; i++) overlays[i].dead = true;
        overlays.length = 0;
        // Segments are content, not overlays — left intact.
        this.refreshStyleState();
        this._stylesDirty = true;
        return this;
    },

    /**
     * Build the {@link StyleHandle} for one overlay. `dead` is set by `remove`,
     * by `clearStyles`, and by a text change that dropped a position-anchored
     * overlay — one flag for all three, since to a caller they are the same event.
     *
     * `update` replaces the style. When it changes a structural key,
     * `refreshStyleState` sees the map move and routes the update to a rebuild
     * instead of a re-seed; that is the honest cost of a structural overlay, and
     * the same call stays cheap for an appearance-only style.
     */
    makeStyleHandle: function (overlay: StyleOverlay): StyleHandle {
        const self = this;
        return {
            update(style: StyleSpec): void {
                if (overlay.dead) { self.warnDeadHandle(); return; }
                overlay.style = resolveStyle(style);
                self.refreshStyleState();
                self._stylesDirty = true;
            },
            remove(): void {
                if (overlay.dead) return;
                overlay.dead = true;
                const i = self._overlays.indexOf(overlay);
                if (i >= 0) self._overlays.splice(i, 1);
                self.refreshStyleState();
                self._stylesDirty = true;
            }
        };
    },

    /** One-time dev warning when a dead style handle is used. */
    warnDeadHandle: function (): void {
        if (!this._deadHandleWarned) {
            this._deadHandleWarned = true;
            console.warn(
                '[MSDFText] A style handle was used after it was removed, after ' +
                'clearStyles, or after a text change dropped its position-anchored ' +
                'overlay; the call is ignored. Re-add the style against the current ' +
                'text, or anchor it to content (a string, RegExp or matcher) so it ' +
                'survives text changes.'
            );
        }
    },

    // ========================================================================
    // Measurement
    // ========================================================================

    /**
     * The width of the rendered text in local space (excludes scale).
     */
    width: {
        get: function (this: any): number {
            if (this._dirty) {
                this.rebuildText();
            }
            return this._width;
        }
    },

    /**
     * The height of the rendered text in local space (excludes scale).
     */
    height: {
        get: function (this: any): number {
            if (this._dirty) {
                this.rebuildText();
            }
            return this._height;
        }
    },

    /**
     * The displayed width of this text, taking the scale factor into account.
     * Setting this adjusts `scaleX` so the rendered width matches the value.
     */
    displayWidth: {
        get: function (this: any): number {
            return this.width * this.scaleX;
        },
        set: function (this: any, value: number) {
            this.scaleX = this.width === 0 ? 1 : value / this.width;
        }
    },

    /**
     * The displayed height of this text, taking the scale factor into account.
     * Setting this adjusts `scaleY` so the rendered height matches the value.
     */
    displayHeight: {
        get: function (this: any): number {
            return this.height * this.scaleY;
        },
        set: function (this: any, value: number) {
            this.scaleY = this.height === 0 ? 1 : value / this.height;
        }
    },

    /**
     * Per-line layout, as the last rebuild resolved it. See
     * {@link MSDFTextInstance.lines}.
     */
    lines: {
        get: function (this: any): LineInfo[] {
            if (this._dirty) {
                this.rebuildText();
            }
            return this._lines;
        }
    },

    /**
     * Get detailed text bounds including per-line information.
     *
     * Reads the layout the last rebuild cached rather than re-wrapping and
     * re-measuring the text, which is what it used to do on every call — a full
     * word-wrap plus a kerned pass over every character, from a method whose
     * natural home is a per-frame display callback. {@link lines} is the
     * allocation-free version of the same data; this stays for the snapshot shape.
     */
    getTextBounds: function () {
        if (this._dirty) {
            this.rebuildText();
        }

        const lines: LineInfo[] = this._lines;
        const lengths: number[] = new Array(lines.length);
        for (let i = 0; i < lines.length; i++) {
            lengths[i] = lines[i].width;
        }

        return {
            width: this._width,
            height: this._height,
            lines: {
                count: lines.length,
                lengths: lengths,
                shortest: this._shortestLine,
                longest: this._width
            }
        };
    },

    // ========================================================================
    // Rendering
    // ========================================================================

    /**
     * Word wrap text to fit within `maxWidth`, returning the wrapped string plus
     * a parallel source-index map (see {@link wrapLines} for the map contract).
     * Thin adapter that feeds the pure wrapper the object's current wrap char,
     * letter spacing, and per-run font/size maps. Not part of the public
     * `MSDFTextInstance` type.
     *
     * Those maps are indexed by position in `this._text`, so they are only handed
     * over when `text` *is* that string — an arbitrary string passed through the
     * legacy `wrapText` would index them out of alignment.
     */
    computeWrap: function (text: string, maxWidth: number, fontSize: number): { text: string; srcIndex: number[] } {
        const runs = text === this._text ? this.sourceRuns() : uniformRuns(this.fontData);
        return wrapLines(text, maxWidth, fontSize, this.wordWrapCharCode, this._letterSpacing, runs);
    },

    /**
     * Back-compat thin wrapper over {@link computeWrap} returning just the
     * wrapped string, measured at the current font size. Not part of the public
     * `MSDFTextInstance` type.
     */
    wrapText: function (text: string, maxWidth: number): string {
        return this.computeWrap(text, maxWidth, this._fontSize).text;
    },

    /**
     * Rebuild character layout data
     * This calculates positions and UVs for all characters but doesn't create GameObjects
     */
    rebuildText: function () {
        // Clear existing character data
        this.clearCharacters();

        if (!this._text || this._text.length === 0) {
            this._width = 0;
            this._height = 0;
            this._lines.length = 0;
            this._shortestLine = 0;
            this._dirty = false;
            this.updateDisplayOrigin();
            this.refreshGlyphs();
            return;
        }

        // Apply word wrapping (a no-op identity map when maxWidth <= 0). `srcMap`
        // is parallel to `textToRender`: srcMap[i] is character i's index in the
        // original text, or -1 for a wrap-inserted (soft) newline.
        const wrap = this.computeWrap(this._text, this._maxWidth, this._fontSize);
        const textToRender = wrap.text;
        const srcMap = wrap.srcIndex;

        // Per-run fonts and size multipliers, re-indexed onto the wrapped string
        // (both `null` inside `runs` on the uniform fast path).
        const runs = this.wrappedRuns(srcMap);
        const scales = runs.scales as Float32Array | null;
        const fontIdxs = runs.fonts as Uint8Array | null;
        const padBefore = runs.padBefore as Float32Array | null;
        const padAfter = runs.padAfter as Float32Array | null;
        const runFonts: MSDFFont[] = this._runFonts;

        // Measure first: with per-run sizes and fonts a line's height and baseline
        // depend on the largest metric *anywhere on that line*, which is only known
        // once the whole line has been seen. `lineData.baselines[i]` is that
        // resolved baseline, so the glyph loop below places every glyph on it —
        // mixed-size and mixed-font runs align by baseline, not by top. It also
        // drives alignment.
        const lineData = measureLines(
            textToRender, this._fontSize, this._lineSpacing, this._letterSpacing, runs
        );

        // Layout characters. y = 0 is the top of the text block (matching BitmapText).
        let cursorX = 0;
        let lineIndex = 0;    // visual line (soft + hard breaks)
        let srcLineIndex = 0; // source paragraph (hard breaks only)
        let baselineY = lineData.baselines[0];
        let prevCharCode = 0;
        let prevScale = 1;
        let prevFontIdx = 0;

        for (let i = 0; i < textToRender.length; i++) {
            const charCode = textToRender.charCodeAt(i);

            // Handle newlines
            if (charCode === 10) { // '\n'
                cursorX = 0;
                lineIndex++;
                baselineY = lineData.baselines[lineIndex];
                // Soft (inserted) breaks carry -1; only original newlines advance srcLine.
                if (srcMap[i] !== -1) srcLineIndex++;
                prevCharCode = 0;
                continue;
            }

            // This character's font: its run's, never the object's. A character
            // absent from it is skipped rather than borrowed from another font.
            const fontIdx = fontIdxs ? fontIdxs[i] : 0;
            const font = fontIdxs ? runFonts[fontIdx] : this.fontData;

            const char = font.getChar(charCode);
            if (!char) {
                // Character not in font
                prevCharCode = 0;
                continue;
            }

            // This character's size: the object's fontSize times its run's multiplier.
            const scale = scales ? scales[i] : 1;
            const size = this._fontSize * scale;

            // Apply kerning — within a same-font, same-size run only. A kern pair
            // straddling a size change has no well-defined size to scale by, and
            // one straddling a font change does not exist. Measurement and wrap
            // make the identical call, or wrapped lines would mismeasure.
            if (prevCharCode !== 0 && scale === prevScale && fontIdx === prevFontIdx) {
                const kerning = font.getKerning(prevCharCode, charCode);
                cursorX += kerning * size;
            }

            // The `space` pads bracket this character's advance, in em of its own
            // size. `padB` moves the pen *before* the glyph is placed, so it shifts
            // this glyph and every one after it; `padA` only shifts what follows.
            // Both ride the advance, inside the same "found in this run's font"
            // guard the measure and wrap passes use — that is what keeps the three
            // in step (see `MSDFMeasure`).
            const padB = padBefore ? padBefore[i] * size : 0;
            const padA = padAfter ? padAfter[i] * size : 0;
            cursorX += padB;

            // Skip rendering for space (but still advance)
            if (charCode === 32) {
                cursorX += char.xAdvance * size + this._letterSpacing + padA;
                prevCharCode = charCode;
                prevScale = scale;
                prevFontIdx = fontIdx;
                continue;
            }

            // Calculate character position (using normalized offsets scaled by the
            // character's size). charY hangs off the line's shared baseline by the
            // glyph's own baseline-relative offset.
            const charX = cursorX + char.xOffset * size;
            const charY = baselineY + char.yOffset * size;

            // Calculate character size (using normalized dimensions scaled by size)
            const charWidth = char.normalizedWidth * size;
            const charHeight = char.normalizedHeight * size;

            // Store character layout data (no GameObject creation!)
            // NOTE: UV coordinates in MSDFFont are pre-flipped for Phaser's Shader GameObject.
            // For batched rendering we need to swap v0 and v1 to correct the orientation.
            this._characters.push({
                x: charX,
                y: charY,
                w: charWidth,
                h: charHeight,
                // The pen, not the quad: `x` already has this glyph's own left
                // bearing folded in, and a *substituted* glyph (GlyphState.glyph)
                // has a different one. Keeping the pen is what lets the renderer
                // draw another letterform in this slot without moving the slot.
                penX: cursorX,
                u0: char.u0,
                v0: char.v1,  // Swap v0 and v1 to flip orientation
                u1: char.u1,
                v1: char.v0,   // Swap v0 and v1 to flip orientation
                charCode: charCode,           // Store for seeding GlyphState
                line: lineIndex,              // Visual line index, used by applyAlignment + provenance
                srcIndex: srcMap[i],          // Index into the original text (provenance)
                srcLine: srcLineIndex,        // Source paragraph index (provenance)
                baselineY: baselineY,         // Layout baseline (used by the skew feature)
                em: size,                     // This char's effective font size — the unit a
                                              // skew pivot and a per-corner deform are measured in
                padBefore: padB,              // The `space` pads this glyph rides, in px —
                padAfter: padA,               // layout facts a display callback may read
                fontIdx: fontIdx              // Slot in `_runFonts` — the renderer's texture + unitRange
            });

            // Advance cursor (letter spacing applies after every character, and is
            // a constant pixel amount — it does not scale with the run's size; the
            // `space` pad, being em-relative, does)
            cursorX += char.xAdvance * size + this._letterSpacing + padA;
            prevCharCode = charCode;
            prevScale = scale;
            prevFontIdx = fontIdx;
        }

        // Cache local bounds.
        // Clear dirty BEFORE updateDisplayOrigin so the width/height getters
        // it reads don't re-enter rebuildText.
        this._width = lineData.totalWidth;
        this._height = lineData.totalHeight;
        this._shortestLine = lineData.shortest;

        // Keep the per-line layout the measure pass just produced, and apply
        // alignment from it — a line's alignment inset *is* its `x`, so the two
        // come from one place rather than repeating the formula.
        this.buildLineInfo(lineData);
        this.applyAlignment();

        this._dirty = false;
        this.updateDisplayOrigin();
        this.refreshGlyphs();
    },

    /**
     * After a rebuild, re-seed the persistent glyph array for the fresh glyph
     * set. Fires in **manual** mode (and emits `'glyphsreset'` so listeners can
     * re-apply the edits the rebuild discarded) and whenever rich-text styles
     * are present (so a no-callback styled text has its styled array ready).
     * Callback mode re-seeds every frame instead, so it is skipped here. Clears
     * `_stylesDirty` since the array is now freshly seeded + styled. Decoration
     * rects are rebuilt in every mode — they read the fresh `_characters`.
     */
    refreshGlyphs: function (): void {
        this._stylesDirty = false;
        this.rebuildDecorations();
        if (this._glyphMode === GLYPH_MODE_CALLBACK) {
            return;
        }
        if (this._glyphMode === GLYPH_MODE_MANUAL || this._hasAppearance) {
            this.prepareGlyphStates();
            if (this._glyphMode === GLYPH_MODE_MANUAL) {
                this.emit('glyphsreset', this);
            }
        }
    },

    /**
     * Retain the per-line layout the measure pass produced, resolving each line's
     * alignment inset into its `x`. Everything here was already computed to lay
     * the glyphs out; keeping it is what makes {@link lines} — and therefore a
     * per-frame field over text space — cost nothing to read.
     *
     * Not part of the public `MSDFTextInstance` type.
     */
    buildLineInfo: function (lineData: LineMeasurement): void {
        const lines: LineInfo[] = this._lines;
        const longest = lineData.totalWidth;
        const align = this._align;

        lines.length = 0;
        for (let i = 0; i < lineData.widths.length; i++) {
            const width = lineData.widths[i];
            const baselineY = lineData.baselines[i];
            const top = baselineY - lineData.ascents[i];

            let x = 0;
            if (align === 'center') {
                x = (longest - width) / 2;
            } else if (align === 'right') {
                x = longest - width;
            }

            lines.push({
                index: i,
                x: x,
                width: width,
                top: top,
                baselineY: baselineY,
                bottom: top + lineData.heights[i]
            });
        }
    },

    /**
     * Apply text alignment to character positions.
     *
     * Matches BitmapText: the text block's left edge always stays at x = 0,
     * and alignment only shifts each line *within* the block relative to the
     * longest line. Use `originX` to position the block as a whole.
     *
     * Reads the inset from {@link buildLineInfo}, which must therefore run first.
     */
    applyAlignment: function () {
        if (this._align === 'left' || this._characters.length === 0) {
            return;
        }

        const lines: LineInfo[] = this._lines;

        for (const char of this._characters) {
            const line = lines[char.line as number];
            if (line) {
                char.x += line.x;
                // The pen moves with the quad, or a substituted glyph would be
                // placed against the unaligned layout.
                char.penX += line.x;
            }
        }
    },

    /**
     * Clear all character data
     */
    clearCharacters: function () {
        this._characters = [];
    },

    // ========================================================================
    // Cleanup
    // ========================================================================

    /**
     * Destroy the text object
     */
    preDestroy: function () {
        this.clearCharacters();
    }

});
