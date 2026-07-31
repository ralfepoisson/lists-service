import { mkdir, rm } from 'node:fs/promises';

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
  }
}

await new LambdaBundleBuilder().run();
