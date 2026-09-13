import { useEffect } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, LoaderCircle, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiError } from "@/admin/api";

const STATUS_LABELS = {
  draft: "Draft",
  issued: "Issued",
  partially_paid: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

export function formatMoney(paise, display) {
  const amount = Number.isFinite(Number(paise)) ? Number(paise) / 100 : Number(display || 0);
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
}

export function formatDate(value, fallback = "—") {
  if (!value) return fallback;
  const source = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? `${value}T00:00:00` : value;
  const date = new Date(source);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function todayInput() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function useAdminTitle(title) {
  useEffect(() => {
    document.title = `${title} · Suvi Invoice Desk`;
  }, [title]);
}

export function StatusBadge({ status }) {
  return <span className={`admin-status admin-status--${status || "unknown"}`}>{STATUS_LABELS[status] || status || "Unknown"}</span>;
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="admin-page-header">
      <div>
        {eyebrow ? <p className="admin-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="admin-page-header__copy">{description}</p> : null}
      </div>
      {actions ? <div className="admin-page-header__actions">{actions}</div> : null}
    </div>
  );
}

export function LoadingState({ label = "Loading workspace…", compact = false }) {
  return (
    <div className={`admin-loading ${compact ? "admin-loading--compact" : ""}`} role="status">
      <LoaderCircle className="admin-spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry, title = "We couldn't load this view" }) {
  const normalized = error?.message && error?.code ? error : apiError(error);
  return (
    <div className="admin-state admin-state--error" role="alert">
      <AlertTriangle aria-hidden="true" />
      <div>
        <h2>{title}</h2>
        <p>{normalized.message}</p>
        {normalized.code ? <code>{normalized.code}</code> : null}
      </div>
      {onRetry ? (
        <button className="admin-button admin-button--outline" type="button" onClick={onRetry}>
          <RefreshCw aria-hidden="true" /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, copy, action, icon: Icon = Inbox }) {
  return (
    <div className="admin-state admin-state--empty">
      <Icon aria-hidden="true" />
      <h2>{title}</h2>
      {copy ? <p>{copy}</p> : null}
      {action}
    </div>
  );
}

export function SectionCard({ title, description, action, children, className = "" }) {
  return (
    <section className={`admin-card ${className}`}>
      {(title || action) ? (
        <div className="admin-card__header">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className="admin-card__body">{children}</div>
    </section>
  );
}

export function Field({ label, hint, error, required, className = "", children }) {
  return (
    <label className={`admin-field ${className}`}>
      <span className="admin-field__label">{label}{required ? <em> *</em> : null}</span>
      {children}
      {error ? <span className="admin-field__error">{error}</span> : hint ? <span className="admin-field__hint">{hint}</span> : null}
    </label>
  );
}

export function InlineNotice({ tone = "info", title, children }) {
  return (
    <div className={`admin-notice admin-notice--${tone}`}>
      {title ? <strong>{title}</strong> : null}
      <div>{children}</div>
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPageChange }) {
  const pages = Math.max(1, Math.ceil((total || 0) / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="admin-pagination" aria-label="Pagination">
      <p>Page {page} of {pages} · {total} records</p>
      <div>
        <button type="button" className="admin-icon-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">
          <ChevronLeft aria-hidden="true" />
        </button>
        <button type="button" className="admin-icon-button" disabled={page >= pages} onClick={() => onPageChange(page + 1)} aria-label="Next page">
          <ChevronRight aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = "Confirm", tone = "danger", busy, onConfirm }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-dialog admin-dialog--small">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="admin-dialog__footer">
          <button className="admin-button admin-button--ghost" type="button" onClick={() => onOpenChange(false)} disabled={busy}>Keep it</button>
          <button className={`admin-button admin-button--${tone}`} type="button" onClick={onConfirm} disabled={busy}>
            {busy ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : null}{confirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ValidationSummary({ error }) {
  const normalized = error ? apiError(error) : null;
  if (!normalized) return null;
  return (
    <div className="admin-validation" role="alert">
      <strong>{normalized.message}</strong>
      {normalized.errors.length ? (
        <ul>{normalized.errors.slice(0, 8).map((item, index) => <li key={`${item.field}-${index}`}><b>{item.field}:</b> {item.message}</li>)}</ul>
      ) : null}
    </div>
  );
}
