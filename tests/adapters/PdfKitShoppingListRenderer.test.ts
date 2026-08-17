import { describe, expect, it } from 'vitest';

import { PdfKitShoppingListRenderer } from '../../src/adapters/pdf/PdfKitShoppingListRenderer.js';

describe('PdfKitShoppingListRenderer', () => {
  it('paginates a long A4 list without creating footer-only pages', async () => {
    const bytes = await new PdfKitShoppingListRenderer().render({
      title: 'Shopping list',
      generatedAt: new Date('2026-08-17T08:30:00.000Z'),
      items: Array.from({ length: 60 }, (_, index) => ({
        content: `Shopping item ${index + 1}`
      }))
    });
    const pdfStructure = bytes.toString('latin1');

    expect(pdfStructure.match(/\/Type \/Page\b/gu)).toHaveLength(3);
    expect(pdfStructure).toContain('/Count 3');
    expect(pdfStructure).toContain('(Shopping list)');
  });
});
