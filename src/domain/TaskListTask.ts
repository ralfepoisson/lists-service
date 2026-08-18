export class TaskListTask {
  constructor(
    readonly id: string,
    readonly listId: string,
    readonly content: string,
    readonly isCompleted: boolean,
    readonly position: number
  ) {}
}
