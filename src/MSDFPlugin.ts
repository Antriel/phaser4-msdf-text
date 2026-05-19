/**
 * MSDFPlugin — global Phaser plugin that installs the MSDF font cache, the
 * `BatchHandlerMSDF` render node, and verifies the required WebGL extension.
 *
 * Recommended registration via game config — no separate `renderNodes` entry
 * needed; the plugin wires it up automatically:
 *
 *   import { MSDFPlugin } from 'phaser4-msdf-font';
 *
 *   new Phaser.Game({
 *       type: Phaser.WEBGL,
 *       plugins: { global: [{ key: 'MSDFPlugin', plugin: MSDFPlugin, start: true }] },
 *       scene: [MyScene]
 *   });
 *
 * Or call `installMSDFPlugin(game)` from `callbacks.postBoot` for manual setup.
 */

import Phaser from 'phaser';
import MSDFBatchHandler from './MSDFBatchHandler';

const BasePlugin: typeof Phaser.Plugins.BasePlugin = (Phaser as any).Plugins.BasePlugin;

const BATCH_HANDLER_NAME = 'BatchHandlerMSDF';

export class MSDFPlugin extends BasePlugin {
    init(): void {
        const game = this.game as Phaser.Game;
        ensureDerivativesExtension(game);
        ensureBatchHandler(game);
        ensureMSDFCache(game);
    }
}

/**
 * Install MSDF support manually (alternative to registering MSDFPlugin in the
 * game config). Safe to call multiple times.
 */
export function installMSDFPlugin(game: Phaser.Game): void {
    ensureDerivativesExtension(game);
    ensureBatchHandler(game);
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

/**
 * Register the MSDF batch handler with the renderer. If the RenderNodeManager
 * already exists (manual install after boot), register via `addNodeConstructor`.
 * Otherwise inject into `game.config.renderNodes` so the manager picks it up
 * when the renderer boots.
 */
function ensureBatchHandler(game: Phaser.Game): void {
    const renderer = game.renderer as any;
    const renderNodes = renderer && renderer.renderNodes;

    if (renderNodes && typeof renderNodes.addNodeConstructor === 'function') {
        if (!renderNodes.hasNode(BATCH_HANDLER_NAME)) {
            renderNodes.addNodeConstructor(BATCH_HANDLER_NAME, MSDFBatchHandler);
        }
        return;
    }

    const config = game.config as any;
    const nodes = config.renderNodes || (config.renderNodes = {});
    if (!nodes[BATCH_HANDLER_NAME]) {
        nodes[BATCH_HANDLER_NAME] = MSDFBatchHandler;
    }
}
