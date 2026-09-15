import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowRight, FilePlus2, FileSignature, Filter, RotateCcw, Search } from "lucide-react";
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
const CUSTOMER_QUERY = { page: 1, page_size: 200 };
const EMPTY_FILTERS = {
  q: "",
  status: "",
  customer_id: "",
  date_from: "",
  date_to: "",
};

const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["draft", "Draft"],
  ["sent", "Sent"],
  ["accepted", "Accepted"],
  ["declined", "Declined"],
  ["expired", "Expired"],
  ["converted", "Converted"],
];

function quotationName(quotation) {
  return quotation.quotation_number || "Draft";
}

function customerName(quotation) {
  const customer = quotation.customer_snapshot || quotation.draft_input?.customer_snapshot || {};
  return customer.display_name || customer.legal_name || "—";
}

function hasFilters(filters) {
  return Boolean(
    filters.q
    || filters.status
    || filters.customer_id
    || filters.date_from
    || filters.date_to,
  );
}

function QuotationMobileCard({ quotation }) {
  const totals = quotation.totals || {};

  return (
    <article className="admin-invoice-card admin-quotation-card">
      <div className="admin-invoice-card__header">
        <div>
          <p className="admin-invoice-card__eyebrow">Quotation</p>
          <h2>
            <Link className="admin-link" to={`/admin/quotations/${quotation.id}`}>
              {quotationName(quotation)}
            </Link>
          </h2>
        </div>
        <StatusBadge status={quotation.status} />
      </div>
      <dl className="admin-invoice-card__details">
        <div className="admin-invoice-card__detail">
          <dt>Customer</dt>
          <dd>{customerName(quotation)}</dd>
        </div>
        <div className="admin-invoice-card__detail">
          <dt>Quotation date</dt>
          <dd>{formatDate(quotation.quotation_date)}</dd>
        </div>
        <div className="admin-invoice-card__detail">
          <dt>Valid until</dt>
          <dd>{formatDate(quotation.valid_until)}</dd>
        </div>
        <div className="admin-invoice-card__detail">
          <dt>Quoted total</dt>
          <dd>{formatMoney(totals.grand_total_paise, totals.grand_total_display)}</dd>
        </div>
      </dl>
      <Link className="admin-button admin-button--outline admin-invoice-card__action" to={`/admin/quotations/${quotation.id}`}>
        View quotation <ArrowRight aria-hidden="true" />
      </Link>
    </article>
  );
}

export default function QuotationsPage() {
  useAdminTitle("Quotations");
  const [draftFilters, setDraftFilters] = useState(EMPTY_FILTERS);
  const [filters, setFilters] = useState({ ...EMPTY_FILTERS, page: 1, page_size: PAGE_SIZE });
  const [filterError, setFilterError] = useState("");

  const quotationsQuery = useQuery({
    queryKey: ["admin", "quotations", filters],
    queryFn: () => adminApi.quotations.list(filters),
    placeholderData: keepPreviousData,
  });
  const customersQuery = useQuery({
    queryKey: ["admin", "customers", CUSTOMER_QUERY],
    queryFn: () => adminApi.customers.list(CUSTOMER_QUERY),
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
      customer_id: draftFilters.customer_id,
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

  const data = quotationsQuery.data;
  const quotations = data?.items || [];
  const customers = customersQuery.data?.items || [];
  const filtersApplied = hasFilters(filters);

  return (
    <div className="admin-page admin-invoices-page admin-quotations-page">
      <PageHeader
        eyebrow="Proposal workspace"
        title="Quotations"
        description="Prepare, send, and track customer quotations separately from invoiced revenue and receivables."
        actions={(
          <Link className="admin-button admin-button--primary" to="/admin/quotations/new">
            <FilePlus2 aria-hidden="true" /> New quotation
          </Link>
        )}
      />

      <SectionCard
        className="admin-invoice-filters admin-quotation-filters"
        title="Find a quotation"
        description="Search quotation references or narrow the register by status, customer, and quotation date."
      >
        {customersQuery.isError ? (
          <InlineNotice tone="warning" title="Customer filter unavailable">
            The quotation register still works, but the saved-customer filter could not be loaded.
          </InlineNotice>
        ) : null}
        <form className="admin-filter-form" onSubmit={applyFilters} noValidate>
          <div className="admin-filter-form__grid admin-quotation-filter-grid">
            <Field label="Search" hint="Quotation number, customer, project, or PO reference" className="admin-filter-form__search">
              <div className="admin-input-with-icon">
                <Search aria-hidden="true" />
                <input
                  type="search"
                  name="q"
                  value={draftFilters.q}
                  onChange={updateDraftFilter}
                  maxLength={200}
                  placeholder="Search quotations"
                  autoComplete="off"
                />
              </div>
            </Field>
            <Field label="Status">
              <select name="status" value={draftFilters.status} onChange={updateDraftFilter}>
                {STATUS_OPTIONS.map(([value, label]) => <option key={value || "all"} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Customer">
              <select
                name="customer_id"
                value={draftFilters.customer_id}
                onChange={updateDraftFilter}
                disabled={customersQuery.isPending || customersQuery.isError}
              >
                <option value="">All customers</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>{customer.display_name || customer.legal_name || customer.id}</option>
                ))}
              </select>
            </Field>
            <Field label="Quotation date from">
              <input
                type="date"
                name="date_from"
                value={draftFilters.date_from}
                max={draftFilters.date_to || undefined}
                onChange={updateDraftFilter}
              />
            </Field>
            <Field label="Quotation date to">
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
            <button className="admin-button admin-button--primary" type="submit" disabled={quotationsQuery.isFetching}>
              <Filter aria-hidden="true" /> Apply filters
            </button>
            <button className="admin-button admin-button--ghost" type="button" onClick={resetFilters} disabled={quotationsQuery.isFetching && !filtersApplied}>
              <RotateCcw aria-hidden="true" /> Reset
            </button>
            {quotationsQuery.isFetching && !quotationsQuery.isPending ? <LoadingState compact label="Updating register…" /> : null}
          </div>
        </form>
      </SectionCard>

      <section className="admin-invoice-register admin-quotation-register" aria-label="Quotation register" aria-busy={quotationsQuery.isFetching}>
        {quotationsQuery.isPending && !data ? <LoadingState label="Loading quotation register…" /> : null}
        {quotationsQuery.isError && !data ? (
          <ErrorState error={quotationsQuery.error} onRetry={() => quotationsQuery.refetch()} title="We couldn't load the quotation register" />
        ) : null}
        {quotationsQuery.isError && data ? (
          <InlineNotice tone="warning" title="The latest refresh failed">
            <div className="admin-refresh-warning__content">
              <p>The retained quotation register is still shown. Retry to load the latest server state.</p>
              <button className="admin-button admin-button--outline" type="button" onClick={() => quotationsQuery.refetch()} disabled={quotationsQuery.isFetching}>
                Retry refresh
              </button>
            </div>
          </InlineNotice>
        ) : null}
        {data && quotations.length === 0 ? (
          <EmptyState
            icon={FileSignature}
            title={filtersApplied ? "No quotations match these filters" : "No quotations yet"}
            copy={filtersApplied ? "Try a broader search, another status, customer, or a wider date range." : "Create a draft to begin your quotation pipeline."}
            action={filtersApplied ? (
              <button className="admin-button admin-button--outline" type="button" onClick={resetFilters}>
                <RotateCcw aria-hidden="true" /> Clear filters
              </button>
            ) : (
              <Link className="admin-button admin-button--primary" to="/admin/quotations/new">
                <FilePlus2 aria-hidden="true" /> Create first quotation
              </Link>
            )}
          />
        ) : null}
        {data && quotations.length > 0 ? (
          <>
            <div className="admin-invoice-register__summary">
              <p><strong>{data.total}</strong> {data.total === 1 ? "quotation" : "quotations"}</p>
              {filtersApplied ? <span>Filtered register</span> : <span>All records</span>}
            </div>

            <div className="admin-invoice-register__table-view">
              <div className="admin-table-shell">
                <table className="admin-table admin-quotation-table">
                  <caption className="admin-table__caption">Quotations matching the applied filters</caption>
                  <thead>
                    <tr>
                      <th scope="col">Quotation</th>
                      <th scope="col">Customer</th>
                      <th scope="col">Quotation date</th>
                      <th scope="col">Valid until</th>
                      <th scope="col">Status</th>
                      <th scope="col">Quoted total</th>
                      <th scope="col"><span className="admin-table__action-label">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {quotations.map((quotation) => {
                      const totals = quotation.totals || {};
                      return (
                        <tr key={quotation.id}>
                          <td data-label="Quotation">
                            <Link className="admin-table__primary-link" to={`/admin/quotations/${quotation.id}`}>{quotationName(quotation)}</Link>
                            <small>{quotation.project_reference || "Quotation"}</small>
                          </td>
                          <td data-label="Customer"><strong>{customerName(quotation)}</strong></td>
                          <td data-label="Quotation date">{formatDate(quotation.quotation_date)}</td>
                          <td data-label="Valid until">{formatDate(quotation.valid_until)}</td>
                          <td data-label="Status"><StatusBadge status={quotation.status} /></td>
                          <td data-label="Quoted total">{formatMoney(totals.grand_total_paise, totals.grand_total_display)}</td>
                          <td data-label="Actions">
                            <Link className="admin-icon-button" to={`/admin/quotations/${quotation.id}`} aria-label={`View ${quotationName(quotation)} quotation`}>
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
              {quotations.map((quotation) => <QuotationMobileCard key={quotation.id} quotation={quotation} />)}
            </div>

            <Pagination
              page={filters.page}
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
