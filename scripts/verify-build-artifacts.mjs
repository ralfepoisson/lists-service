import { access } from 'node:fs/promises';

const requiredArtifacts = [
  'dist/local-rest.cjs',
  'dist/data/Helvetica.afm',
  'dist/data/Helvetica-Bold.afm',
  'dist/data/sRGB_IEC61966_2_1.icc',
  'dist/rest-package/rest-lambda.mjs',
  'dist/rest-package/data/Helvetica.afm',
  'dist/rest-package/data/Helvetica-Bold.afm',
  'dist/rest-package/data/sRGB_IEC61966_2_1.icc',
  'dist/alexa-lambda.mjs'
];

await Promise.all(requiredArtifacts.map((artifact) => access(artifact)));
