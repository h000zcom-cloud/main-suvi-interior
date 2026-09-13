import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Ban,
  Copy,
  FilePenLine,
  FilePlus2,
  FileText,
  IndianRupee,
  LoaderCircle,
  LogIn,
  LogOut,
  PackageSearch,
  QrCode,
  Send,
  Settings,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";
import { adminApi } from "@/admin/api";
import {
  EmptyState,
  ErrorState,
  Field,
  formatMoney,
  LoadingState,
  PageHeader,
  Pagination,
  useAdminTitle,
} from "@/admin/components/AdminUI";

const PAGE_SIZE = 25;

const ENTITY_OPTIONS = [
  { value: "", label: "All activity" },
  { value: "invoice", label: "Invoices and payments" },
  { value: "customer", label: "Customers" },
  { value: "catalogue_item", label: "Catalogue" },
  { value: "business_settings", label: "Business settings" },
  { value: "user", label: "Authentication" },
];

const ENTITY_LABELS = {
  invoice: "Invoice",
  customer: "Customer",
  catalogue_item: "Catalogue item",
  business_settings: "Business settings",
  user: "User",
};

const ACTIONS = {
  "auth.login": { label: "Signed in", icon: LogIn },
  "auth.logout": { label: "Signed out", icon: LogOut },
  "business_settings.update": { label: "Updated business settings", icon: Settings },
  "customer.create": { label: "Created customer", icon: UserPlus },
  "customer.update": { label: "Updated customer", icon: Users },
  "customer.deactivate": { label: "Deactivated customer", icon: Ban },
  "catalogue_item.create": { label: "Created catalogue item", icon: PackageSearch },
  "catalogue_item.update": { label: "Updated catalogue item", icon: PackageSearch },
  "catalogue_item.deactivate": { label: "Deactivated catalogue item", icon: Ban },
  "invoice.create_draft": { label: "Created invoice draft", icon: FilePlus2 },
  "invoice.update_draft": { label: "Updated invoice draft", icon: FilePenLine },
  "invoice.issue": { label: "Issued invoice", icon: Send },
  "invoice.duplicate": { label: "Duplicated invoice", icon: Copy },
  "invoice.cancel": { label: "Cancelled invoice", icon: Ban },
  "invoice.e_invoice_metadata_update": { label: "Updated e-invoice metadata", icon: QrCode },
  "payment.add": { label: "Recorded payment", icon: IndianRupee },
  "payment.delete": { label: "Deleted payment", icon: Trash2 },
};

const SAFE_DETAIL_FIELDS = [
  { key: "display_name", label: "Customer" },
  { key: "name", label: "Item" },
  { key: "customer", label: "Customer" },
  { key: "invoice_number", label: "Invoice number" },
  { key: "source_invoice_id", label: "Source invoice", type: "reference" },
  { key: "reason", label: "Reason" },
  { key: "payment_id", label: "Payment reference", type: "reference" },
  { key: "amount_paise", label: "Payment amount", type: "money" },
  { key: "tds_withheld_paise", label: "TDS withheld", type: "money" },
  { key: "has_irn", label: "IRN recorded", type: "boolean" },
  { key: "has_ack", label: "Acknowledgement recorded", type: "boolean" },
  { key: "has_qr", label: "QR data recorded", type: "boolean" },
];

function readableFallback(value, fallback = "Activity recorded") {
  if (!value || typeof value !== "string") return fallback;
  const readable = value.replace(/[._]+/g, " ").trim();
  return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : fallback;
}

function compactReference(value) {
  const text = String(value || "");
  if (!text) return "Reference unavailable";
  return text.length <= 14 ? text : `…${text.slice(-8)}`;
}

function formatActivityTime(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function safeText(value) {
  if (value === null || value === undefined || value === "") return "Not provided";
  return String(value).slice(0, 240);
}

function detailValue(field, value) {
  if (field.type === "money") return formatMoney(Number(value));
  if (field.type === "boolean") return value ? "Yes" : "No";
  if (field.type === "reference") return compactReference(value);
  return safeText(value);
}

function visibleDetails(details) {
  if (!details || typeof details !== "object" || Array.isArray(details)) return [];
  return SAFE_DETAIL_FIELDS
    .filter((field) => Object.prototype.hasOwnProperty.call(details, field.key))
    .map((field) => ({ ...field, value: detailValue(field, details[field.key]) }));
}

function EntityReference({ item }) {
  const label = ENTITY_LABELS[item.entity_type] || readableFallback(item.entity_type, "Record");
  const reference = compactReference(item.entity_id);

  if (item.entity_type === "invoice" && item.entity_id) {
    return (
      <Link className="admin-activity-item__entity" to={`/admin/invoices/${item.entity_id}`}>
        <FileText aria-hidden="true" /> {label} <span>{reference}</span>
      </Link>
    );
  }

  return (
    <span className="admin-activity-item__entity">
      <FileText aria-hidden="true" /> {label} <span>{reference}</span>
    </span>
  );
}

function ActivityItem({ item }) {
  const action = ACTIONS[item.action] || { label: readableFallback(item.action), icon: Activity };
  const Icon = action.icon;
  const details = visibleDetails(item.details);
  const headingId = `admin-activity-${item.id}`;

  return (
    <li className="admin-activity-item">
      <article aria-labelledby={headingId}>
        <span className="admin-activity-item__icon" aria-hidden="true"><Icon /></span>
        <div className="admin-activity-item__content">
          <header className="admin-activity-item__header">
            <div>
              <h2 id={headingId}>{action.label}</h2>
              <EntityReference item={item} />
            </div>
            <time dateTime={item.created_at || undefined}>{formatActivityTime(item.created_at)}</time>
          </header>

          {details.length ? (
            <dl className="admin-activity-item__details">
              {details.map((detail) => (
                <div key={detail.key}>
                  <dt>{detail.label}</dt>
                  <dd>{detail.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}

          <p className="admin-activity-item__actor">
            <Users aria-hidden="true" /> Performed by <strong>{safeText(item.actor_username || "System")}</strong>
          </p>
        </div>
      </article>
    </li>
  );
}

export default function ActivityPage() {
  useAdminTitle("Activity");
  const [entityType, setEntityType] = useState("");
  const [page, setPage] = useState(1);
  const filters = useMemo(() => ({
    entity_type: entityType,
    page,
    page_size: PAGE_SIZE,
  }), [entityType, page]);
  const activityQuery = useQuery({
    queryKey: ["admin", "activity", filters],
    queryFn: () => adminApi.activity(filters),
  });

  if (activityQuery.isPending) {
    return (
      <div className="admin-page admin-activity">
        <PageHeader eyebrow="Workspace history" title="Activity" description="Review important actions across the invoice desk." />
        <LoadingState label="Loading workspace activity…" />
      </div>
    );
  }

  if (activityQuery.isError) {
    return (
      <div className="admin-page admin-activity">
        <PageHeader eyebrow="Workspace history" title="Activity" description="Review important actions across the invoice desk." />
        <ErrorState error={activityQuery.error} onRetry={() => activityQuery.refetch()} title="We couldn't load activity" />
      </div>
    );
  }

  const data = activityQuery.data;
  const items = Array.isArray(data.items) ? data.items : [];
  const total = Number(data.total) || 0;
  const responsePage = Number(data.page) || page;
  const responsePageSize = Number(data.page_size) || PAGE_SIZE;

  return (
    <div className="admin-page admin-activity">
      <PageHeader
        eyebrow="Workspace history"
        title="Activity"
        description="Review who performed important billing, customer, catalogue, and workspace actions."
      />

      <section className="admin-activity__filters" aria-labelledby="admin-activity-filters-title">
        <div className="admin-activity__filters-copy">
          <h2 id="admin-activity-filters-title">Filter activity</h2>
          <p>Narrow the timeline to one type of record.</p>
        </div>
        <Field label="Entity type" className="admin-activity__filter">
          <select
            className="admin-select"
            value={entityType}
            onChange={(event) => {
              setEntityType(event.target.value);
              setPage(1);
            }}
          >
            {ENTITY_OPTIONS.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
          </select>
        </Field>
        <p className="admin-activity__result-count" aria-live="polite">
          {activityQuery.isFetching ? <><LoaderCircle className="admin-spin" aria-hidden="true" /> Refreshing…</> : `${new Intl.NumberFormat("en-IN").format(total)} ${total === 1 ? "record" : "records"}`}
        </p>
      </section>

      {items.length ? (
        <>
          <ol className="admin-activity__list" aria-label="Workspace activity, newest first">
            {items.map((item) => <ActivityItem item={item} key={item.id} />)}
          </ol>
          <Pagination
            page={responsePage}
            pageSize={responsePageSize}
            total={total}
            onPageChange={setPage}
          />
        </>
      ) : (
        <EmptyState
          icon={Activity}
          title={entityType ? "No matching activity" : "No activity yet"}
          copy={entityType ? "No recorded actions match this entity type. Try viewing all activity." : "Important workspace actions will appear here as they are recorded."}
        />
      )}
    </div>
  );
}
