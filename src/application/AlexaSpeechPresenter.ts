import type { ShoppingListItem } from '../domain/ShoppingListItem.js';

export class AlexaSpeechPresenter {
  constructor(private readonly spokenItemLimit = 5) {}

  presentList(items: readonly ShoppingListItem[]): string {
    if (items.length === 0) {
      return 'Your shopping list is empty.';
    }
    const visibleItems = items.slice(0, this.spokenItemLimit);
    const spokenItems = this.joinNaturally(visibleItems.map((item) => item.content));
    const remainingCount = items.length - visibleItems.length;
    if (remainingCount > 0) {
      return `Your shopping list has ${spokenItems}, and ${remainingCount} more ${
        remainingCount === 1 ? 'item' : 'items'
      }.`;
    }
    return `Your shopping list has ${spokenItems}.`;
  }

  private joinNaturally(values: readonly string[]): string {
    if (values.length === 1) {
      return values[0] as string;
    }
    return `${values.slice(0, -1).join(', ')} and ${values.at(-1)}`;
  }
}
