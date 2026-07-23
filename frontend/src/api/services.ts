import { api } from './client';
import type { Service, ApiResponse } from '@/types';

export const servicesApi = {
  list: (params?: { search?: string; active?: boolean }) =>
    api.get<ApiResponse<Service[]>>('/services', { params }).then((r) => r.data.data),

  get: (id: number) =>
    api.get<ApiResponse<Service>>(`/services/${id}`).then((r) => r.data.data),

  create: (data: Partial<Service>) =>
    api.post<ApiResponse<Service>>('/services', data).then((r) => r.data.data),

  update: (id: number, data: Partial<Service>) =>
    api.put<ApiResponse<Service>>(`/services/${id}`, data).then((r) => r.data.data),

  delete: (id: number) => api.delete(`/services/${id}`),
};
