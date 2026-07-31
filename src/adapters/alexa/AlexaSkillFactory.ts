import {
  getIntentName,
  getRequestType,
  getSlotValue,
  SkillBuilders,
  type ErrorHandler,
  type HandlerInput,
  type RequestHandler,
  type Skill
} from 'ask-sdk-core';
import type { Response } from 'ask-sdk-model';

import type { AlexaSpeechPresenter } from '../../application/AlexaSpeechPresenter.js';
import type { ShoppingListService } from '../../application/ShoppingListService.js';
import {
  FixedHouseholdUserResolver,
  type HouseholdUserResolver
} from '../../application/ports/HouseholdUserResolver.js';
import { AmbiguousItemError, ItemNotFoundError } from '../../domain/errors.js';

abstract class AbstractAlexaHandler implements RequestHandler {
  abstract canHandle(handlerInput: HandlerInput): boolean;
  abstract handle(handlerInput: HandlerInput): Promise<Response> | Response;

  protected response(
    handlerInput: HandlerInput,
    speech: string,
    shouldEndSession = true
  ): Response {
    return handlerInput.responseBuilder
      .speak(speech)
      .withShouldEndSession(shouldEndSession)
      .getResponse();
  }
}

class LaunchHandler extends AbstractAlexaHandler {
  canHandle(handlerInput: HandlerInput): boolean {
    return getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
  }

  handle(handlerInput: HandlerInput): Response {
    return this.response(
      handlerInput,
      'Welcome to your household shopping list. You can add an item or ask what is on your list.',
      false
    );
  }
}

class HelpHandler extends AbstractAlexaHandler {
  canHandle(handlerInput: HandlerInput): boolean {
    return (
      getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent'
    );
  }

  handle(handlerInput: HandlerInput): Response {
    return this.response(
      handlerInput,
      'You can add an item, read your shopping list, remove an item, or mark an item as bought.',
      false
    );
  }
}

class StopHandler extends AbstractAlexaHandler {
  canHandle(handlerInput: HandlerInput): boolean {
    if (getRequestType(handlerInput.requestEnvelope) !== 'IntentRequest') {
      return false;
    }
    return ['AMAZON.CancelIntent', 'AMAZON.StopIntent'].includes(
      getIntentName(handlerInput.requestEnvelope)
    );
  }

  handle(handlerInput: HandlerInput): Response {
    return this.response(handlerInput, 'Goodbye.');
  }
}

abstract class ItemIntentHandler extends AbstractAlexaHandler {
  constructor(
    private readonly intentName: string,
    protected readonly service: ShoppingListService,
    protected readonly userResolver: HouseholdUserResolver
  ) {
    super();
  }

  canHandle(handlerInput: HandlerInput): boolean {
    return (
      getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      getIntentName(handlerInput.requestEnvelope) === this.intentName
    );
  }

  protected async resolveItem(handlerInput: HandlerInput): Promise<string | Response> {
    await this.userResolver.resolve(handlerInput.requestEnvelope);
    const item = getSlotValue(handlerInput.requestEnvelope, 'item')?.trim();
    if (item === undefined || item.length === 0) {
      return handlerInput.responseBuilder
        .speak('What item should I use?')
        .reprompt('Tell me the shopping item.')
        .addElicitSlotDirective('item')
        .withShouldEndSession(false)
        .getResponse();
    }
    return item;
  }
}

class AddItemHandler extends ItemIntentHandler {
  async handle(handlerInput: HandlerInput): Promise<Response> {
    const itemOrResponse = await this.resolveItem(handlerInput);
    if (typeof itemOrResponse !== 'string') {
      return itemOrResponse;
    }
    const result = await this.service.add(itemOrResponse);
    return this.response(
      handlerInput,
      result.alreadyExists
        ? `${result.item.content} is already on your shopping list.`
        : `I added ${result.item.content} to your shopping list.`
    );
  }
}

class RemoveItemHandler extends ItemIntentHandler {
  async handle(handlerInput: HandlerInput): Promise<Response> {
    const itemOrResponse = await this.resolveItem(handlerInput);
    if (typeof itemOrResponse !== 'string') {
      return itemOrResponse;
    }
    const item = await this.service.deleteByContent(itemOrResponse);
    return this.response(handlerInput, `I removed ${item.content} from your shopping list.`);
  }
}

class CompleteItemHandler extends ItemIntentHandler {
  async handle(handlerInput: HandlerInput): Promise<Response> {
    const itemOrResponse = await this.resolveItem(handlerInput);
    if (typeof itemOrResponse !== 'string') {
      return itemOrResponse;
    }
    const item = await this.service.completeByContent(itemOrResponse);
    return this.response(handlerInput, `I marked ${item.content} as bought.`);
  }
}

class ListItemsHandler extends AbstractAlexaHandler {
  constructor(
    private readonly service: ShoppingListService,
    private readonly presenter: AlexaSpeechPresenter,
    private readonly userResolver: HouseholdUserResolver
  ) {
    super();
  }

  canHandle(handlerInput: HandlerInput): boolean {
    return (
      getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      getIntentName(handlerInput.requestEnvelope) === 'ListItemsIntent'
    );
  }

  async handle(handlerInput: HandlerInput): Promise<Response> {
    await this.userResolver.resolve(handlerInput.requestEnvelope);
    return this.response(
      handlerInput,
      this.presenter.presentList(await this.service.list('active'))
    );
  }
}

class ClearCompletedHandler extends AbstractAlexaHandler {
  constructor(
    private readonly service: ShoppingListService,
    private readonly userResolver: HouseholdUserResolver
  ) {
    super();
  }

  canHandle(handlerInput: HandlerInput): boolean {
    return (
      getRequestType(handlerInput.requestEnvelope) === 'IntentRequest' &&
      getIntentName(handlerInput.requestEnvelope) === 'ClearCompletedIntent'
    );
  }

  async handle(handlerInput: HandlerInput): Promise<Response> {
    await this.userResolver.resolve(handlerInput.requestEnvelope);
    const request = handlerInput.requestEnvelope.request;
    if (request.type !== 'IntentRequest') {
      throw new Error('Unexpected Alexa request type.');
    }
    if (request.intent.confirmationStatus === 'DENIED') {
      return this.response(handlerInput, 'Okay, I will not clear completed items.');
    }
    if (request.intent.confirmationStatus !== 'CONFIRMED') {
      return handlerInput.responseBuilder
        .speak('This permanently deletes completed items. Should I continue?')
        .addConfirmIntentDirective()
        .withShouldEndSession(false)
        .getResponse();
    }
    const deletedCount = await this.service.clearCompleted(true);
    return this.response(
      handlerInput,
      `I cleared ${deletedCount} completed ${deletedCount === 1 ? 'item' : 'items'}.`
    );
  }
}

class AlexaErrorHandler implements ErrorHandler {
  canHandle(): boolean {
    return true;
  }

  handle(handlerInput: HandlerInput, error: Error): Response {
    if (error instanceof AmbiguousItemError) {
      return handlerInput.responseBuilder
        .speak('Several items match. Please be more specific.')
        .reprompt('Which exact item did you mean?')
        .withShouldEndSession(false)
        .getResponse();
    }
    if (error instanceof ItemNotFoundError) {
      return handlerInput.responseBuilder
        .speak('I could not find that item on your shopping list.')
        .getResponse();
    }
    return handlerInput.responseBuilder
      .speak('Sorry, I could not reach your shopping list. Please try again.')
      .getResponse();
  }
}

export class AlexaSkillFactory {
  constructor(
    private readonly service: ShoppingListService,
    private readonly presenter: AlexaSpeechPresenter,
    private readonly skillId: string,
    private readonly userResolver: HouseholdUserResolver = new FixedHouseholdUserResolver()
  ) {}

  create(): Skill {
    return SkillBuilders.custom()
      .withSkillId(this.skillId)
      .addRequestHandlers(
        new LaunchHandler(),
        new HelpHandler(),
        new StopHandler(),
        new AddItemHandler('AddItemIntent', this.service, this.userResolver),
        new ListItemsHandler(this.service, this.presenter, this.userResolver),
        new RemoveItemHandler('RemoveItemIntent', this.service, this.userResolver),
        new CompleteItemHandler('CompleteItemIntent', this.service, this.userResolver),
        new ClearCompletedHandler(this.service, this.userResolver)
      )
      .addErrorHandlers(new AlexaErrorHandler())
      .create();
  }
}
