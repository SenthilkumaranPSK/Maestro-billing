import { api } from './client';
import type { Settings, ApiResponse } from '@/types';

export const settingsApi = {
  get: () =>
    api.get<ApiResponse<Settings>>('/settings').then((r) => r.data.data),
};
