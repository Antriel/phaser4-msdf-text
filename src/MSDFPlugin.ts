/**
 * MSDFPlugin — global Phaser plugin that installs the MSDF font cache and
 * verifies the required WebGL extension.
 *
 * Recommended registration via game config:
 *
 *   import { MSDFPlugin, MSDFBatchHandler } from 'phaser4-msdf-font';
 *
 *   new Phaser.Game({
 *       type: Phaser.WEBGL,
 *       render: { renderNodes: { BatchHandlerMSDF: MSDFBatchHandler } },
 *       plugins: { global: [{ key: 'MSDFPlugin', plugin: MSDFPlugin, start: true }] },
 *       scene: [MyScene]
 *   });
 *
 * Or call `installMSDFPlugin(game)` from `callbacks.postBoot` for manual setup.
 */

import Phaser from 'phaser';

const BasePlugin: typeof Phaser.Plugins.BasePlugin = (Phaser as any).Plugins.BasePlugin;

export class MSDFPlugin extends BasePlugin {
    init(): void {
        const game = this.game as Phaser.Game;
        ensureDerivativesExtension(game);
        ensureMSDFCache(game);
    }
}

/**
 * Install MSDF support manually (alternative to registering MSDFPlugin in the
 * game config). Safe to call multiple times.
 */
export function installMSDFPlugin(game: Phaser.Game): void {
    ensureDerivativesExtension(game);
    ensureMSDFCache(game);
}

export function getMSDFCache(game: Phaser.Game): Phaser.Cache.BaseCache | undefined {
    return game.cache.custom.msdfFont;
}

export function isMSDFPluginInstalled(game: Phaser.Game): boolean {
    return !!game.cache.custom.msdfFont;
}

/**
 * Convenience: install from inside a scene's `init()` or `preload()` if you
 * don't want to wire it up via the game config.
 */
export function autoInstallMSDFPlugin(scene: Phaser.Scene): void {
    if (!isMSDFPluginInstalled(scene.game)) {
        installMSDFPlugin(scene.game);
    }
}

function ensureDerivativesExtension(game: Phaser.Game): void {
    const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer | undefined;
    if (renderer && 'standardDerivativesExtension' in renderer && !(renderer as any).standardDerivativesExtension) {
        throw new Error(
            '[MSDFPlugin] OES_standard_derivatives WebGL extension is required for MSDF rendering but is not available on this context.'
        );
    }
}

function ensureMSDFCache(game: Phaser.Game): void {
    if (!game.cache.custom.msdfFont) {
        game.cache.addCustom('msdfFont');
    }
}
