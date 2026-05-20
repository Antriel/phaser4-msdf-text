import * as Phaser from "phaser";

export interface ViewportSize {
  /** Canvas display size in CSS pixels. */
  cssWidth: number;
  cssHeight: number;
  /** Device pixel ratio currently in effect. */
  dpr: number;
  /** Drawing-buffer size in real pixels (`css * dpr`). */
  pixelWidth: number;
  pixelHeight: number;
}

type Listener = (size: ViewportSize) => void;

/**
 * Owns canvas sizing for the examples app.
 *
 * Phaser's RESIZE scale mode ties the drawing-buffer resolution to CSS pixels
 * and ignores `devicePixelRatio`. This controller uses `Scale.NONE` instead and
 * sizes everything itself: the drawing buffer is `css * dpr` so text renders at
 * native pixel density, while the canvas element still *displays* at CSS size.
 *
 * `dpr` is adjustable at runtime, so the examples can demonstrate live how MSDF
 * text adapts to pixel density — something a fixed-resolution font cannot do.
 */
export class ResponsiveManager {
  /** Device pixel ratio used for the drawing buffer. Defaults to the real one. */
  dpr: number;

  private readonly game: Phaser.Game;
  private readonly container: HTMLElement;
  private readonly listeners: Listener[] = [];
  private current: ViewportSize;

  constructor(game: Phaser.Game, container: HTMLElement) {
    this.game = game;
    this.container = container;
    this.dpr = window.devicePixelRatio || 1;
    this.current = this.measure();

    new ResizeObserver(() => this.apply()).observe(container);
    window.addEventListener("resize", () => this.apply());
  }

  /** The most recently applied viewport size. */
  get size(): ViewportSize {
    return this.current;
  }

  private measure(): ViewportSize {
    const rect = this.container.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.floor(rect.width));
    const cssHeight = Math.max(1, Math.floor(rect.height));
    return {
      cssWidth,
      cssHeight,
      dpr: this.dpr,
      pixelWidth: Math.round(cssWidth * this.dpr),
      pixelHeight: Math.round(cssHeight * this.dpr),
    };
  }

  /** Recompute the size and push it to Phaser and the canvas element. */
  apply(): void {
    const size = this.measure();
    this.current = size;

    // Drawing buffer at native density.
    this.game.scale.resize(size.pixelWidth, size.pixelHeight);

    // ...but the element still *displays* at CSS size. Phaser's NONE mode would
    // otherwise leave the canvas styled at the full buffer size.
    const canvas = this.game.canvas;
    canvas.style.width = `${size.cssWidth}px`;
    canvas.style.height = `${size.cssHeight}px`;

    for (const fn of this.listeners) {
      fn(size);
    }
  }

  /** Subscribe to size changes. Returns an unsubscribe function. */
  onResize(fn: Listener): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }
}

let instance: ResponsiveManager | null = null;

/** Create the singleton ResponsiveManager. Call once, after the game boots. */
export function initResponsive(game: Phaser.Game, container: HTMLElement): ResponsiveManager {
  instance = new ResponsiveManager(game, container);
  return instance;
}

/** Access the ResponsiveManager singleton. */
export function getResponsive(): ResponsiveManager {
  if (!instance) {
    throw new Error("ResponsiveManager not initialised — call initResponsive() first.");
  }
  return instance;
}
