import { api } from './client';
import type { ApiResponse } from '@/types';

export interface BackupFile {
  name: string;
  size: number;
  createdAt: string;
}

export interface BackupListResult {
  backups: BackupFile[];
  /** False when the backup folder is on the same drive as the live database. */
  onSeparateDrive: boolean;
  backupDir: string;
  /** True when backupDir came from the operator-set location, not auto-detection. */
  isCustomBackupDir: boolean;
}

type BackupListMeta = { onSeparateDrive: boolean; backupDir: string; isCustomBackupDir: boolean };

export const backupsApi = {
  list: () =>
    api
      .get<ApiResponse<BackupFile[]> & { meta: BackupListMeta }>('/backups')
      .then((r): BackupListResult => ({
        backups: r.data.data,
        onSeparateDrive: r.data.meta.onSeparateDrive,
        backupDir: r.data.meta.backupDir,
        isCustomBackupDir: r.data.meta.isCustomBackupDir,
      })),

  // Sets a custom backup folder; an empty string clears it and reverts to
  // automatic D:\Billing / E:\Billing / same-drive-fallback detection.
  setLocation: (path: string) =>
    api.put<ApiResponse<{ path: string | null }>>('/backups/location', { path }).then((r) => r.data.data.path),

  // Explicit {} body — a bodyless POST with a stray content-type gets a 415
  // from Fastify, so always send parseable JSON.
  create: () =>
    api.post<ApiResponse<{ name: string }>>('/backups', {}).then((r) => r.data.data),

  // A plain navigation (not an axios/XHR request) so the browser/Electron
  // treats the response's Content-Disposition: attachment as a download —
  // in the desktop app this triggers the native Save As dialog (see
  // desktop/main.js), letting the operator choose where the copy goes.
  download: (fileName: string) => {
    window.location.href = `/api/v1/backups/${encodeURIComponent(fileName)}/download`;
  },
};
