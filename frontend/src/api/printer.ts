import { api } from './client';
import type { ApiResponse } from '@/types';

export interface PrinterStatus {
  available: boolean;
  offline: boolean;
  printerName: string;
  matchedName: string | null;
}

export const printerApi = {
  getStatus: async (): Promise<PrinterStatus> => {
    const res = await api.get<ApiResponse<PrinterStatus>>('/printer/status');
    return res.data.data;
  },
};
