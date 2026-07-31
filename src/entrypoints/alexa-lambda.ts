import { AlexaLambdaEntrypoint } from './AlexaLambdaEntrypoint.js';

const entrypoint = new AlexaLambdaEntrypoint();

export const handler = entrypoint.handle.bind(entrypoint);
