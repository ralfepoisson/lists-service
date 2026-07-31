import type { Context } from 'aws-lambda';
import type { RequestEnvelope, ResponseEnvelope } from 'ask-sdk-model';

import { AlexaApplicationComposition } from '../bootstrap/ApplicationComposition.js';

export class AlexaLambdaEntrypoint {
  private readonly composition = AlexaApplicationComposition.create();

  async handle(event: RequestEnvelope, context: Context): Promise<ResponseEnvelope> {
    const startedAt = performance.now();
    const application = await this.composition;
    const requestId = event.request.requestId;
    try {
      const response = await application.alexaSkill.invoke(event, context);
      application.logger.log({
        level: 'info',
        message: 'Alexa request completed.',
        requestId,
        channel: 'alexa',
        operation: event.request.type,
        durationMs: Math.round(performance.now() - startedAt),
        status: 'success'
      });
      return response;
    } catch (error: unknown) {
      application.logger.log({
        level: 'error',
        message: 'Alexa request rejected.',
        requestId,
        channel: 'alexa',
        operation: event.request.type,
        durationMs: Math.round(performance.now() - startedAt),
        status: error instanceof Error ? error.name : 'unknown_error'
      });
      throw error;
    }
  }
}
