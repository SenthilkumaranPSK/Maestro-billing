import { api } from './client';
import type { Product, ApiResponse } from '@/types';

export const productsApi = {
  list: (params?: { search?: string; active?: boolean }) =>
    api.get<ApiResponse<Product[]>>('/products', { params }).then((r) => r.data.data),

  get: (id: number) =>
    api.get<ApiResponse<Product>>(`/products/${id}`).then((r) => r.data.data),

  create: (data: Partial<Product>) =>
    api.post<ApiResponse<Product>>('/products', data).then((r) => r.data.data),

  update: (id: number, data: Partial<Product>) =>
    api.put<ApiResponse<Product>>(`/products/${id}`, data).then((r) => r.data.data),

  // Reorders the FULL active-product id list at once — the route reassigns
  // sortOrder = array index for each, so a caller always sends the whole
  // desired order, not a per-row move.
  reorder: (ids: number[]) =>
    api.put<ApiResponse<Product[]>>('/products/reorder', { ids }).then((r) => r.data.data),

  delete: (id: number) => api.delete(`/products/${id}`),
};
