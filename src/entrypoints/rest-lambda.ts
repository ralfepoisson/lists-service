import { RestLambdaEntrypoint } from './RestLambdaEntrypoint.js';

const entrypoint = new RestLambdaEntrypoint();

export const handler = entrypoint.handle.bind(entrypoint);
