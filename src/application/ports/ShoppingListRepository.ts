import type { ShoppingListItem } from '../../domain/ShoppingListItem.js';

export type ItemStatus = 'active' | 'completed' | 'all';

export interface ShoppingListRepository {
  list(status: ItemStatus): Promise<ShoppingListItem[]>;
  add(content: string): Promise<ShoppingListItem>;
  delete(itemId: string): Promise<void>;
  complete(itemId: string): Promise<void>;
  reopen(itemId: string): Promise<void>;
  isReady(): Promise<boolean>;
}
