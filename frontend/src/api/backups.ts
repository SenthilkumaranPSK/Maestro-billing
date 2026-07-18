import { api } from './client';
import type { ApiResponse } from '@/types';

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

export const backupsApi = {
  list: () =>
    api.get<ApiResponse<BackupFile[]>>('/backups').then((r) => r.data.data),

  // Explicit {} body — a bodyless POST with a stray content-type gets a 415
  // from Fastify, so always send parseable JSON.
  create: () =>
    api.post<ApiResponse<{ name: string }>>('/backups', {}).then((r) => r.data.data),

  restore: (fileName: string) =>
    api.post(`/backups/${encodeURIComponent(fileName)}/restore`, {}, {
      headers: { 'X-Confirm-Restore': 'yes' },
    }),
};
