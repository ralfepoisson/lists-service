import type {
  ItemStatus,
  ShoppingListRepository
} from '../../src/application/ports/ShoppingListRepository.js';
import { ShoppingListItem } from '../../src/domain/ShoppingListItem.js';

export class InMemoryShoppingListRepository implements ShoppingListRepository {
  readonly deletedIds: string[] = [];
  readonly completedIds: string[] = [];
  readonly reopenedIds: string[] = [];

  constructor(private readonly items: ShoppingListItem[] = []) {}

  async list(status: ItemStatus): Promise<ShoppingListItem[]> {
    if (status === 'all') {
      return [...this.items];
    }
    return this.items.filter((item) => item.isCompleted === (status === 'completed'));
  }

  async add(content: string): Promise<ShoppingListItem> {
    const item = new ShoppingListItem(String(this.items.length + 1), content, false);
    this.items.push(item);
    return item;
  }

  async delete(itemId: string): Promise<void> {
    this.deletedIds.push(itemId);
    const index = this.items.findIndex((item) => item.id === itemId);
    if (index >= 0) {
      this.items.splice(index, 1);
    }
  }

  async complete(itemId: string): Promise<void> {
    this.completedIds.push(itemId);
  }

  async reopen(itemId: string): Promise<void> {
    this.reopenedIds.push(itemId);
  }

  async isReady(): Promise<boolean> {
    return true;
  }
}
