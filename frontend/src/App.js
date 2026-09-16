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
    <div className="app-route-loader" role="status" aria-live="polite" aria-label="Loading Suvi Interior">
      <div className="app-route-loader__frame" aria-hidden="true">
        <div className="app-route-loader__meta"><span>Nashik</span><span>Design · Make · Install</span></div>
        <div className="app-route-loader__brand">
          <span className="app-route-loader__name">suvi.</span>
          <span className="app-route-loader__caption"><strong>INTERIOR</strong><small>DESIGN &amp; MAKE</small></span>
        </div>
        <span className="app-route-loader__line"><span /></span>
      </div>
      <span className="sr-only">Loading Suvi Interior…</span>
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
