import { describe, expect, it } from 'vitest';

import { ShoppingListPrintService } from '../../src/application/ShoppingListPrintService.js';
import type {
  PrintableShoppingList,
  ShoppingListPdfRenderer
} from '../../src/application/ports/ShoppingListPdfRenderer.js';
import { ShoppingListService } from '../../src/application/ShoppingListService.js';
import { ShoppingListItem } from '../../src/domain/ShoppingListItem.js';
import { InMemoryShoppingListRepository } from '../support/InMemoryShoppingListRepository.js';

class RecordingPdfRenderer implements ShoppingListPdfRenderer {
  received?: PrintableShoppingList;

  async render(list: PrintableShoppingList): Promise<Buffer> {
    this.received = list;
    return Buffer.from('%PDF-test');
  }
}

describe('ShoppingListPrintService', () => {
  it('renders a dated snapshot of only the active provider-backed items', async () => {
    const renderer = new RecordingPdfRenderer();
    const service = new ShoppingListPrintService(
      new ShoppingListService(
        new InMemoryShoppingListRepository([
          new ShoppingListItem('1', 'Milk', false),
          new ShoppingListItem('2', 'Bread', true)
        ])
      ),
      renderer,
      () => new Date('2026-08-17T08:30:00.000Z')
    );

    const document = await service.generate();

    expect(document.filename).toBe('shopping-list.pdf');
    expect(document.bytes.toString()).toBe('%PDF-test');
    expect(renderer.received).toEqual({
      title: 'Shopping list',
      generatedAt: new Date('2026-08-17T08:30:00.000Z'),
      items: [{ content: 'Milk' }]
    });
  });
});
