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

  // Sends a prebuilt ESC/POS byte stream straight to the thermal printer,
  // bypassing the browser's print pipeline (which rasterises and antialiases
  // the page — the cause of blurry receipts on a 1-bit thermal head).
  printRaw: async (data: Uint8Array): Promise<void> => {
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < data.length; i += chunk) {
      binary += String.fromCharCode(...data.subarray(i, i + chunk));
    }
    await api.post<ApiResponse<{ printer: string; bytes: number }>>('/printer/raw', {
      data: btoa(binary),
    });
  },
};
