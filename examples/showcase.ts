import Phaser from 'phaser';
import { Pane } from 'tweakpane';
import { MSDFPlugin } from '../src';

import { BatchedTestScene } from './batched-test';
import { CallbackEffectsTestScene } from './callback-effects-test';
import { OutlineTestScene } from './outline-test';
import { ShadowTestScene } from './shadow-test';
import { WordWrapTestScene } from './word-wrap-test';

type SceneCtor = new () => Phaser.Scene & { setupPane?(pane: Pane): void };

interface Example {
  title: string;
  scene: SceneCtor;
  key: string;
}

const examples: Example[] = [
  { title: 'Batched Rendering', scene: BatchedTestScene,        key: 'BatchedTestScene' },
  { title: 'Callback Effects',  scene: CallbackEffectsTestScene, key: 'CallbackEffectsTestScene' },
  { title: 'Outline Effect',    scene: OutlineTestScene,         key: 'OutlineTestScene' },
  { title: 'Shadow Effect',     scene: ShadowTestScene,          key: 'ShadowTestScene' },
  { title: 'Word Wrap',         scene: WordWrapTestScene,        key: 'WordWrapTestScene' },
];

// ── DOM refs ──────────────────────────────────────────────────
const canvasContainer = document.getElementById('canvas-container')!;
const paneContainer   = document.getElementById('pane-container')!;
const navTitle        = document.getElementById('nav-title')!;
const navCounter      = document.getElementById('nav-counter')!;
const btnPrev         = document.getElementById('btn-prev') as HTMLButtonElement;
const btnNext         = document.getElementById('btn-next') as HTMLButtonElement;

// ── State ─────────────────────────────────────────────────────
let currentIndex = -1;
let currentPane: Pane | null = null;

// ── Phaser game ───────────────────────────────────────────────
const game = new Phaser.Game({
  type: Phaser.WEBGL,
  backgroundColor: '#1a1a2e',
  parent: canvasContainer,
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.NONE,
    width: '100%',
    height: '100%',
  },
  // Register all scene classes; none auto-start (Phaser starts only the first by default).
  // We stop them all once ready and drive scene transitions ourselves.
  scene: examples.map(e => e.scene),
  plugins: {
    global: [{ key: 'MSDFPlugin', plugin: MSDFPlugin, start: true }],
  },
});

game.events.once(Phaser.Core.Events.READY, () => {
  // Stop everything Phaser may have auto-started.
  for (const e of examples) game.scene.stop(e.key);
  showExample(0);
});

// ── Navigation ────────────────────────────────────────────────
function showExample(nextIndex: number) {
  // Stop outgoing scene
  if (currentIndex >= 0) {
    game.scene.stop(examples[currentIndex].key);
  }

  // Tear down old pane
  if (currentPane) {
    currentPane.dispose();
    currentPane = null;
    paneContainer.innerHTML = '';
    paneContainer.classList.remove('visible');
  }

  currentIndex = nextIndex;
  const { title, key, scene: SceneCtor } = examples[nextIndex];

  // Update nav
  navTitle.textContent = title;
  navCounter.textContent = `${nextIndex + 1} / ${examples.length}`;
  btnPrev.disabled = nextIndex === 0;
  btnNext.disabled = nextIndex === examples.length - 1;

  // Start scene
  game.scene.start(key);

  // Wire Tweakpane after scene finishes create()
  const scene = game.scene.getScene(key) as InstanceType<typeof SceneCtor>;
  scene.events.once(Phaser.Scenes.Events.CREATE, () => {
    if (scene.setupPane) {
      currentPane = new Pane({ container: paneContainer });
      scene.setupPane(currentPane);
      paneContainer.classList.add('visible');
    }
  });
}

btnPrev.addEventListener('click', () => {
  if (currentIndex > 0) showExample(currentIndex - 1);
});
btnNext.addEventListener('click', () => {
  if (currentIndex < examples.length - 1) showExample(currentIndex + 1);
});
