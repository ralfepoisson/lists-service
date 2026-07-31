import { ConfigurationError, UpstreamError } from '../../domain/errors.js';
import type { TodoistClient } from './TodoistClient.js';

export class TodoistProjectResolver {
  constructor(private readonly client: TodoistClient) {}

  async resolveUnique(projectName: string): Promise<string> {
    const normalizedProjectName = projectName.trim();
    const exactMatches = await this.findExactMatches(normalizedProjectName);
    if (exactMatches.length !== 1) {
      throw new ConfigurationError(
        `TODOIST_PROJECT_NAME must resolve to exactly one project; found ${exactMatches.length}.`
      );
    }
    return (exactMatches[0] as { id: string }).id;
  }

  async resolveOrCreate(projectName: string): Promise<string> {
    const normalizedProjectName = projectName.trim();
    const exactMatches = await this.findExactMatches(normalizedProjectName);
    if (exactMatches.length === 1) {
      return (exactMatches[0] as { id: string }).id;
    }
    if (exactMatches.length > 1) {
      throw new ConfigurationError(
        `TODOIST_PROJECT_NAME must resolve to at most one project before provisioning; found ${exactMatches.length}.`
      );
    }

    const created = await this.client.post('/projects', { name: normalizedProjectName });
    if (
      typeof created !== 'object' ||
      created === null ||
      !('id' in created) ||
      typeof created.id !== 'string' ||
      !('name' in created) ||
      typeof created.name !== 'string'
    ) {
      throw new UpstreamError('UPSTREAM_UNAVAILABLE', 'Todoist returned a malformed project.');
    }
    return created.id;
  }

  private async findExactMatches(
    projectName: string
  ): Promise<ReadonlyArray<{ id: string; name: string }>> {
    const payload = await this.client.get('/projects/search', {
      query: projectName,
      limit: '200'
    });
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('results' in payload) ||
      !Array.isArray(payload.results)
    ) {
      throw new UpstreamError('UPSTREAM_UNAVAILABLE', 'Todoist returned malformed projects.');
    }
    return payload.results.filter(
      (project): project is { id: string; name: string } =>
        typeof project === 'object' &&
        project !== null &&
        'id' in project &&
        typeof project.id === 'string' &&
        'name' in project &&
        typeof project.name === 'string' &&
        project.name.trim().toLocaleLowerCase('en-GB') ===
          projectName.trim().toLocaleLowerCase('en-GB')
    );
  }
}
