import { readFile } from 'node:fs/promises';

import type { RequestEnvelope } from 'ask-sdk-model';

import { AlexaApplicationComposition } from '../bootstrap/ApplicationComposition.js';

class LocalAlexaInvoker {
  async run(fixturePath: string | undefined): Promise<void> {
    if (fixturePath === undefined) {
      throw new Error('Usage: npm run invoke:alexa -- path/to/request.json');
    }
    const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as RequestEnvelope;
    const application = await AlexaApplicationComposition.create();
    const response = await application.alexaSkill.invoke(fixture);
    process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  }
}

await new LocalAlexaInvoker().run(process.argv[2]);
