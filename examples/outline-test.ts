import Phaser from 'phaser';
import { Pane } from 'tweakpane';
import type { MSDFTextInstance } from '../src';

const COLOR_PRESETS = [
  { label: 'Black',  color: 0x000000 },
  { label: 'White',  color: 0xFFFFFF },
  { label: 'Red',    color: 0xFF0000 },
  { label: 'Blue',   color: 0x0000FF },
  { label: 'Yellow', color: 0xFFFF00 },
];

export class OutlineTestScene extends Phaser.Scene {
  private texts: MSDFTextInstance[] = [];

  private params = {
    width: 1.5,
    color: 'Black',
    alpha: 1.0,
  };

  constructor() {
    super({ key: 'OutlineTestScene' });
  }

  preload() {
    this.load.msdfFont(
      "Roboto_Regular",
      "assets/fonts/Roboto_Regular.png",
      "assets/fonts/Roboto_Regular.json",
    );
  }

  create() {
    const specs: [string, string, number, number, number, number][] = [
      ['OUTLINED TEXT',              '#ffffff', 400, 100, 1.5, 1.0],
      ['Colorful Outline',           '#00ff00', 400, 190, 1.5, 1.0],
      ['Press START',                '#ffffff', 400, 270, 2.0, 0.8],
      ['Small text with thin outline','#ffff00', 400, 350, 0.8, 1.0],
      ['BOLD STYLE',                 '#ff6600', 400, 400, 2.5, 1.0],
    ];

    for (const [label, color, x, y] of specs) {
      const t = this.add.msdfText(x, y, "Roboto_Regular", label, 48);
      t.setColor(color);
      t.setAlign('center');
      this.texts.push(t);
    }

    this.applyOutlines();
  }

  setupPane(pane: Pane) {
    pane.addBinding(this.params, 'width', { label: 'Width', min: 0, max: 5, step: 0.05 })
      .on('change', () => this.applyOutlines());

    pane.addBinding(this.params, 'color', {
      label: 'Color',
      options: Object.fromEntries(COLOR_PRESETS.map(p => [p.label, p.label])),
    }).on('change', () => this.applyOutlines());

    pane.addBinding(this.params, 'alpha', { label: 'Alpha', min: 0, max: 1, step: 0.05 })
      .on('change', () => this.applyOutlines());

    pane.addButton({ title: 'Remove outline' }).on('click', () => {
      this.params.width = 0;
      pane.refresh();
      this.applyOutlines();
    });
  }

  private applyOutlines() {
    const preset = COLOR_PRESETS.find(p => p.label === this.params.color) ?? COLOR_PRESETS[0];
    for (const t of this.texts) {
      if (this.params.width > 0) {
        t.setOutline(this.params.width, preset.color, this.params.alpha);
      } else {
        t.clearOutline();
      }
    }
  }
}
