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

  // A plain navigation (not an axios/XHR request) so the browser/Electron
  // treats the response's Content-Disposition: attachment as a download —
  // in the desktop app this triggers the native Save As dialog (see
  // desktop/main.js), letting the operator choose where the copy goes.
  download: (fileName: string) => {
    window.location.href = `/api/v1/backups/${encodeURIComponent(fileName)}/download`;
  },
};
