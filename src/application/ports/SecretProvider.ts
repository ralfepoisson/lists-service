export interface SecretProvider {
  getSecret(secretArn: string): Promise<string>;
}
