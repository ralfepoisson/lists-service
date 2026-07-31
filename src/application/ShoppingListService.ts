import { DestructiveActionNotConfirmedError, ItemNotFoundError } from '../domain/errors.js';
import { ItemContentPolicy } from '../domain/ItemContentPolicy.js';
import { ItemMatchingPolicy } from '../domain/ItemMatchingPolicy.js';
import type { ShoppingListItem } from '../domain/ShoppingListItem.js';
import type { ItemStatus, ShoppingListRepository } from './ports/ShoppingListRepository.js';

export interface AddItemResult {
  readonly item: ShoppingListItem;
  readonly alreadyExists: boolean;
}

export class ShoppingListService {
  constructor(
    private readonly repository: ShoppingListRepository,
    private readonly contentPolicy = new ItemContentPolicy(),
    private readonly matchingPolicy = new ItemMatchingPolicy(contentPolicy)
  ) {}

  async list(status: ItemStatus = 'active'): Promise<ShoppingListItem[]> {
    return this.repository.list(status);
  }

  async add(rawContent: string): Promise<AddItemResult> {
    const content = this.contentPolicy.validate(rawContent);
    const activeItems = await this.repository.list('active');
    const normalisedContent = this.contentPolicy.normaliseForComparison(content);
    const existingItem = activeItems.find(
      (item) => this.contentPolicy.normaliseForComparison(item.content) === normalisedContent
    );
    if (existingItem !== undefined) {
      return { item: existingItem, alreadyExists: true };
    }
    return { item: await this.repository.add(content), alreadyExists: false };
  }

  async deleteById(itemId: string): Promise<void> {
    this.validateItemId(itemId);
    await this.repository.delete(itemId);
  }

  async deleteByContent(content: string): Promise<ShoppingListItem> {
    const item = await this.findActiveByContent(content);
    await this.repository.delete(item.id);
    return item;
  }

  async completeById(itemId: string): Promise<void> {
    this.validateItemId(itemId);
    await this.repository.complete(itemId);
  }

  async completeByContent(content: string): Promise<ShoppingListItem> {
    const item = await this.findActiveByContent(content);
    await this.repository.complete(item.id);
    return item;
  }

  async reopenById(itemId: string): Promise<void> {
    this.validateItemId(itemId);
    await this.repository.reopen(itemId);
  }

  async clearCompleted(isConfirmed: boolean): Promise<number> {
    if (!isConfirmed) {
      throw new DestructiveActionNotConfirmedError();
    }
    const completedItems = await this.repository.list('completed');
    for (const item of completedItems) {
      await this.repository.delete(item.id);
    }
    return completedItems.length;
  }

  async isReady(): Promise<boolean> {
    return this.repository.isReady();
  }

  private async findActiveByContent(content: string): Promise<ShoppingListItem> {
    const validatedContent = this.contentPolicy.validate(content);
    const activeItems = await this.repository.list('active');
    return this.matchingPolicy.findUnique(activeItems, validatedContent);
  }

  private validateItemId(itemId: string): void {
    if (itemId.trim().length === 0 || itemId.startsWith('tmp-')) {
      throw new ItemNotFoundError();
    }
  }
}
