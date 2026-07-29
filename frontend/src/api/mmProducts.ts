import { api } from './client';
import type { MmProduct, ApiResponse } from '@/types';

/** MM billing module's own product catalog — mirrors productsApi exactly,
 * against the separate /mm-products endpoint. */
export const mmProductsApi = {
  list: (params?: { search?: string; active?: boolean }) =>
    api.get<ApiResponse<MmProduct[]>>('/mm-products', { params }).then((r) => r.data.data),

  get: (id: number) =>
    api.get<ApiResponse<MmProduct>>(`/mm-products/${id}`).then((r) => r.data.data),

  create: (data: Partial<MmProduct>) =>
    api.post<ApiResponse<MmProduct>>('/mm-products', data).then((r) => r.data.data),

  update: (id: number, data: Partial<MmProduct>) =>
    api.put<ApiResponse<MmProduct>>(`/mm-products/${id}`, data).then((r) => r.data.data),

  delete: (id: number) => api.delete(`/mm-products/${id}`),
};
