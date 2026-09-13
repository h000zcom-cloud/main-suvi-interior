import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  BookOpen,
  ChevronRight,
  FilePlus2,
  FileText,
  Gauge,
  Globe2,
  LogOut,
  Menu,
  PackageSearch,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useAdminAuth } from "@/admin/AuthContext";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

const NAV_ITEMS = [
  { to: "/admin/dashboard", label: "Overview", icon: Gauge },
  { to: "/admin/invoices", label: "Invoices", icon: FileText },
  { to: "/admin/customers", label: "Customers", icon: Users },
  { to: "/admin/catalogue", label: "Catalogue", icon: PackageSearch },
  { to: "/admin/activity", label: "Activity", icon: Activity },
  { to: "/admin/settings", label: "Business settings", icon: Settings },
];

const PAGE_TITLES = {
  dashboard: "Overview",
  invoices: "Invoices",
  customers: "Customers",
  catalogue: "Catalogue",
  activity: "Activity",
  settings: "Business settings",
};

function Navigation({ onNavigate }) {
  return (
    <nav className="admin-nav" aria-label="Invoice workspace">
      <p className="admin-nav__label">Workspace</p>
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) => `admin-nav__link ${isActive ? "is-active" : ""}`}
        >
          <Icon aria-hidden="true" />
          <span>{label}</span>
          <ChevronRight className="admin-nav__chevron" aria-hidden="true" />
        </NavLink>
      ))}
    </nav>
  );
}

export default function AdminShell() {
  const location = useLocation();
  const { user, logout } = useAdminAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const section = location.pathname.split("/")[2] || "dashboard";
  const pageTitle = location.pathname.includes("/new")
    ? "New invoice"
    : location.pathname.includes("/edit")
      ? "Edit draft"
      : PAGE_TITLES[section] || "Invoice workspace";

  useEffect(() => setMenuOpen(false), [location.pathname]);
  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 63.99rem)");
    const closeOnDesktop = (event) => {
      if (!event.matches) setMenuOpen(false);
    };
    mobileViewport.addEventListener("change", closeOnDesktop);
    return () => mobileViewport.removeEventListener("change", closeOnDesktop);
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await logout();
    } finally {
      setLoggingOut(false);
    }
  }

  const sidebar = (
    <>
      <div className="admin-brand">
        <span className="admin-brand__mark" aria-hidden="true">S</span>
        <div>
          <strong>Suvi Interior</strong>
          <span>Invoice desk</span>
        </div>
      </div>
      <Link className="admin-new-invoice" to="/admin/invoices/new" onClick={() => setMenuOpen(false)}>
        <FilePlus2 aria-hidden="true" /> New invoice
      </Link>
      <Navigation onNavigate={() => setMenuOpen(false)} />
      <div className="admin-sidebar__bottom">
        <div className="admin-privacy-chip"><ShieldCheck aria-hidden="true" /><span><b>Private workspace</b>No session recording</span></div>
        <a className="admin-site-link" href="/"><Globe2 aria-hidden="true" />View public website</a>
      </div>
    </>
  );

  return (
    <div className="admin-shell">
      <a href="#admin-main" className="admin-skip-link">Skip to workspace</a>
      <aside className="admin-sidebar">{sidebar}</aside>

      <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
        <SheetContent
          side="left"
          className="admin-mobile-drawer__panel"
          overlayClassName="admin-mobile-drawer__backdrop"
          closeClassName="admin-mobile-drawer__close"
        >
          <SheetTitle className="sr-only">Workspace navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Navigate the private invoice workspace.
          </SheetDescription>
          {sidebar}
        </SheetContent>

        <div className="admin-workspace">
          <div className="admin-topbar">
            <div className="admin-topbar__start">
              <SheetTrigger asChild>
                <button className="admin-menu-button" type="button" aria-label="Open navigation"><Menu /></button>
              </SheetTrigger>
              <div>
                <p>Suvi invoice desk</p>
                <strong>{pageTitle}</strong>
              </div>
            </div>
            <div className="admin-user">
              <span className="admin-user__avatar" aria-hidden="true">{(user?.username || "A").slice(0, 1).toUpperCase()}</span>
              <span className="admin-user__copy"><b>{user?.username || "Admin"}</b><small>Owner</small></span>
              <button className="admin-icon-button" type="button" onClick={handleLogout} disabled={loggingOut} aria-label="Sign out"><LogOut /></button>
            </div>
          </div>
          <main id="admin-main" className="admin-main" tabIndex="-1">
            <Outlet />
          </main>
          <div className="admin-workspace-note"><BookOpen aria-hidden="true" />Amounts and GST are calculated and validated by the server.</div>
        </div>
      </Sheet>
    </div>
  );
}
