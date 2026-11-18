import { api } from './client';
import type { Settings, ApiResponse } from '@/types';

export const settingsApi = {
  get: () =>
    api.get<ApiResponse<Settings>>('/settings').then((r) => r.data.data),

  verifyPin: (pin: string) =>
    api.post<ApiResponse<{ valid: boolean }>>('/settings/verify-pin', { pin }).then((r) => r.data),

  update: (key: string, value: string, group?: string, currentPin?: string) =>
    api
      .put<ApiResponse<unknown>>(
        '/settings',
        { key, value, group },
        currentPin ? { headers: { 'x-current-security-pin': currentPin } } : undefined
      )
      .then((r) => r.data.data),

  bulkUpdate: (items: Array<{ key: string; value: string; group?: string }>, currentPin?: string) =>
    api
      .put<ApiResponse<unknown>>(
        '/settings/bulk',
        items,
        currentPin ? { headers: { 'x-current-security-pin': currentPin } } : undefined
      )
      .then((r) => r.data.data),
};
