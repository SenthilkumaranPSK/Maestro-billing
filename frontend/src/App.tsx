import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/toaster';
import MmDashboardPage from '@/pages/MmDashboard';
import MmBillingPage from '@/pages/MmBilling';
import MmProductsPage from '@/pages/MmProducts';
import MmCustomersPage from '@/pages/MmCustomers';
import MmHistoryPage from '@/pages/MmHistory';
import MmSettingsPage from '@/pages/MmSettings';
import MmDayReportPage from '@/pages/MmDayReport';
import MmMonthReportPage from '@/pages/MmMonthReport';
import MmGstReportPage from '@/pages/MmGstReport';

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
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<MmDashboardPage />} />
            <Route path="billing" element={<MmBillingPage />} />
            <Route path="customers" element={<MmCustomersPage />} />
            <Route path="products" element={<MmProductsPage />} />
            <Route path="history" element={<MmHistoryPage />} />
            <Route path="day-report" element={<MmDayReportPage />} />
            <Route path="month-report" element={<MmMonthReportPage />} />
            <Route path="gst-report" element={<MmGstReportPage />} />
            <Route path="settings" element={<MmSettingsPage />} />
            {/* Embedded persistent WhatsApp Web */}
            <Route path="whatsapp" element={<div />} />

            {/* Aliases for /mm-* paths */}
            <Route path="mm-dashboard" element={<MmDashboardPage />} />
            <Route path="mm-billing" element={<MmBillingPage />} />
            <Route path="mm-products" element={<MmProductsPage />} />
            <Route path="mm-customers" element={<MmCustomersPage />} />
            <Route path="mm-history" element={<MmHistoryPage />} />
            <Route path="mm-settings" element={<MmSettingsPage />} />
            <Route path="mm-day-report" element={<MmDayReportPage />} />
            <Route path="mm-month-report" element={<MmMonthReportPage />} />
            <Route path="mm-gst-report" element={<MmGstReportPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
