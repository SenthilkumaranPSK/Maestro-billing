import { api } from './client';
import type { Staff, ApiResponse } from '@/types';

export const staffApi = {
  list: (params?: { active?: boolean }) =>
    api
      .get<ApiResponse<Staff[]>>('/staff', { params: params?.active === false ? { active: 'false' } : undefined })
      .then((r) => r.data.data),

  create: (name: string) =>
    api.post<ApiResponse<Staff>>('/staff', { name }).then((r) => r.data.data),

  rename: (id: number, name: string) =>
    api.put<ApiResponse<Staff>>(`/staff/${id}`, { name }).then((r) => r.data.data),

  // Reorders the FULL active-staff id list at once — the route reassigns
  // sortOrder = array index for each, so a caller always sends the whole
  // desired order, not a per-row move.
  reorder: (ids: number[]) =>
    api.put<ApiResponse<Staff[]>>('/staff/reorder', { ids }).then((r) => r.data.data),

  // Soft delete (isActive: false) — same as productsApi/servicesApi. Never
  // removes the row: a bill's billedById/billedByName is denormalized, so
  // this only affects future bills, never already-saved ones.
  deactivate: (id: number) => api.delete(`/staff/${id}`),
};
