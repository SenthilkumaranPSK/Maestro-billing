import { api } from './client';
import type { ApiResponse } from '@/types';

export interface ReportFile {
  name: string;
  size: number;
  createdAt: string;
}

export const reportsApi = {
  list: () =>
    api.get<ApiResponse<ReportFile[]>>('/reports').then((r) => r.data.data),

  // Omit `month` to generate the most recently completed month (the same
  // one the automatic nightly job targets) — matches backupsApi.create's
  // "explicit {} body" note: a bodyless POST with a stray content-type gets
  // a 415 from Fastify.
  generate: (month?: string) =>
    api.post<ApiResponse<{ name: string }>>('/reports/generate', month ? { month } : {}).then((r) => r.data.data),

  download: (fileName: string) => {
    window.location.href = `/api/v1/reports/${encodeURIComponent(fileName)}/download`;
  },
};
