import { describe, expect, it } from 'vitest';

import { ShoppingListService } from '../../src/application/ShoppingListService.js';
import { DestructiveActionNotConfirmedError } from '../../src/domain/errors.js';
import { ShoppingListItem } from '../../src/domain/ShoppingListItem.js';
import { InMemoryShoppingListRepository } from '../support/InMemoryShoppingListRepository.js';

describe('ShoppingListService', () => {
  it('returns an existing exact duplicate without creating another item', async () => {
    const repository = new InMemoryShoppingListRepository([
      new ShoppingListItem('1', 'Milk', false)
    ]);
    const service = new ShoppingListService(repository);

    const result = await service.add(' milk ');

    expect(result).toEqual({
      item: expect.objectContaining({ id: '1', content: 'Milk' }),
      alreadyExists: true
    });
    await expect(repository.list('active')).resolves.toHaveLength(1);
  });

  it('creates semantically distinct content', async () => {
    const repository = new InMemoryShoppingListRepository([
      new ShoppingListItem('1', 'milk', false)
    ]);
    const service = new ShoppingListService(repository);

    const result = await service.add('two litres of milk');

    expect(result.alreadyExists).toBe(false);
    await expect(repository.list('active')).resolves.toHaveLength(2);
  });

  it('completes a uniquely matched active item by spoken text', async () => {
    const repository = new InMemoryShoppingListRepository([
      new ShoppingListItem('1', 'dishwasher tablets', false)
    ]);
    const service = new ShoppingListService(repository);

    const item = await service.completeByContent('Dishwasher tablets');

    expect(item.id).toBe('1');
    expect(repository.completedIds).toEqual(['1']);
  });

  it('requires explicit confirmation before clearing completed items', async () => {
    const repository = new InMemoryShoppingListRepository([
      new ShoppingListItem('1', 'milk', true)
    ]);
    const service = new ShoppingListService(repository);

    await expect(service.clearCompleted(false)).rejects.toBeInstanceOf(
      DestructiveActionNotConfirmedError
    );
    expect(repository.deletedIds).toEqual([]);
  });

  it('deletes all retrieved completed items after confirmation', async () => {
    const repository = new InMemoryShoppingListRepository([
      new ShoppingListItem('1', 'milk', true),
      new ShoppingListItem('2', 'bread', true)
    ]);
    const service = new ShoppingListService(repository);

    await expect(service.clearCompleted(true)).resolves.toBe(2);
    expect(repository.deletedIds).toEqual(['1', '2']);
  });
});
