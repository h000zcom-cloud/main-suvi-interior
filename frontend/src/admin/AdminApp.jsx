import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAdminAuth } from "@/admin/AuthContext";
import AdminShell from "@/admin/components/AdminShell";
import { LoadingState } from "@/admin/components/AdminUI";
import LoginPage from "@/admin/pages/LoginPage";
import DashboardPage from "@/admin/pages/DashboardPage";
import InvoicesPage from "@/admin/pages/InvoicesPage";
import InvoiceEditorPage from "@/admin/pages/InvoiceEditorPage";
import InvoiceDetailPage from "@/admin/pages/InvoiceDetailPage";
import QuotationsPage from "@/admin/pages/QuotationsPage";
import QuotationEditorPage from "@/admin/pages/QuotationEditorPage";
import QuotationDetailPage from "@/admin/pages/QuotationDetailPage";
import CustomersPage from "@/admin/pages/CustomersPage";
import CataloguePage from "@/admin/pages/CataloguePage";
import ActivityPage from "@/admin/pages/ActivityPage";
import SettingsPage from "@/admin/pages/SettingsPage";
import "@/admin/admin.css";

if (typeof document !== "undefined") {
  document.documentElement.classList.add("admin-route");
  window.posthog?.stopSessionRecording?.();
}

function ProtectedRoute({ children }) {
  const auth = useAdminAuth();
  const location = useLocation();
  if (auth.status === "loading") return <div className="admin-full-state"><LoadingState label="Securing workspace…" /></div>;
  if (auth.status !== "authenticated") {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

function AdminNotFound() {
  return (
    <div className="admin-full-state">
      <div className="admin-state admin-state--empty">
        <strong className="admin-state__code">404</strong>
        <h1>Workspace page not found</h1>
        <p>The requested admin page does not exist.</p>
        <a className="admin-button admin-button--primary" href="/admin/dashboard">Return to overview</a>
      </div>
    </div>
  );
}

function AdminRoutes() {
  useEffect(() => {
    const previousTitle = document.title;
    document.documentElement.classList.add("admin-route");
    document.body.classList.add("admin-route");

    let robots = document.querySelector('meta[name="robots"]');
    if (!robots) {
      robots = document.createElement("meta");
      robots.name = "robots";
      document.head.appendChild(robots);
    }
    robots.content = "noindex, nofollow, noarchive";
    document.querySelector('link[rel="canonical"]')?.remove();
    document.getElementById("seo-jsonld")?.remove();
    document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"]').forEach((node) => node.remove());
    const description = document.querySelector('meta[name="description"]');
    if (description) description.content = "Private Suvi Interior document administration workspace.";
    document.title = "Suvi Document Desk";

    if (window.posthog) {
      window.posthog.stopSessionRecording?.();
      window.posthog.set_config?.({ autocapture: false, capture_pageview: false, disable_session_recording: true });
    }

    return () => {
      document.body.classList.remove("admin-route");
      document.documentElement.classList.remove("admin-route");
      document.title = previousTitle;
    };
  }, []);

  return (
    <Routes>
      <Route path="/admin/login" element={<LoginPage />} />
      <Route
        element={(
          <ProtectedRoute>
            <AdminShell />
          </ProtectedRoute>
        )}
      >
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/dashboard" element={<DashboardPage />} />
        <Route path="/admin/invoices" element={<InvoicesPage />} />
        <Route path="/admin/invoices/new" element={<InvoiceEditorPage />} />
        <Route path="/admin/invoices/:invoiceId/edit" element={<InvoiceEditorPage />} />
        <Route path="/admin/invoices/:invoiceId" element={<InvoiceDetailPage />} />
        <Route path="/admin/quotations" element={<QuotationsPage />} />
        <Route path="/admin/quotations/new" element={<QuotationEditorPage />} />
        <Route path="/admin/quotations/:quotationId/edit" element={<QuotationEditorPage />} />
        <Route path="/admin/quotations/:quotationId" element={<QuotationDetailPage />} />
        <Route path="/admin/customers" element={<CustomersPage />} />
        <Route path="/admin/catalogue" element={<CataloguePage />} />
        <Route path="/admin/activity" element={<ActivityPage />} />
        <Route path="/admin/settings" element={<SettingsPage />} />
      </Route>
      <Route path="/admin/*" element={<AdminNotFound />} />
    </Routes>
  );
}

export default function AdminApp() {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30000, retry: 1, refetchOnWindowFocus: false },
      mutations: { retry: 0 },
    },
  }));

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AdminRoutes />
        <Toaster richColors position="top-right" closeButton />
      </AuthProvider>
    </QueryClientProvider>
  );
}
