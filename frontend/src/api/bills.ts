import { api } from './client';
import type { Bill, ApiResponse, PaginatedResponse } from '@/types';

export interface CreateBillPayload {
  customerId?: number;
  // MM billing module only — see backend schema.prisma Bill.mmCustomerId.
  mmCustomerId?: number;
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
  serviceDates?: string[];
  gstInclusive?: boolean;
  // MM/A4 "Tax Invoice" layout only — see backend schema.prisma Bill model.
  vehicleNo?: string;
  despatchedThrough?: string;
  destination?: string;
  otherReference?: string;
  ewayBillNo?: string;
  irnNo?: string;
  consigneeName?: string;
  consigneeAddress?: string;
  consigneeGstin?: string;
  // Which billing area this bill belongs to — see backend schema.prisma
  // Bill.series. Omit for a normal MAIN bill.
  series?: 'MAIN' | 'MM';
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
    // 'MAIN' (Thermal/A4, the studio's normal billing) or 'MM' (the separate
    // MM module) — omit to get both. See backend schema.prisma Bill.series.
    series?: 'MAIN' | 'MM';
  }) =>
    api
      .get<PaginatedResponse<Bill>>('/bills', { params })
      .then((r) => r.data),

  get: (id: number) =>
    api.get<ApiResponse<Bill>>(`/bills/${id}`).then((r) => r.data.data),

  getNextNumber: (series?: 'MAIN' | 'MM') =>
    api.get<ApiResponse<string>>('/bills/next-number', { params: series ? { series } : undefined }).then((r) => r.data.data),

  create: (data: CreateBillPayload) =>
    api.post<ApiResponse<Bill>>('/bills', data).then((r) => r.data.data),

  editBill: (id: number, data: CreateBillPayload) =>
    api.put<ApiResponse<Bill>>(`/bills/${id}`, data).then((r) => r.data.data),

  delete: (id: number) => api.delete(`/bills/${id}`),
};
