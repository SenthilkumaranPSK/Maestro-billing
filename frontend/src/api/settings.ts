import { api } from './client';
import type { Settings, ApiResponse } from '@/types';

export const settingsApi = {
  get: () =>
    api.get<ApiResponse<Settings>>('/settings').then((r) => r.data.data),

  update: (key: string, value: string, group?: string) =>
    api.put<ApiResponse<unknown>>('/settings', { key, value, group }).then((r) => r.data.data),
};
