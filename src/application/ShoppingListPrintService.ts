import type { ShoppingListService } from './ShoppingListService.js';
import type { ShoppingListPdfRenderer } from './ports/ShoppingListPdfRenderer.js';

export interface GeneratedShoppingListDocument {
  readonly filename: 'shopping-list.pdf';
  readonly bytes: Buffer;
}

export class ShoppingListPrintService {
  constructor(
    private readonly shoppingList: ShoppingListService,
    private readonly renderer: ShoppingListPdfRenderer,
    private readonly now: () => Date = () => new Date()
  ) {}

  async generate(): Promise<GeneratedShoppingListDocument> {
    const items = await this.shoppingList.list('active');
    const bytes = await this.renderer.render({
      title: 'Shopping list',
      generatedAt: this.now(),
      items: items.map(({ content }) => ({ content }))
    });
    return { filename: 'shopping-list.pdf', bytes };
  }
}
