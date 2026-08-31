import type { SecretProvider } from '../../application/ports/SecretProvider.js';
import { ConfigurationError, TodoistNotConnectedError } from '../../domain/errors.js';

interface TenantConnection {
  readonly accountId: string;
  readonly tokenSecretRef: string;
  readonly shoppingProjectId?: string;
  readonly shoppingProjectName?: string;
}

export interface ResolvedTenantTodoistConnection {
  readonly token: string;
  readonly shoppingProjectId?: string;
  readonly shoppingProjectName?: string;
}

export class TenantTodoistConnectionCatalog {
  private connectionsPromise: Promise<ReadonlyMap<string, TenantConnection>> | undefined;

  constructor(
    private readonly secrets: SecretProvider,
    private readonly catalogSecretRef: string
  ) {}

  async has(accountId: string): Promise<boolean> {
    return (await this.connections()).has(accountId);
  }

  async tokenFor(accountId: string): Promise<string> {
    return (await this.connectionFor(accountId)).token;
  }

  async connectionFor(accountId: string): Promise<ResolvedTenantTodoistConnection> {
    const connection = (await this.connections()).get(accountId);
    if (connection === undefined) throw new TodoistNotConnectedError();
    return {
      token: await this.secrets.getSecret(connection.tokenSecretRef),
      ...(connection.shoppingProjectId === undefined
        ? { shoppingProjectName: connection.shoppingProjectName as string }
        : { shoppingProjectId: connection.shoppingProjectId })
    };
  }

  private connections(): Promise<ReadonlyMap<string, TenantConnection>> {
    this.connectionsPromise ??= this.load();
    return this.connectionsPromise;
  }

  private async load(): Promise<ReadonlyMap<string, TenantConnection>> {
    let value: unknown;
    try {
      value = JSON.parse(await this.secrets.getSecret(this.catalogSecretRef));
    } catch (error: unknown) {
      if (error instanceof ConfigurationError) throw error;
      throw new ConfigurationError('The Todoist tenant connection catalogue must be valid JSON.');
    }
    if (
      !this.isRecord(value) ||
      Object.keys(value).length !== 1 ||
      !Array.isArray(value['connections'])
    ) {
      throw new ConfigurationError('The Todoist tenant connection catalogue is malformed.');
    }
    const connections = new Map<string, TenantConnection>();
    for (const item of value['connections']) {
      if (
        !this.isRecord(item) ||
        Object.keys(item).some(
          (key) =>
            key !== 'accountId' &&
            key !== 'tokenSecretRef' &&
            key !== 'shoppingProjectId' &&
            key !== 'shoppingProjectName'
        ) ||
        typeof item['accountId'] !== 'string' ||
        item['accountId'].trim().length === 0 ||
        typeof item['tokenSecretRef'] !== 'string' ||
        item['tokenSecretRef'].trim().length === 0 ||
        !this.hasExactlyOneProjectSelector(item) ||
        connections.has(item['accountId'])
      ) {
        throw new ConfigurationError('The Todoist tenant connection catalogue is malformed.');
      }
      connections.set(item['accountId'], {
        accountId: item['accountId'],
        tokenSecretRef: item['tokenSecretRef'],
        ...(typeof item['shoppingProjectId'] === 'string'
          ? { shoppingProjectId: item['shoppingProjectId'] }
          : { shoppingProjectName: item['shoppingProjectName'] as string })
      });
    }
    return connections;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private hasExactlyOneProjectSelector(value: Record<string, unknown>): boolean {
    const id = value['shoppingProjectId'];
    const name = value['shoppingProjectName'];
    const hasId = typeof id === 'string' && id.trim().length > 0;
    const hasName = typeof name === 'string' && name.trim().length > 0;
    return hasId !== hasName;
  }
}
