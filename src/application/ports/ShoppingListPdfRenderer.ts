export interface PrintableShoppingListItem {
  readonly content: string;
}

export interface PrintableShoppingList {
  readonly title: string;
  readonly generatedAt: Date;
  readonly items: readonly PrintableShoppingListItem[];
}

export interface ShoppingListPdfRenderer {
  render(list: PrintableShoppingList): Promise<Buffer>;
}
