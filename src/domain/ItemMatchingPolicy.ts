import { AmbiguousItemError, ItemNotFoundError } from './errors.js';
import { ItemContentPolicy } from './ItemContentPolicy.js';
import type { ShoppingListItem } from './ShoppingListItem.js';

export class ItemMatchingPolicy {
  constructor(private readonly contentPolicy = new ItemContentPolicy()) {}

  findUnique(items: readonly ShoppingListItem[], spokenContent: string): ShoppingListItem {
    const target = this.contentPolicy.normaliseForComparison(spokenContent);
    const exactMatches = items.filter(
      (item) => this.contentPolicy.normaliseForComparison(item.content) === target
    );
    if (exactMatches.length === 1) {
      return exactMatches[0] as ShoppingListItem;
    }
    if (exactMatches.length > 1) {
      throw new AmbiguousItemError(exactMatches.map((item) => item.content));
    }

    const escapedTarget = target.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const conservativePattern = new RegExp(`(?:^|\\s)${escapedTarget}(?:$|\\s)`, 'u');
    const conservativeMatches = items.filter((item) =>
      conservativePattern.test(this.contentPolicy.normaliseForComparison(item.content))
    );
    if (conservativeMatches.length === 1) {
      return conservativeMatches[0] as ShoppingListItem;
    }
    if (conservativeMatches.length > 1) {
      throw new AmbiguousItemError(conservativeMatches.map((item) => item.content));
    }
    throw new ItemNotFoundError();
  }
}
