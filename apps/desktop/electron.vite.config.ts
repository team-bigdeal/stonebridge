import { createReadStream, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** pdf.js가 PDF를 그릴 때 읽는 파일(한글 등 CMap·표준 글꼴·이미지 해석용 wasm·ICC)을 화면 빌드의 pdfjs/ 아래로 복사.
 *  개발 실행에서는 같은 주소(/pdfjs/…)로 node_modules에서 바로 낸다 */
function pdfjsAssets(): Plugin {
  const root = resolve('node_modules/pdfjs-dist');
  const dirs = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
  const types: Record<string, string> = { '.wasm': 'application/wasm', '.js': 'text/javascript' };
  return {
    name: 'pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs', (req, res, next) => {
        const file = join(root, decodeURIComponent((req.url ?? '').split('?')[0]));
        if (!dirs.some((d) => file.startsWith(join(root, d) + sep)) || !existsSync(file)) return next();
        res.setHeader('Content-Type', types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream');
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const d of dirs) {
        for (const f of readdirSync(join(root, d))) this.emitFile({ type: 'asset', fileName: `pdfjs/${d}/${f}`, source: readFileSync(join(root, d, f)) });
      }
    }
  };
}

export default defineConfig({
  main: {
    resolve: { alias: { '@shared': resolve('src/shared') } }
  },
  preload: {},
  renderer: {
    resolve: { alias: { '@shared': resolve('src/shared'), '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss(), pdfjsAssets()]
  }
});
