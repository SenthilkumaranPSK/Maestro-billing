import axios, { AxiosError } from 'axios';

export const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
  // Generous because a WhatsApp PDF send can take 20–30s through the backend,
  // but finite so a hung request never leaves a spinner stuck forever.
  timeout: 60_000,
});

// Surface the backend's error message ("Invalid status", "Only DRAFT bills can
// be edited", …) instead of axios's generic "Request failed with status code 400",
// so every toast in the app shows something the operator can act on.
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ error?: string; details?: Array<{ field?: string; message?: string }> }>) => {
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
