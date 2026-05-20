import * as Phaser from "phaser";
import { preloadFonts } from "./fonts";

/** Game-level event emitted once every font has finished loading. */
export const PRELOAD_DONE = "msdf-examples-preload-done";

/**
 * Loads all fonts once, up front. Every example scene then assumes the MSDF,
 * BitmapText, and TTF caches are populated — switching examples is instant and
 * the font picker works everywhere.
 */
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: "PreloadScene" });
  }

  preload(): void {
    preloadFonts(this.load);
  }

  create(): void {
    this.game.events.emit(PRELOAD_DONE);
  }
}
