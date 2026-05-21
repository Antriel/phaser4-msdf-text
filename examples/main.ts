import * as Phaser from "phaser";
import { Pane } from "tweakpane";
import { MSDFPlugin } from "../src";
import { initResponsive, getResponsive } from "./harness/responsive";
import { PreloadScene, PRELOAD_DONE } from "./harness/PreloadScene";
import type { ExampleScene } from "./harness/ExampleScene";

import { CrispScene } from "./scenes/crisp-at-any-scale";
import { OutlineScene } from "./scenes/outline";
import { GlowScene } from "./scenes/glow";
import { EffectsScene } from "./scenes/effects";
import { LayoutScene } from "./scenes/layout";
import { PerformanceScene } from "./scenes/performance";
import { GameUIScene } from "./scenes/gameui";
import { LootScene } from "./scenes/loot";

interface Example {
  key: string;
  title: string;
  scene: new () => ExampleScene;
}

// The example registry. The scene `key` is also the URL hash for deep links.
const examples: Example[] = [
  { key: "crisp", title: "Crisp at Any Scale", scene: CrispScene },
  { key: "outline", title: "Outline", scene: OutlineScene },
  { key: "glow", title: "Glow & Drop Shadow", scene: GlowScene },
  { key: "effects", title: "Animated Effects", scene: EffectsScene },
  { key: "layout", title: "Text Layout", scene: LayoutScene },
  { key: "performance", title: "Performance", scene: PerformanceScene },
  { key: "gameui", title: "Game UI Showcase", scene: GameUIScene },
  { key: "loot", title: "RPG Loot Cards", scene: LootScene },
];

// ── DOM refs ──────────────────────────────────────────────────
const canvasContainer = document.getElementById("canvas-container")!;
const paneContainer = document.getElementById("pane-container")!;
const navSelect = document.getElementById("nav-select") as HTMLSelectElement;
const navCounter = document.getElementById("nav-counter")!;
const btnPrev = document.getElementById("btn-prev") as HTMLButtonElement;
const btnNext = document.getElementById("btn-next") as HTMLButtonElement;
const btnCapture = document.getElementById("btn-capture") as HTMLButtonElement;
const btnPane = document.getElementById("btn-pane") as HTMLButtonElement;

for (const ex of examples) {
  const opt = document.createElement("option");
  opt.value = ex.key;
  opt.textContent = ex.title;
  navSelect.appendChild(opt);
}

// ── State ─────────────────────────────────────────────────────
let currentIndex = -1;
let currentPane: Pane | null = null;
let suppressHash = false;

// ── Phaser game ───────────────────────────────────────────────
// Scale.NONE: the ResponsiveManager owns canvas sizing and DPR. Every example
// scene is registered but only PreloadScene auto-starts; the shell drives the
// rest.
const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: canvasContainer,
  backgroundColor: "#0b0d12",
  scale: { mode: Phaser.Scale.NONE, width: 800, height: 600 },
  scene: [PreloadScene, ...examples.map((e) => e.scene)],
  plugins: {
    global: [{ key: "MSDFPlugin", plugin: MSDFPlugin, start: true }],
  },
});
(window as any).game = game;

game.events.once(Phaser.Core.Events.READY, () => {
  initResponsive(game, canvasContainer);
});

game.events.once(PRELOAD_DONE, () => {
  getResponsive().apply();
  game.scene.stop("PreloadScene");
  showExample(indexFromHash());
});

// ── Navigation ────────────────────────────────────────────────
function indexFromHash(): number {
  const key = location.hash.replace(/^#/, "");
  const i = examples.findIndex((e) => e.key === key);
  return i >= 0 ? i : 0;
}

function showExample(index: number): void {
  if (index === currentIndex || index < 0 || index >= examples.length) {
    return;
  }

  // Stop the outgoing scene first, then tear down its pane — so any per-frame
  // pane refresh has already stopped before the pane is disposed.
  if (currentIndex >= 0) {
    game.scene.stop(examples[currentIndex].key);
  }
  if (currentPane) {
    currentPane.dispose();
    currentPane = null;
  }
  paneContainer.innerHTML = "";

  currentIndex = index;
  const ex = examples[index];
  const scene = game.scene.getScene(ex.key) as ExampleScene;

  // Attach the CREATE listener BEFORE starting the scene. A scene with no
  // preload() boots *synchronously* inside scene.start() (SceneManager.start →
  // bootScene → create), so CREATE would fire before a listener added after
  // the start() call could ever catch it.
  scene.events.once(Phaser.Scenes.Events.CREATE, () => {
    currentPane = new Pane({ container: paneContainer });
    scene.setupPane(currentPane);
  });
  game.scene.start(ex.key);

  navSelect.selectedIndex = index;
  navCounter.textContent = `${index + 1} / ${examples.length}`;
  btnPrev.disabled = index === 0;
  btnNext.disabled = index === examples.length - 1;
  paneContainer.classList.remove("open");

  suppressHash = true;
  location.hash = ex.key;
  suppressHash = false;
}

btnPrev.addEventListener("click", () => showExample(currentIndex - 1));
btnNext.addEventListener("click", () => showExample(currentIndex + 1));
navSelect.addEventListener("change", () => showExample(navSelect.selectedIndex));
btnPane.addEventListener("click", () => paneContainer.classList.toggle("open"));

// Capture the next rendered frame with Spector.js. `captureFrame()` self-guards,
// so it is a harmless no-op if Phaser was not built with the debug hooks.
btnCapture.addEventListener("click", () => {
  (game.renderer as any).captureFrame?.();
});

window.addEventListener("hashchange", () => {
  if (!suppressHash) showExample(indexFromHash());
});

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) {
    return;
  }
  if (e.key === "ArrowLeft") showExample(currentIndex - 1);
  if (e.key === "ArrowRight") showExample(currentIndex + 1);
});
