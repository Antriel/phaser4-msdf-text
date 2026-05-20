import * as Phaser from "phaser";
import type { Pane } from "tweakpane";
import type { ExampleScene } from "./ExampleScene";
import { getResponsive } from "./responsive";
import { FONT_OPTIONS } from "./fonts";

const ALIGN_OPTIONS = { Left: 0, Center: 1, Right: 2 };

/**
 * Append the controls shared by every example: a "Text" folder bound to the
 * scene's {@link ExampleScene.commonTargets}, and a "Display" folder for DPR.
 */
export function buildCommonControls(pane: Pane, scene: ExampleScene): void {
  if (scene.commonTargets.length > 0) {
    buildTextFolder(pane, scene);
  }
  buildDisplayFolder(pane);
}

function buildTextFolder(pane: Pane, scene: ExampleScene): void {
  const targets = scene.commonTargets;
  const first = targets[0];
  const params = {
    font: first.font,
    fontSize: first.fontSize,
    color: "#ffffff",
    scale: first.scaleX,
    rotation: 0,
    letterSpacing: first.letterSpacing,
    lineSpacing: first.lineSpacing,
    align: first.align,
  };

  const f = pane.addFolder({ title: "Text" });

  f.addBinding(params, "font", { options: FONT_OPTIONS })
    .on("change", (e) => targets.forEach((t) => t.setFont(e.value)));
  f.addBinding(params, "fontSize", { min: 8, max: 220, step: 1 })
    .on("change", (e) => targets.forEach((t) => t.setFontSize(e.value)));
  f.addBinding(params, "color", { view: "color" })
    .on("change", (e) => targets.forEach((t) => t.setColor(e.value)));
  f.addBinding(params, "scale", { min: 0.1, max: 8, step: 0.1 })
    .on("change", (e) => targets.forEach((t) => t.setScale(e.value)));
  f.addBinding(params, "rotation", { min: -180, max: 180, step: 1 })
    .on("change", (e) => targets.forEach((t) => t.setRotation(Phaser.Math.DegToRad(e.value))));
  f.addBinding(params, "letterSpacing", { label: "letter spacing", min: -10, max: 40, step: 0.5 })
    .on("change", (e) => targets.forEach((t) => t.setLetterSpacing(e.value)));
  f.addBinding(params, "lineSpacing", { label: "line spacing", min: -20, max: 60, step: 1 })
    .on("change", (e) => targets.forEach((t) => t.setLineSpacing(e.value)));
  f.addBinding(params, "align", { options: ALIGN_OPTIONS })
    .on("change", (e) => targets.forEach((t) => { t.align = e.value; }));
}

function buildDisplayFolder(pane: Pane): void {
  const responsive = getResponsive();
  const params = { dpr: responsive.dpr };

  const f = pane.addFolder({ title: "Display", expanded: false });
  f.addBinding(params, "dpr", { label: "Pixel Ratio", min: 0.5, max: 3, step: 0.25 })
    .on("change", (e) => {
      responsive.dpr = e.value;
      responsive.apply();
    });
}
