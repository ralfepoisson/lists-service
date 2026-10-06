/** Append-only profile discussion attributed to the verified Life2 subject. */
export interface LoopComment {
  readonly id: string;
  readonly loopId: string;
  readonly content: string;
  readonly authorSub: string;
  readonly authorEmail?: string;
  readonly createdAt: Date;
}
