import type { RequestEnvelope, ResponseEnvelope } from 'ask-sdk-model';
import { describe, expect, it } from 'vitest';

import { AlexaSkillFactory } from '../../src/adapters/alexa/AlexaSkillFactory.js';
import { AlexaSpeechPresenter } from '../../src/application/AlexaSpeechPresenter.js';
import { ShoppingListService } from '../../src/application/ShoppingListService.js';
import { ShoppingListItem } from '../../src/domain/ShoppingListItem.js';
import { InMemoryShoppingListRepository } from '../support/InMemoryShoppingListRepository.js';

class AlexaSkillFixture {
  readonly repository: InMemoryShoppingListRepository;
  readonly skill;

  constructor(items: ShoppingListItem[] = []) {
    this.repository = new InMemoryShoppingListRepository(items);
    this.skill = new AlexaSkillFactory(
      new ShoppingListService(this.repository),
      new AlexaSpeechPresenter(),
      'amzn1.ask.skill.expected'
    ).create();
  }

  async launch(): Promise<ResponseEnvelope> {
    return this.skill.invoke(this.envelope({ type: 'LaunchRequest', requestId: 'launch' }));
  }

  async intent(
    name: string,
    item?: string,
    confirmationStatus: 'CONFIRMED' | 'DENIED' | 'NONE' = 'NONE'
  ): Promise<ResponseEnvelope> {
    return this.skill.invoke(
      this.envelope({
        type: 'IntentRequest',
        requestId: `intent-${name}`,
        dialogState: 'COMPLETED',
        intent: {
          name,
          confirmationStatus,
          slots:
            item === undefined
              ? {}
              : {
                  item: {
                    name: 'item',
                    value: item,
                    confirmationStatus: 'NONE'
                  }
                }
        }
      })
    );
  }

  envelope(
    request: Record<string, unknown>,
    applicationId = 'amzn1.ask.skill.expected'
  ): RequestEnvelope {
    return {
      version: '1.0',
      context: {
        System: {
          application: { applicationId },
          user: { userId: 'household-user' },
          device: { deviceId: 'device', supportedInterfaces: {} },
          apiEndpoint: 'https://api.eu.amazonalexa.com',
          apiAccessToken: 'not-logged'
        }
      },
      request
    } as unknown as RequestEnvelope;
  }
}

const speech = (response: ResponseEnvelope): string =>
  response.response?.outputSpeech?.type === 'SSML'
    ? response.response.outputSpeech.ssml
    : (response.response?.outputSpeech?.text ?? '');

describe('AlexaSkillFactory', () => {
  it('handles launch and help', async () => {
    const fixture = new AlexaSkillFixture();

    expect(speech(await fixture.launch())).toContain('shopping list');
    expect(speech(await fixture.intent('AMAZON.HelpIntent'))).toContain('add an item');
  });

  it('adds arbitrary item phrases and reports duplicates', async () => {
    const fixture = new AlexaSkillFixture();

    expect(
      speech(await fixture.intent('AddItemIntent', 'two bottles of sparkling water'))
    ).toContain('added');
    expect(
      speech(await fixture.intent('AddItemIntent', 'TWO BOTTLES OF SPARKLING WATER'))
    ).toContain('already');
  });

  it('elicits a missing item slot', async () => {
    const fixture = new AlexaSkillFixture();

    const response = await fixture.intent('AddItemIntent');

    expect(response.response?.directives?.[0]?.type).toBe('Dialog.ElicitSlot');
  });

  it('reads empty and populated lists', async () => {
    const emptyFixture = new AlexaSkillFixture();
    const populatedFixture = new AlexaSkillFixture([new ShoppingListItem('1', 'milk', false)]);

    expect(speech(await emptyFixture.intent('ListItemsIntent'))).toContain('empty');
    expect(speech(await populatedFixture.intent('ListItemsIntent'))).toContain('milk');
  });

  it('removes and completes uniquely matched items by content', async () => {
    const fixture = new AlexaSkillFixture([
      new ShoppingListItem('1', 'milk', false),
      new ShoppingListItem('2', 'bread', false)
    ]);

    expect(speech(await fixture.intent('RemoveItemIntent', 'milk'))).toContain('removed');
    expect(speech(await fixture.intent('CompleteItemIntent', 'bread'))).toContain('bought');
    expect(fixture.repository.deletedIds).toEqual(['1']);
    expect(fixture.repository.completedIds).toEqual(['2']);
  });

  it('does not mutate an ambiguous match', async () => {
    const fixture = new AlexaSkillFixture([
      new ShoppingListItem('1', 'oat milk', false),
      new ShoppingListItem('2', 'whole milk', false)
    ]);

    expect(speech(await fixture.intent('RemoveItemIntent', 'milk'))).toContain('more specific');
    expect(fixture.repository.deletedIds).toEqual([]);
  });

  it('requires Alexa confirmation before clearing completed items', async () => {
    const fixture = new AlexaSkillFixture([new ShoppingListItem('1', 'milk', true)]);

    const pending = await fixture.intent('ClearCompletedIntent');
    const denied = await fixture.intent('ClearCompletedIntent', undefined, 'DENIED');
    const confirmed = await fixture.intent('ClearCompletedIntent', undefined, 'CONFIRMED');

    expect(pending.response?.directives?.[0]?.type).toBe('Dialog.ConfirmIntent');
    expect(speech(denied)).toContain('not clear');
    expect(speech(confirmed)).toContain('cleared 1');
  });

  it.each(['AMAZON.StopIntent', 'AMAZON.CancelIntent'])('handles %s', async (intentName) => {
    const fixture = new AlexaSkillFixture();

    expect(speech(await fixture.intent(intentName))).toContain('Goodbye');
  });

  it('rejects a request for another skill id', async () => {
    const fixture = new AlexaSkillFixture();

    await expect(
      fixture.skill.invoke(
        fixture.envelope({ type: 'LaunchRequest', requestId: 'bad' }, 'amzn1.ask.skill.other')
      )
    ).rejects.toThrow();
  });
});
