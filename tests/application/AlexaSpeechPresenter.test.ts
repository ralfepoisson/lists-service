import { describe, expect, it } from 'vitest';

import { AlexaSpeechPresenter } from '../../src/application/AlexaSpeechPresenter.js';
import { ShoppingListItem } from '../../src/domain/ShoppingListItem.js';

describe('AlexaSpeechPresenter', () => {
  const presenter = new AlexaSpeechPresenter(5);

  it('describes an empty list concisely', () => {
    expect(presenter.presentList([])).toBe('Your shopping list is empty.');
  });

  it('reads all items when there are no more than five', () => {
    const items = ['milk', 'bread'].map(
      (content, index) => new ShoppingListItem(String(index), content, false)
    );

    expect(presenter.presentList(items)).toBe('Your shopping list has milk and bread.');
  });

  it('reads five items and reports the remainder', () => {
    const items = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].map(
      (content, index) => new ShoppingListItem(String(index), content, false)
    );

    expect(presenter.presentList(items)).toContain('and 2 more items');
    expect(presenter.presentList(items)).not.toContain('six');
  });
});
