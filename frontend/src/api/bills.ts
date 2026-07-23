import { api } from './client';
import type { Bill, ApiResponse, PaginatedResponse } from '@/types';

export interface CreateBillPayload {
  customerId?: number;
  billDate: string;
  dueDate?: string;
  items: Array<{
    productId?: number;
    productName: string;
    hsnSac?: string;
    unit: string;
    qty: number;
    unitPrice: number; // paise
    gstRate: number;
  }>;
  notes?: string;
  discountAmount?: number; // paise
  roundOffAmount?: number; // paise
  // A4 "Service Bill" layout only — see backend schema.prisma Bill model.
  serviceDescription?: string;
  serviceFrom?: string;
  serviceTo?: string;
  gstInclusive?: boolean;
}

export const billsApi = {
  list: (params?: {
    status?: string;
    customerId?: number;
    from?: string;
    to?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) =>
    api
      .get<PaginatedResponse<Bill>>('/bills', { params })
      .then((r) => r.data),

  get: (id: number) =>
    api.get<ApiResponse<Bill>>(`/bills/${id}`).then((r) => r.data.data),

  getNextNumber: () =>
    api.get<ApiResponse<string>>('/bills/next-number').then((r) => r.data.data),

  create: (data: CreateBillPayload) =>
    api.post<ApiResponse<Bill>>('/bills', data).then((r) => r.data.data),

  editBill: (id: number, data: CreateBillPayload) =>
    api.put<ApiResponse<Bill>>(`/bills/${id}`, data).then((r) => r.data.data),

  delete: (id: number) => api.delete(`/bills/${id}`),
};
