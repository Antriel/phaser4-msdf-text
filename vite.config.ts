import { defineConfig } from 'vite';
import path from 'path';

// Path aliases used by the examples app.
const srcAliases = {
  '@': path.resolve(__dirname, './src'),
  '@examples': path.resolve(__dirname, './examples')
};

// Resolve `phaser` to its un-built source instead of the shipped dist bundle.
//
// Phaser's Spector.js debug integration (`game.renderer.captureFrame()`) is
// gated behind `typeof WEBGL_DEBUG` in the source. `typeof` of an undeclared
// global evaluates to the string "undefined", which is truthy — so consuming
// the source enables the debug build automatically, no replacement needed.
//
// The npm dist (`phaser.esm.js`) is built with webpack's DefinePlugin
// replacing that whole expression with `false` and dead-code-eliminating
// every Spector callsite, which cannot be undone afterwards. Phaser's source
// is plain CJS with pre-generated shader modules, so esbuild (dev) and Rollup
// (build) bundle it without any extra loaders. The absolute path also
// sidesteps Phaser's `exports` field, which would otherwise block deep
// imports into `phaser/src`.
const phaserDebugAlias = {
  phaser: path.resolve(__dirname, 'node_modules/phaser/src/phaser.js')
};

// Phaser's source entry does `global.Phaser = Phaser` (phaser.js). Webpack
// polyfills `global` when it builds the dist bundle; esbuild and Rollup do
// not, so map it to the browser global ourselves.
const globalShim = { global: 'globalThis' };

export default defineConfig(({ command, mode }) => {
  // The examples showcase app — `vite` (dev) and `vite build --mode examples`.
  // Both bundle Phaser from source so Spector.js works in the dev server and
  // in the produced build alike.
  if (command === 'serve' || mode === 'examples') {
    return {
      define: globalShim,
      resolve: {
        alias: { ...srcAliases, ...phaserDebugAlias }
      },
      server: {
        port: 3000,
        open: true
      },
      build: {
        // Kept separate from the library's `dist/` so `npm run build` and
        // `npm run build:examples` don't clobber each other.
        outDir: 'dist-examples',
        emptyOutDir: true,
        sourcemap: true
        // `public/` (sample fonts) is copied by default — the examples need it.
      }
    };
  }

  // `vite build` — bundle the library for distribution.
  return {
    build: {
      outDir: 'dist',
      sourcemap: true,
      emptyOutDir: true,
      // The library build ships only JS + d.ts. `public/` holds sample fonts
      // for the dev examples app and must not be copied into the npm package.
      copyPublicDir: false,
      lib: {
        entry: path.resolve(__dirname, 'src/index.ts'),
        name: 'Phaser4MSDFFont',
        fileName: (format) => `phaser4-msdf-font.${format === 'es' ? 'js' : 'cjs'}`,
        formats: ['es', 'cjs']
      },
      rollupOptions: {
        external: ['phaser'],
        output: {
          globals: { phaser: 'Phaser' }
        }
      }
    }
  };
});
