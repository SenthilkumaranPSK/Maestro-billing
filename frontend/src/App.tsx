import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/AppShell';
import { Toaster } from '@/components/ui/toaster';
import DashboardPage from '@/pages/Dashboard';
import BillingPage from '@/pages/BillingPage';
import CustomersPage from '@/pages/Customers';
import ProductsPage from '@/pages/Products';
import ServicesPage from '@/pages/Services';
import HistoryPage from '@/pages/History';
import DayReportPage from '@/pages/DayReport';
import MonthReportPage from '@/pages/MonthReport';
import GstReportPage from '@/pages/GstReport';
import SettingsPage from '@/pages/Settings';
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
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="products" element={<ProductsPage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="day-report" element={<DayReportPage />} />
            <Route path="month-report" element={<MonthReportPage />} />
            <Route path="gst-report" element={<GstReportPage />} />
            <Route path="settings" element={<SettingsPage />} />
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
