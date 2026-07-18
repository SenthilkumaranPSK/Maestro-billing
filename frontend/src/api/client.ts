import axios, { AxiosError } from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  // Generous because a WhatsApp PDF send can take 20–30s through the backend,
  // but finite so a hung request never leaves a spinner stuck forever.
  timeout: 60_000,
});

// Attach the login token to every request. Read lazily (not at module load)
// so a login in another tab is picked up without a reload.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('maestro_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Surface the backend's error message ("Invalid status", "Only DRAFT bills can
// be edited", …) instead of axios's generic "Request failed with status code 400",
// so every toast in the app shows something the operator can act on.
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string; details?: Array<{ field?: string; message?: string }> }>) => {
    // Expired or missing token → back to the login screen (except when the
    // failed call IS the login attempt — that error belongs on the form).
    if (
      error.response?.status === 401 &&
      !error.config?.url?.includes('/auth/login') &&
      window.location.pathname !== '/login'
    ) {
      localStorage.removeItem('maestro_token');
      window.location.href = '/login';
    }
    const serverMessage = error.response?.data?.error;
    const details = error.response?.data?.details;
    if (serverMessage) {
      // Zod failures send the actionable part in `details` — "Validation
      // failed" alone tells the operator nothing about which field to fix.
      const first = Array.isArray(details) ? details[0] : undefined;
      error.message = first?.message
        ? `${serverMessage}: ${first.field ? `${first.field} — ` : ''}${first.message}`
        : serverMessage;
    } else if (error.code === 'ERR_NETWORK') {
      error.message = 'Cannot reach the billing server. Is the backend running?';
    } else if (error.code === 'ECONNABORTED') {
      error.message = 'The server took too long to respond. Please try again.';
    }
    return Promise.reject(error);
  },
);
