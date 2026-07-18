import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/toaster';
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Toaster />
        <Routes>
          <Route path="/" element={<AppShell />}>
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
