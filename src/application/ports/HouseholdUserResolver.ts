import type { RequestEnvelope } from 'ask-sdk-model';

export class HouseholdUser {
  constructor(readonly householdId: string) {}
}

export interface HouseholdUserResolver {
  resolve(requestEnvelope: RequestEnvelope): Promise<HouseholdUser>;
}

export class FixedHouseholdUserResolver implements HouseholdUserResolver {
  constructor(private readonly household = new HouseholdUser('default-household')) {}

  async resolve(): Promise<HouseholdUser> {
    return this.household;
  }
}
