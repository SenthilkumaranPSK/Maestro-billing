import { api } from './client';
import type { Settings, ApiResponse } from '@/types';

// Settings are seed-managed (no editing UI) — the app only ever reads them.
export const settingsApi = {
  get: () =>
    api.get<ApiResponse<Settings>>('/settings').then((r) => r.data.data),
};
