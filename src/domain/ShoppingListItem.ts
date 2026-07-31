export class ShoppingListItem {
  constructor(
    readonly id: string,
    readonly content: string,
    readonly isCompleted: boolean,
    readonly description?: string,
    readonly createdAt?: string,
    readonly completedAt?: string
  ) {}
}
