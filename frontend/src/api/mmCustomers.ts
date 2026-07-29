import { api } from './client';
import type { Bill, MmCustomer, ApiResponse, PaginatedResponse } from '@/types';

/** MM billing module's own customer database — mirrors customersApi exactly,
 * against the separate /mm-customers endpoint. */
export const mmCustomersApi = {
  list: (params?: { search?: string; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<MmCustomer>>('/mm-customers', { params }).then((r) => r.data),

  get: (id: number) =>
    api.get<ApiResponse<MmCustomer>>(`/mm-customers/${id}`).then((r) => r.data.data),

  create: (data: Partial<MmCustomer>) =>
    api.post<ApiResponse<MmCustomer>>('/mm-customers', data).then((r) => r.data.data),

  update: (id: number, data: Partial<MmCustomer>) =>
    api.put<ApiResponse<MmCustomer>>(`/mm-customers/${id}`, data).then((r) => r.data.data),

  delete: (id: number) => api.delete(`/mm-customers/${id}`),

  getBills: (id: number) =>
    api.get<ApiResponse<Bill[]>>(`/mm-customers/${id}/bills`).then((r) => r.data.data),
};
