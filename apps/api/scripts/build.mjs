/**
 * Build PRODUCTIVO de @soec/api con esbuild.
 *
 * El monorepo consume los paquetes `@soec/*` como FUENTE TypeScript (exports → ./src/index.ts, sin build por
 * paquete). Para un artefacto ejecutable con `node` (sin tsx en producción), empaquetamos el grafo PRIMER-PARTY
 * (server.ts + relativos + todos los `@soec/*`) en un único `dist/server.js`, y dejamos EXTERNOS los paquetes
 * de terceros (fastify, pg, zod, …) y los builtins de Node: se cargan de node_modules en tiempo de ejecución.
 *
 * Resultado: `node dist/server.js` arranca sin tsx ni TypeScript. El typecheck sigue siendo un gate aparte
 * (`tsc --noEmit`); esbuild no valida tipos.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, '..'); // apps/api

/** Externaliza todo lo que NO sea primer-party (`@soec/*`) ni relativo. */
const externalizarTerceros = {
  name: 'externalizar-terceros',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return null;
      const p = args.path;
      if (p.startsWith('.') || path.isAbsolute(p)) return null; // relativo → se empaqueta
      if (p.startsWith('@soec/')) return null; // workspace primer-party → se empaqueta (fuente TS)
      return { path: p, external: true }; // npm + node: builtins → externos (node_modules en runtime)
    });
  },
};

await build({
  entryPoints: [path.join(root, 'src/server.ts')],
  outfile: path.join(root, 'dist/server.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  logLevel: 'info',
  plugins: [externalizarTerceros],
});

console.log('build OK → apps/api/dist/server.js');
