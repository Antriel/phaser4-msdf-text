import Phaser from 'phaser';
import { Pane } from 'tweakpane';
import type { MSDFTextInstance } from '../src';

export class WordWrapTestScene extends Phaser.Scene {
  private text1?: MSDFTextInstance;
  private text2?: MSDFTextInstance;
  private text3?: MSDFTextInstance;
  private boundsText?: MSDFTextInstance;

  private params = { maxWidth: 400 };

  constructor() {
    super({ key: 'WordWrapTestScene' });
  }

  preload() {
    this.load.msdfFont('arial', 'assets/fonts/Arial.png', 'assets/fonts/Arial.json');
  }

  create() {
    this.text1 = this.add.msdfText(50, 50, 'arial',
      'This is a very long line of text that will automatically wrap when it exceeds the maximum width. Word wrapping makes text much more readable in constrained spaces!',
      24
    );
    this.text1.setColor('#00ff00');
    this.text1.setAlign('left');
    this.text1.setMaxWidth(this.params.maxWidth);

    this.text2 = this.add.msdfText(400, 200, 'arial',
      'Centered text with word wrapping. This demonstrates how alignment works with wrapped text.',
      28
    );
    this.text2.setColor('#ffff00');
    this.text2.setAlign('center');
    this.text2.setMaxWidth(350);

    this.text3 = this.add.msdfText(50, 350, 'arial',
      'First paragraph with manual line break.\nSecond paragraph that will wrap because it contains a very long line that exceeds the maximum width constraint.',
      22
    );
    this.text3.setColor('#ff00ff');
    this.text3.setAlign('left');
    this.text3.setMaxWidth(500);
    this.text3.setLineSpacing(3);

    this.boundsText = this.add.msdfText(550, 50, 'arial', '', 16);
    this.boundsText.setColor('#ffffff');
    this.updateBoundsInfo();
  }

  setupPane(pane: Pane) {
    pane.addBinding(this.params, 'maxWidth', { label: 'Max Width', min: 100, max: 700, step: 10 })
      .on('change', () => {
        this.text1?.setMaxWidth(this.params.maxWidth);
        this.updateBoundsInfo();
      });
  }

  private updateBoundsInfo() {
    if (!this.text1 || !this.boundsText) return;
    const b = this.text1.getTextBounds();
    this.boundsText.setText([
      `MaxWidth: ${this.params.maxWidth}px`,
      '',
      'Text Bounds:',
      `Width:  ${b.width.toFixed(1)}px`,
      `Height: ${b.height.toFixed(1)}px`,
      '',
      'Lines:',
      `Count:    ${b.lines.count}`,
      `Shortest: ${b.lines.shortest.toFixed(1)}px`,
      `Longest:  ${b.lines.longest.toFixed(1)}px`,
    ].join('\n'));
  }

  update(time: number) {
    if (this.text2) {
      const scale = 1 + Math.sin(time / 500) * 0.1;
      this.text2.scaleX = scale;
      this.text2.scaleY = scale;
    }
  }
}
