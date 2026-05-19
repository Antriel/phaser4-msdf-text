import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig(({ command }) => {
  // `vite` (dev/serve) — run the examples app.
  if (command === 'serve') {
    return {
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
          '@examples': path.resolve(__dirname, './examples')
        }
      },
      server: {
        port: 3000,
        open: true
      },
      assetsInclude: ['**/*.frag', '**/*.vert', '**/*.glsl']
    };
  }

  // `vite build` — bundle the library for distribution.
  return {
    build: {
      outDir: 'dist',
      sourcemap: true,
      emptyOutDir: true,
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
