import { api } from './client';
import type { Bill, Customer, ApiResponse, PaginatedResponse } from '@/types';

export const customersApi = {
  list: (params?: { search?: string; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<Customer>>('/customers', { params }).then((r) => r.data),

  get: (id: number) =>
    api.get<ApiResponse<Customer>>(`/customers/${id}`).then((r) => r.data.data),

  create: (data: Partial<Customer>) =>
    api.post<ApiResponse<Customer>>('/customers', data).then((r) => r.data.data),

  update: (id: number, data: Partial<Customer>) =>
    api.put<ApiResponse<Customer>>(`/customers/${id}`, data).then((r) => r.data.data),

  delete: (id: number) => api.delete(`/customers/${id}`),

  getBills: (id: number) =>
    api.get<ApiResponse<Bill[]>>(`/customers/${id}/bills`).then((r) => r.data.data),
};
