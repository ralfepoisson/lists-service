import { describe, expect, it } from 'vitest';

import { AmbiguousItemError, ItemNotFoundError } from '../../src/domain/errors.js';
import { ItemMatchingPolicy } from '../../src/domain/ItemMatchingPolicy.js';
import { ShoppingListItem } from '../../src/domain/ShoppingListItem.js';

describe('ItemMatchingPolicy', () => {
  const policy = new ItemMatchingPolicy();
  const items = [
    new ShoppingListItem('1', 'Milk', false),
    new ShoppingListItem('2', 'Oat milk', false),
    new ShoppingListItem('3', 'Cat food', false)
  ];

  it('prefers an exact case-insensitive match', () => {
    expect(policy.findUnique(items, ' milk ').id).toBe('1');
  });

  it('permits a unique conservative contained-word match', () => {
    expect(policy.findUnique(items, 'cat').id).toBe('3');
  });

  it('refuses an ambiguous conservative whole-word match', () => {
    const milkItems = [
      new ShoppingListItem('1', 'Oat milk', false),
      new ShoppingListItem('2', 'Whole milk', false)
    ];

    expect(() => policy.findUnique(milkItems, 'milk')).toThrowError(AmbiguousItemError);
  });

  it('does not match fragments inside item words', () => {
    expect(() => policy.findUnique(items, 'ilk')).toThrowError(ItemNotFoundError);
  });

  it('reports a missing item without selecting a fallback', () => {
    expect(() => policy.findUnique(items, 'dishwasher tablets')).toThrowError(ItemNotFoundError);
  });

  it('refuses duplicate exact item names as ambiguous', () => {
    const duplicateItems = [
      new ShoppingListItem('1', 'Milk', false),
      new ShoppingListItem('2', 'milk', false)
    ];

    expect(() => policy.findUnique(duplicateItems, 'MILK')).toThrowError(AmbiguousItemError);
  });
});
