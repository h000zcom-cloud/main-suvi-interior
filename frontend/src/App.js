import { lazy, Suspense, useEffect } from "react";
import { createBrowserRouter, RouterProvider, useLocation } from "react-router-dom";

function isAdminPath(pathname) {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

const documentIsAdmin = typeof window !== "undefined"
  ? typeof window.__SUVI_ADMIN__ === "boolean"
    ? window.__SUVI_ADMIN__
    : isAdminPath(window.location.pathname)
  : false;

const PublicApp = lazy(() => import("@/PublicApp"));
const AdminApp = lazy(() => import("@/admin/AdminApp"));

function RouteLoadingFallback() {
  return (
    <div className="app-route-loader" role="status" aria-live="polite">
      <span className="app-route-loader__mark" aria-hidden="true">S</span>
      <span>Loading workspace…</span>
    </div>
  );
}

function RouteBranch() {
  const { pathname } = useLocation();
  const routeIsAdmin = isAdminPath(pathname);
  const branchChanged = routeIsAdmin !== documentIsAdmin;

  useEffect(() => {
    if (branchChanged) window.location.reload();
  }, [branchChanged]);

  if (branchChanged) return <RouteLoadingFallback />;

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      {documentIsAdmin ? <AdminApp /> : <PublicApp />}
    </Suspense>
  );
}

const router = createBrowserRouter([
  { path: "*", element: <RouteBranch /> },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
