import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FilePlus2, FileText, Filter, RotateCcw, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { adminApi } from "@/admin/api";
import {
  EmptyState,
  ErrorState,
  Field,
  formatDate,
  formatMoney,
  InlineNotice,
  LoadingState,
  PageHeader,
  Pagination,
  SectionCard,
  StatusBadge,
  useAdminTitle,
} from "@/admin/components/AdminUI";

const PAGE_SIZE = 25;
const EMPTY_FILTERS = {
  q: "",
  status: "",
  date_from: "",
  date_to: "",
};

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["draft", "Draft"],
  ["issued", "Issued"],
  ["partially_paid", "Part paid"],
  ["paid", "Paid"],
  ["overdue", "Overdue"],
  ["cancelled", "Cancelled"],
];

function invoiceName(invoice) {
  return invoice.invoice_number || `Draft · ${String(invoice.id || "").slice(-6).toUpperCase()}`;
}

function hasFilters(filters) {
  return Boolean(filters.q || filters.status || filters.date_from || filters.date_to);
}

function InvoiceMobileCard({ invoice }) {
  const totals = invoice.totals || {};
  const customer = invoice.customer_snapshot || {};

  return (
    <article className="admin-invoice-card">
      <div className="admin-invoice-card__header">
        <div>
          <p className="admin-invoice-card__eyebrow">{invoice.document_title || "Invoice"}</p>
          <h2>
            <Link className="admin-link" to={`/admin/invoices/${invoice.id}`}>
              {invoiceName(invoice)}
            </Link>
          </h2>
        </div>
        <StatusBadge status={invoice.status} />
      </div>
      <dl className="admin-invoice-card__details">
        <div className="admin-invoice-card__detail">
          <dt>Customer</dt>
          <dd>{customer.display_name || customer.legal_name || "—"}</dd>
        </div>
        <div className="admin-invoice-card__detail">
          <dt>Invoice date</dt>
          <dd>{formatDate(invoice.invoice_date)}</dd>
        </div>
        <div className="admin-invoice-card__detail">
          <dt>Due date</dt>
          <dd>{formatDate(invoice.due_date)}</dd>
        </div>
        <div className="admin-invoice-card__detail">
          <dt>Total</dt>
          <dd>{formatMoney(totals.grand_total_paise, totals.grand_total_display)}</dd>
        </div>
        <div className="admin-invoice-card__detail">
          <dt>Balance</dt>
          <dd>{formatMoney(totals.balance_paise, totals.balance_display)}</dd>
        </div>
      </dl>
      <Link className="admin-button admin-button--outline admin-invoice-card__action" to={`/admin/invoices/${invoice.id}`}>
        View invoice <ArrowRight aria-hidden="true" />
      </Link>
    </article>
  );
}

export default function InvoicesPage() {
  useAdminTitle("Invoices");
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, page: 1, page_size: PAGE_SIZE });
  const [filterError, setFilterError] = useState("");

  const invoicesQuery = useQuery({
    queryKey: ["admin", "invoices", filters],
    queryFn: () => adminApi.invoices.list(filters),
  });

  function updateDraftFilter(event) {
    const { name, value } = event.target;
    setDraftFilters((current) => ({ ...current, [name]: value }));
    setFilterError("");
  }

  function applyFilters(event) {
    event.preventDefault();
    if (draftFilters.date_from && draftFilters.date_to && draftFilters.date_from > draftFilters.date_to) {
      setFilterError("The start date cannot be later than the end date.");
      return;
    }
    setFilterError("");
    setFilters({
      q: draftFilters.q.trim(),
      status: draftFilters.status,
      date_from: draftFilters.date_from,
      date_to: draftFilters.date_to,
      page: 1,
      page_size: PAGE_SIZE,
    });
  }

  function resetFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setFilters({ ...EMPTY_FILTERS, page: 1, page_size: PAGE_SIZE });
    setFilterError("");
  }

  const data = invoicesQuery.data;
  const invoices = data?.items || [];
  const filtersApplied = hasFilters(filters);

  return (
    <div className="admin-page admin-invoices-page">
      <PageHeader
        eyebrow="Billing workspace"
        title="Invoices"
        description="Find drafts, issued documents, outstanding balances, and payment status in one place."
        actions={(
          <Link className="admin-button admin-button--primary" to="/admin/invoices/new">
            <FilePlus2 aria-hidden="true" /> New invoice
          </Link>
        )}
      />

      <SectionCard className="admin-invoice-filters" title="Find an invoice" description="Search references or narrow the register by status and invoice date.">
        <form className="admin-filter-form" onSubmit={applyFilters} noValidate>
          <div className="admin-filter-form__grid">
            <Field label="Search" hint="Invoice number, customer, project, or PO reference" className="admin-filter-form__search">
              <div className="admin-input-with-icon">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  name="q"
                  value={draftFilters.q}
                  onChange={updateDraftFilter}
                  maxLength={200}
                  placeholder="Search invoices"
                  autoComplete="off"
                />
              </div>
            </Field>
            <Field label="Status">
              <select name="status" value={draftFilters.status} onChange={updateDraftFilter}>
                {STATUS_OPTIONS.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Invoice date from">
              <input
                type="date"
                name="date_from"
                value={draftFilters.date_from}
                max={draftFilters.date_to || undefined}
                onChange={updateDraftFilter}
              />
            </Field>
            <Field label="Invoice date to">
              <input
                type="date"
                name="date_to"
                value={draftFilters.date_to}
                min={draftFilters.date_from || undefined}
                onChange={updateDraftFilter}
              />
            </Field>
          </div>
          {filterError ? <p className="admin-filter-form__error" role="alert">{filterError}</p> : null}
          <div className="admin-filter-form__actions">
            <button className="admin-button admin-button--primary" type="submit" disabled={invoicesQuery.isFetching}>
              <Filter aria-hidden="true" /> Apply filters
            </button>
            <button className="admin-button admin-button--ghost" type="button" onClick={resetFilters} disabled={invoicesQuery.isFetching && !filtersApplied}>
              <RotateCcw aria-hidden="true" /> Reset
            </button>
            {invoicesQuery.isFetching && !invoicesQuery.isPending ? <LoadingState compact label="Updating register…" /> : null}
          </div>
        </form>
      </SectionCard>

      <section className="admin-invoice-register" aria-label="Invoice register" aria-busy={invoicesQuery.isFetching}>
        {invoicesQuery.isPending && !data ? <LoadingState label="Loading invoice register…" /> : null}
        {invoicesQuery.isError && !data ? <ErrorState error={invoicesQuery.error} onRetry={() => invoicesQuery.refetch()} title="We couldn't load the invoice register" /> : null}
        {invoicesQuery.isError && data ? (
          <InlineNotice tone="warning" title="The latest refresh failed">
            <div className="admin-refresh-warning__content">
              <p>The retained invoice register is still shown. Retry to load the latest server state.</p>
              <button className="admin-button admin-button--outline" type="button" onClick={() => invoicesQuery.refetch()} disabled={invoicesQuery.isFetching}>
                Retry refresh
              </button>
            </div>
          </InlineNotice>
        ) : null}
        {data && invoices.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={filtersApplied ? "No invoices match these filters" : "No invoices yet"}
            copy={filtersApplied ? "Try a broader search, another status, or a wider date range." : "Create a draft to start your private invoice register."}
            action={filtersApplied ? (
              <button className="admin-button admin-button--outline" type="button" onClick={resetFilters}>
                <RotateCcw aria-hidden="true" /> Clear filters
              </button>
            ) : (
              <Link className="admin-button admin-button--primary" to="/admin/invoices/new">
                <FilePlus2 aria-hidden="true" /> Create first invoice
              </Link>
            )}
          />
        ) : null}
        {data && invoices.length > 0 ? (
          <>
            <div className="admin-invoice-register__summary">
              <p><strong>{data.total}</strong> {data.total === 1 ? "invoice" : "invoices"}</p>
              {filtersApplied ? <span>Filtered register</span> : <span>All records</span>}
            </div>

            <div className="admin-invoice-register__table-view">
              <div className="admin-table-shell">
                <table className="admin-table admin-invoice-table">
                  <caption className="admin-table__caption">Invoices matching the applied filters</caption>
                  <thead>
                    <tr>
                      <th scope="col">Invoice</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Invoice / due</th>
                      <th scope="col">Total</th>
                      <th scope="col">Balance</th>
                      <th scope="col">Status</th>
                      <th scope="col"><span className="admin-table__action-label">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => {
                      const totals = invoice.totals || {};
                      const customer = invoice.customer_snapshot || {};
                      return (
                        <tr key={invoice.id}>
                          <td data-label="Invoice">
                            <Link className="admin-table__primary-link" to={`/admin/invoices/${invoice.id}`}>{invoiceName(invoice)}</Link>
                            <small>{invoice.document_title || "Invoice"}</small>
                          </td>
                          <td data-label="Customer">
                            <strong>{customer.display_name || customer.legal_name || "—"}</strong>
                            {invoice.project_reference ? <small>{invoice.project_reference}</small> : null}
                          </td>
                          <td data-label="Invoice / due">
                            <span>{formatDate(invoice.invoice_date)}</span>
                            <small>Due {formatDate(invoice.due_date)}</small>
                          </td>
                          <td data-label="Total">{formatMoney(totals.grand_total_paise, totals.grand_total_display)}</td>
                          <td data-label="Balance">{formatMoney(totals.balance_paise, totals.balance_display)}</td>
                          <td data-label="Status"><StatusBadge status={invoice.status} /></td>
                          <td data-label="Actions">
                            <Link className="admin-icon-button" to={`/admin/invoices/${invoice.id}`} aria-label={`View ${invoiceName(invoice)}`}>
                              <ArrowRight aria-hidden="true" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="admin-invoice-register__card-view">
              {invoices.map((invoice) => <InvoiceMobileCard key={invoice.id} invoice={invoice} />)}
            </div>

            <Pagination
              page={data.page || filters.page}
              pageSize={data.page_size || filters.page_size}
              total={data.total || 0}
              onPageChange={(page) => setFilters((current) => ({ ...current, page }))}
            />
          </>
        ) : null}
      </section>
    </div>
  );
}
