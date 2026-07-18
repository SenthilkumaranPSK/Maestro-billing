import { api } from './client';
import type { ApiResponse } from '@/types';

export type WhatsAppStatus = 'DISCONNECTED' | 'CONNECTING' | 'QR_READY' | 'CONNECTED';

export interface WhatsAppStatusResponse {
  status: WhatsAppStatus;
  qrCode: string | null;
}

export const whatsappApi = {
  getStatus: async (): Promise<WhatsAppStatusResponse> => {
    const res = await api.get<ApiResponse<WhatsAppStatusResponse>>('/whatsapp/status');
    return res.data.data;
  },

  sendPdf: async (payload: {
    phone: string;
    pdfBase64: string;
    fileName: string;
    caption?: string;
  }): Promise<void> => {
    await api.post('/whatsapp/send-pdf', payload);
  },
};
