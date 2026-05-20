import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import { getResponsive } from "./responsive";
import { buildCommonControls } from "./controls";
import type { MSDFTextInstance } from "../../src";

/**
 * Base class for every example scene.
 *
 * A subclass lays its content out in a fixed *design resolution* (default
 * 1280×720). This base fits the main camera so that design area is always
 * fully visible and centred, whatever the real canvas size or DPR — so text
 * can be placed at sensible coordinates and still display well on any device.
 */
export abstract class ExampleScene extends Phaser.Scene {
  /** Design-space dimensions the scene is laid out in. */
  protected designWidth = 1280;
  protected designHeight = 720;

  /**
   * Text objects the shared "Text" controls (font, size, colour, scale, …)
   * operate on. Subclasses push to this from {@link build}. Leave empty to
   * omit the shared Text folder entirely.
   */
  readonly commonTargets: MSDFTextInstance[] = [];

  private removeResize?: () => void;

  /** Build the scene contents. Runs once, from `create()`. */
  protected abstract build(): void;

  /** Optional hook for example-specific tweakpane controls. */
  protected addControls(_pane: Pane): void {
    /* overridden by subclasses that need their own controls */
  }

  create(): void {
    this.build();
    this.fitCamera();
    this.removeResize = getResponsive().onResize(() => this.fitCamera());
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.removeResize?.());
  }

  /** Centre and zoom the main camera so the design area fits the canvas. */
  private fitCamera(): void {
    const { pixelWidth, pixelHeight } = getResponsive().size;
    const cam = this.cameras.main;
    cam.setSize(pixelWidth, pixelHeight);
    cam.setZoom(Math.min(pixelWidth / this.designWidth, pixelHeight / this.designHeight));
    cam.centerOn(this.designWidth / 2, this.designHeight / 2);
  }

  /** Called by the shell once the scene has finished `create()`. */
  setupPane(pane: Pane): void {
    this.addControls(pane);
    buildCommonControls(pane, this);
  }
}
