import Phaser from 'phaser';
import type { DisplayCallbackData } from '../src';

export class CallbackEffectsTestScene extends Phaser.Scene {
  private currentTime = 0;

  constructor() {
    super({ key: 'CallbackEffectsTestScene' });
  }

  preload() {
    this.load.msdfFont('arial', 'assets/fonts/Arial.png', 'assets/fonts/Arial.json');
  }

  create() {
    const wave = this.add.msdfText(400, 60, 'arial', 'WAVE EFFECT', 36);
    wave.setColor('#00ff00');
    wave.setAlign('center');
    wave.setDisplayCallback((data: DisplayCallbackData) => {
      data.y += Math.sin((data.index * 0.5) + (this.currentTime * 0.003)) * 15;
      return data;
    });

    const rainbow = this.add.msdfText(400, 130, 'arial', 'RAINBOW COLORS', 36);
    rainbow.setAlign('center');
    rainbow.setDisplayCallback((data: DisplayCallbackData) => {
      const hue = (data.index * 30 + this.currentTime * 0.1) % 360;
      const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1) as Phaser.Types.Display.ColorObject;
      const tint = (255 << 24) | (color.b << 16) | (color.g << 8) | color.r;
      data.tint.topLeft = data.tint.topRight = data.tint.bottomLeft = data.tint.bottomRight = tint;
      return data;
    });

    const breathing = this.add.msdfText(400, 200, 'arial', 'BREATHING', 36);
    breathing.setColor('#ffff00');
    breathing.setAlign('center');
    breathing.setDisplayCallback((data: DisplayCallbackData) => {
      data.scale = 1 + Math.sin(data.index * 0.2 + this.currentTime * 0.002) * 0.3;
      return data;
    });

    const jiggle = this.add.msdfText(400, 270, 'arial', 'JIGGLE!', 36);
    jiggle.setColor('#ff00ff');
    jiggle.setAlign('center');
    jiggle.setDisplayCallback((data: DisplayCallbackData) => {
      data.x += Math.sin(this.currentTime * 0.01 + data.index * 1.5) * 3;
      data.y += Math.cos(this.currentTime * 0.012 + data.index * 1.7) * 3;
      return data;
    });

    const spinning = this.add.msdfText(400, 340, 'arial', 'SPINNING', 36);
    spinning.setColor('#00ffff');
    spinning.setAlign('center');
    spinning.setDisplayCallback((data: DisplayCallbackData) => {
      data.rotation = this.currentTime * 0.002 + data.index * 0.2;
      return data;
    });

    const combined = this.add.msdfText(400, 450, 'arial', 'COMBINED EFFECTS!', 48);
    combined.setAlign('center');
    combined.setDisplayCallback((data: DisplayCallbackData) => {
      data.y += Math.sin(data.index * 0.4 + this.currentTime * 0.004) * 20;
      const hue = (data.index * 25 + this.currentTime * 0.15) % 360;
      const color = Phaser.Display.Color.HSVToRGB(hue / 360, 1, 1) as Phaser.Types.Display.ColorObject;
      const tint = (255 << 24) | (color.b << 16) | (color.g << 8) | color.r;
      data.tint.topLeft = data.tint.topRight = data.tint.bottomLeft = data.tint.bottomRight = tint;
      data.scale = 1 + Math.sin(data.index * 0.15 + this.currentTime * 0.003) * 0.2;
      return data;
    });
  }

  update(time: number) {
    this.currentTime = time;
  }
}
