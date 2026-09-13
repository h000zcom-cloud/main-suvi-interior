import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Clock3,
  CloudOff,
  FilePenLine,
  FilePlus2,
  IndianRupee,
  ReceiptText,
  UserPlus,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import { adminApi } from "@/admin/api";
import {
  EmptyState,
  ErrorState,
  formatDate,
  formatMoney,
  InlineNotice,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
  useAdminTitle,
} from "@/admin/components/AdminUI";

const AGEING_ORDER = ["current", "1_30", "31_60", "61_90", "over_90"];

function formatCount(value) {
  return new Intl.NumberFormat("en-IN").format(Number(value) || 0);
}

function invoiceLabel(invoice) {
  return invoice.invoice_number || (invoice.status === "draft" ? "Draft invoice" : "Unnumbered invoice");
}

function customerName(invoice) {
  return invoice.customer_snapshot?.display_name || invoice.customer_snapshot?.legal_name || "Customer unavailable";
}

function InvoiceTable({ invoices }) {
  return (
    <div className="admin-recent-invoices__table-wrap">
      <table className="admin-table admin-recent-invoices__table">
        <caption className="admin-table__caption">Ten most recently created invoices</caption>
        <thead>
          <tr>
            <th scope="col">Invoice</th>
            <th scope="col">Customer</th>
            <th scope="col">Invoice date</th>
            <th scope="col">Due date</th>
            <th scope="col">Status</th>
            <th scope="col">Total</th>
            <th scope="col">Balance</th>
            <th scope="col">View</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((invoice) => {
            const label = invoiceLabel(invoice);
            return (
              <tr key={invoice.id}>
                <th scope="row"><Link className="admin-table__primary-link" to={`/admin/invoices/${invoice.id}`}>{label}</Link></th>
                <td>{customerName(invoice)}</td>
                <td>{formatDate(invoice.invoice_date)}</td>
                <td>{formatDate(invoice.due_date)}</td>
                <td><StatusBadge status={invoice.status} /></td>
                <td>{formatMoney(invoice.totals?.grand_total_paise, invoice.totals?.grand_total_display)}</td>
                <td>{formatMoney(invoice.totals?.balance_paise, invoice.totals?.balance_display)}</td>
                <td>
                  <Link className="admin-icon-button" to={`/admin/invoices/${invoice.id}`} aria-label={`View ${label}`}>
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceCards({ invoices }) {
  return (
    <ul className="admin-recent-invoices__cards" aria-label="Recent invoices">
      {invoices.map((invoice) => {
        const label = invoiceLabel(invoice);
        return (
          <li className="admin-invoice-card" key={invoice.id}>
            <article>
              <div className="admin-invoice-card__header">
                <div>
                  <Link className="admin-invoice-card__title" to={`/admin/invoices/${invoice.id}`}>{label}</Link>
                  <p>{customerName(invoice)}</p>
                </div>
                <StatusBadge status={invoice.status} />
              </div>
              <dl className="admin-invoice-card__facts">
                <div><dt>Invoice date</dt><dd>{formatDate(invoice.invoice_date)}</dd></div>
                <div><dt>Due date</dt><dd>{formatDate(invoice.due_date)}</dd></div>
                <div><dt>Total</dt><dd>{formatMoney(invoice.totals?.grand_total_paise, invoice.totals?.grand_total_display)}</dd></div>
                <div><dt>Balance</dt><dd>{formatMoney(invoice.totals?.balance_paise, invoice.totals?.balance_display)}</dd></div>
              </dl>
              <Link className="admin-invoice-card__link" to={`/admin/invoices/${invoice.id}`}>
                View invoice <ArrowRight aria-hidden="true" />
              </Link>
            </article>
          </li>
        );
      })}
    </ul>
  );
}

export default function DashboardPage() {
  useAdminTitle("Overview");
  const dashboardQuery = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: adminApi.dashboard,
  });
  const metadataQuery = useQuery({
    queryKey: ["admin", "metadata"],
    queryFn: adminApi.metadata,
  });

  if (dashboardQuery.isPending || metadataQuery.isPending) {
    return (
      <div className="admin-page admin-dashboard">
        <PageHeader eyebrow="Invoice workspace" title="Overview" description="A current view of billing and collections." />
        <LoadingState label="Preparing your invoice overview…" />
      </div>
    );
  }

  if (dashboardQuery.isError || metadataQuery.isError) {
    return (
      <div className="admin-page admin-dashboard">
        <PageHeader eyebrow="Invoice workspace" title="Overview" description="A current view of billing and collections." />
        <ErrorState
          error={dashboardQuery.error || metadataQuery.error}
          title="We couldn't prepare the overview"
          onRetry={() => {
            dashboardQuery.refetch();
            metadataQuery.refetch();
          }}
        />
      </div>
    );
  }

  const dashboard = dashboardQuery.data;
  const metadata = metadataQuery.data;
  const recentInvoices = Array.isArray(dashboard.recent_invoices) ? dashboard.recent_invoices : [];
  const ageingBuckets = AGEING_ORDER.map((key) => ({
    key,
    label: dashboard.ageing_buckets?.[key]?.label || key,
    count: Number(dashboard.ageing_buckets?.[key]?.count) || 0,
    amount_paise: Number(dashboard.ageing_buckets?.[key]?.amount_paise) || 0,
    amount_display: dashboard.ageing_buckets?.[key]?.amount_display,
  }));
  const maxAgeingAmount = Math.max(1, ...ageingBuckets.map((bucket) => bucket.amount_paise));
  const capabilities = metadata.capabilities || {};
  const irpConnected = capabilities.irp_connected === true;
  const manualEInvoiceEntry = capabilities.e_invoice_metadata_entry === "manual";
  const kpis = [
    {
      key: "receivable",
      label: "Receivable",
      value: formatMoney(dashboard.receivable_paise, dashboard.receivable_display),
      description: "Still to collect on issued, non-cancelled invoices.",
      icon: WalletCards,
    },
    {
      key: "revenue",
      label: "Invoiced revenue",
      value: formatMoney(dashboard.revenue_paise, dashboard.revenue_display),
      description: "Total invoice value, excluding drafts and cancellations.",
      icon: IndianRupee,
    },
    {
      key: "overdue",
      label: "Overdue",
      value: formatMoney(dashboard.overdue_paise, dashboard.overdue_display),
      description: `${formatCount(dashboard.overdue_count)} ${Number(dashboard.overdue_count) === 1 ? "invoice is" : "invoices are"} past due with a balance.`,
      icon: Clock3,
    },
    {
      key: "drafts",
      label: "Drafts",
      value: formatCount(dashboard.draft_count),
      description: "Saved invoices that have not been issued yet.",
      icon: FilePenLine,
    },
  ];

  return (
    <div className="admin-page admin-dashboard">
      <PageHeader
        eyebrow="Invoice workspace"
        title="Overview"
        description="Track invoice value, outstanding collections, and the work waiting for your attention."
        actions={(
          <>
            <Link className="admin-button admin-button--outline" to="/admin/customers">
              <UserPlus aria-hidden="true" /> New customer
            </Link>
            <Link className="admin-button admin-button--primary" to="/admin/invoices/new">
              <FilePlus2 aria-hidden="true" /> New invoice
            </Link>
          </>
        )}
      />

      <p className="admin-dashboard__freshness" aria-live="polite">
        {dashboardQuery.isFetching || metadataQuery.isFetching ? "Refreshing overview…" : `Updated ${formatDate(dashboard.generated_at)}`}
      </p>

      <section className="admin-kpi-grid" aria-label="Invoice summary">
        {kpis.map(({ key, label, value, description, icon: Icon }) => (
          <article className={`admin-kpi admin-kpi--${key}`} key={key}>
            <div className="admin-kpi__topline">
              <span className="admin-kpi__icon" aria-hidden="true"><Icon /></span>
              <span className="admin-kpi__label">{label}</span>
            </div>
            <strong className="admin-kpi__value">{value}</strong>
            <p>{description}</p>
          </article>
        ))}
      </section>

      <div className="admin-dashboard__grid">
        <SectionCard
          className="admin-ageing"
          title="Receivables ageing"
          description="Outstanding balances grouped by how far they are from their due date."
        >
          <ul className="admin-ageing__list">
            {ageingBuckets.map((bucket) => (
              <li className="admin-ageing__item" key={bucket.key}>
                <div className="admin-ageing__summary">
                  <div>
                    <strong>{bucket.label}</strong>
                    <span>{formatCount(bucket.count)} {bucket.count === 1 ? "open invoice" : "open invoices"}</span>
                  </div>
                  <b>{formatMoney(bucket.amount_paise, bucket.amount_display)}</b>
                </div>
                <progress
                  className="admin-ageing__progress"
                  max={maxAgeingAmount}
                  value={bucket.amount_paise}
                  aria-label={`${bucket.label}: ${formatMoney(bucket.amount_paise, bucket.amount_display)}`}
                />
              </li>
            ))}
          </ul>
          {Number(dashboard.receivable_paise) === 0 ? (
            <p className="admin-ageing__clear">There are no outstanding receivables to collect.</p>
          ) : null}
        </SectionCard>

        <SectionCard className="admin-compliance" title="E-invoice connection" description="Current Invoice Registration Portal capability.">
          <InlineNotice tone={!irpConnected || manualEInvoiceEntry ? "warning" : "success"} title={!irpConnected ? "IRP not connected" : manualEInvoiceEntry ? "Manual metadata entry" : "IRP connected"}>
            <div className="admin-compliance__message">
              <CloudOff aria-hidden="true" />
              <p>
                {!irpConnected
                  ? "This workspace does not submit invoices directly to the IRP. Register externally, then enter the IRN, acknowledgement, and QR metadata manually on the issued invoice."
                  : manualEInvoiceEntry
                    ? "E-invoice registration metadata is entered manually after registration."
                    : "Direct IRP capabilities are available for this workspace."}
              </p>
            </div>
          </InlineNotice>
          <dl className="admin-compliance__facts">
            <div><dt>IRP connection</dt><dd>{irpConnected ? "Connected" : "Not connected"}</dd></div>
            <div><dt>E-invoice metadata</dt><dd>{manualEInvoiceEntry ? "Manual entry" : "Connected workflow"}</dd></div>
          </dl>
        </SectionCard>
      </div>

      <SectionCard
        className="admin-recent-invoices"
        title="Recent invoices"
        description="The ten most recently created invoice records, including drafts."
        action={recentInvoices.length ? (
          <Link className="admin-button admin-button--ghost" to="/admin/invoices">
            All invoices <ArrowRight aria-hidden="true" />
          </Link>
        ) : null}
      >
        {recentInvoices.length ? (
          <>
            <InvoiceTable invoices={recentInvoices} />
            <InvoiceCards invoices={recentInvoices} />
          </>
        ) : (
          <EmptyState
            icon={ReceiptText}
            title="No invoices yet"
            copy="Create your first draft to begin tracking billing and collections."
            action={(
              <Link className="admin-button admin-button--primary" to="/admin/invoices/new">
                <FilePlus2 aria-hidden="true" /> Create invoice
              </Link>
            )}
          />
        )}
      </SectionCard>
    </div>
  );
}
