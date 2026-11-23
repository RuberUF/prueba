import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, type Plugin} from 'vite';

function inlineSingleFileHtmlPlugin(): Plugin {
  return {
    name: 'inline-single-file-html',
    apply: 'build',
    enforce: 'post',
    closeBundle(error?: Error): void {
      if (error) return;
      const distDir = path.resolve(__dirname, 'dist');
      const indexPath = path.join(distDir, 'index.html');
      if (!fs.existsSync(indexPath)) return;

      let html = fs.readFileSync(indexPath, 'utf8');

      // Inline all emitted stylesheet links
      html = html.replace(
        /<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi,
        (fullMatch, href: string) => {
          const cleanRel = href.replace(/^\.?\//, '');
          const cssPath = path.join(distDir, cleanRel);
          if (!fs.existsSync(cssPath)) return fullMatch;
          const css = fs.readFileSync(cssPath, 'utf8').replace(/<\/style/gi, '<\\/style');
          return `<style>\n${css}\n</style>`;
        }
      );

      // Remove modulepreload hints since everything is inlined
      html = html.replace(/<link\b[^>]*rel=["']modulepreload["'][^>]*>\s*/gi, '');

      // Inline module scripts
      html = html.replace(
        /<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*><\/script>/gi,
        (fullMatch, src: string) => {
          const cleanRel = src.replace(/^\.?\//, '');
          const jsPath = path.join(distDir, cleanRel);
          if (!fs.existsSync(jsPath)) return fullMatch;
          const js = fs.readFileSync(jsPath, 'utf8').replace(/<\/script/gi, '<\\/script');
          return `<script type="module">\n${js}\n</script>`;
        }
      );

      fs.writeFileSync(indexPath, html, 'utf8');
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      inlineSingleFileHtmlPlugin(),
    ],
    build: {
      assetsInlineLimit: 100 * 1024 * 1024,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 10000,
      rolldownOptions: {
        output: {
          inlineDynamicImports: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
