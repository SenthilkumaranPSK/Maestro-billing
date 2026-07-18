import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/toaster';
import { getToken } from '@/api/auth';
import LoginPage from '@/pages/Login';
import BillingPage from '@/pages/BillingPage';
import CustomersPage from '@/pages/Customers';
import ProductsPage from '@/pages/Products';
import HistoryPage from '@/pages/History';
import DayReportPage from '@/pages/DayReport';
import GstReportPage from '@/pages/GstReport';
import SettingsPage from '@/pages/Settings';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

// Redirect to the login screen when no token is stored. Token validity is
// enforced server-side — any API call with a stale token gets a 401, which
// the axios interceptor turns into a redirect here.
function RequireAuth({ children }: { children: JSX.Element }) {
  if (!getToken()) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            }
          >
            <Route index element={<Navigate to="/billing" replace />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="day-report" element={<DayReportPage />} />
            <Route path="gst-report" element={<GstReportPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/billing" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
