import { copyFile, cp, mkdir, rm } from 'node:fs/promises';

import { build } from 'esbuild';

class LambdaBundleBuilder {
  async run() {
    await rm('dist', { recursive: true, force: true });
    await mkdir('dist', { recursive: true });
    await build({
      entryPoints: {
        'rest-lambda': 'src/entrypoints/rest-lambda.ts',
        'alexa-lambda': 'src/entrypoints/alexa-lambda.ts'
      },
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'node24',
      banner: {
        js: "import { createRequire } from 'node:module'; import { dirname } from 'node:path'; import { fileURLToPath } from 'node:url'; const require = createRequire(import.meta.url); const __filename = fileURLToPath(import.meta.url); const __dirname = dirname(__filename);"
      },
      outdir: 'dist',
      outExtension: { '.js': '.mjs' },
      sourcemap: true,
      minify: false
    });
    await build({
      entryPoints: {
        'local-rest': 'src/entrypoints/local-rest.ts'
      },
      bundle: true,
      format: 'cjs',
      platform: 'node',
      target: 'node24',
      outdir: 'dist',
      outExtension: { '.js': '.cjs' },
      sourcemap: true,
      minify: false
    });
    await cp('node_modules/pdfkit/js/data', 'dist/data', { recursive: true });
    await mkdir('dist/rest-package', { recursive: true });
    await copyFile('dist/rest-lambda.mjs', 'dist/rest-package/rest-lambda.mjs');
    await cp('dist/data', 'dist/rest-package/data', { recursive: true });
  }
}

await new LambdaBundleBuilder().run();
