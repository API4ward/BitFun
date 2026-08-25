/**
 * UserSecretsAPI — settings CRUD for {{name}} secret variables.
 * List responses never include values.
 */

import { api } from '../index';
import { createTauriCommandError } from '../errors/TauriCommandError';

export interface UserSecretSummary {
  name: string;
  updatedAt: number;
}

export class UserSecretsAPI {
  async list(): Promise<UserSecretSummary[]> {
    try {
      return await api.invoke<UserSecretSummary[]>('list_user_secrets');
    } catch (error) {
      throw createTauriCommandError('list_user_secrets', error);
    }
  }

  async upsert(name: string, value: string): Promise<UserSecretSummary> {
    try {
      return await api.invoke<UserSecretSummary>('upsert_user_secret', {
        request: { name, value },
      });
    } catch (error) {
      throw createTauriCommandError('upsert_user_secret', error, { name });
    }
  }

  async delete(name: string): Promise<boolean> {
    try {
      return await api.invoke<boolean>('delete_user_secret', {
        request: { name },
      });
    } catch (error) {
      throw createTauriCommandError('delete_user_secret', error, { name });
    }
  }
}

export const userSecretsAPI = new UserSecretsAPI();
