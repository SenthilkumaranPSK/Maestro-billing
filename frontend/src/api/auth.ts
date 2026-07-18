import { api } from './client';
import type { ApiResponse } from '@/types';

const TOKEN_KEY = 'maestro_token';

export interface AuthUser {
  id: number;
  username: string;
  role: string;
}

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string): void => localStorage.setItem(TOKEN_KEY, token);
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY);

export const authApi = {
  login: async (username: string, password: string): Promise<AuthUser> => {
    const res = await api.post<ApiResponse<{ token: string; user: AuthUser }>>('/auth/login', {
      username,
      password,
    });
    setToken(res.data.data.token);
    return res.data.data.user;
  },

  me: () => api.get<ApiResponse<AuthUser>>('/auth/me').then((r) => r.data.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { currentPassword, newPassword }),

  logout: (): void => {
    clearToken();
    window.location.href = '/login';
  },
};
