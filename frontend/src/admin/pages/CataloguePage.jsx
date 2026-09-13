import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Boxes,
  LoaderCircle,
  Package,
  PackageX,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminApi, apiError } from "@/admin/api";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Field,
  InlineNotice,
  LoadingState,
  PageHeader,
  Pagination,
  SectionCard,
  ValidationSummary,
  formatDate,
  formatMoney,
  useAdminTitle,
} from "@/admin/components/AdminUI";

const PAGE_SIZE = 20;
const CATALOGUE_QUERY_KEY = ["admin", "catalogue"];
const CATALOGUE_LIST_QUERY_KEY = [...CATALOGUE_QUERY_KEY, "list"];
const DECIMAL_RE = /^(?:\d+(?:\.\d{0,4})?|\.\d{1,4})$/;
const HSN_SAC_RE = /^[A-Z0-9]{2,16}$/;
const CATALOGUE_PAGE_STYLES = `
  .admin-page--catalogue .admin-data-view--mobile { display: none; }
  .admin-page--catalogue .admin-table-wrap { overflow-x: auto; }
  .admin-page--catalogue .admin-filters {
    display: grid;
    grid-template-columns: minmax(18rem, 1fr) minmax(9rem, auto) minmax(9rem, auto) auto;
    align-items: end;
    gap: 1rem;
  }
  .admin-page--catalogue .admin-record-list { display: grid; gap: 0.875rem; }
  .admin-dialog--catalogue {
    width: min(48rem, calc(100vw - 2rem));
    max-width: 48rem;
    max-height: calc(100dvh - 2rem);
  }
  .admin-dialog--catalogue .admin-dialog__scroll {
    max-height: calc(100dvh - 13rem);
    overflow-y: auto;
    padding-right: 0.25rem;
  }
  .admin-dialog--catalogue .admin-form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }
  .admin-dialog--catalogue .admin-field--span-2 { grid-column: 1 / -1; }
  @media (max-width: 767px) {
    .admin-page--catalogue .admin-data-view--desktop { display: none; }
    .admin-page--catalogue .admin-data-view--mobile { display: block; }
    .admin-page--catalogue .admin-filters,
    .admin-dialog--catalogue .admin-form-grid { grid-template-columns: minmax(0, 1fr); }
    .admin-dialog--catalogue .admin-field--span-2 { grid-column: auto; }
    .admin-dialog--catalogue {
      width: calc(100vw - 1rem);
      max-height: calc(100dvh - 1rem);
    }
    .admin-dialog--catalogue .admin-dialog__scroll { max-height: calc(100dvh - 12rem); }
  }
`;

function blankItem() {
  return {
    item_type: "",
    name: "",
    description: "",
    hsn_sac: "",
    unit: "NOS",
    rate: "",
    gst_rate: "",
    active: true,
  };
}

function itemFrom(source) {
  if (!source) return blankItem();
  return {
    item_type: ["goods", "service"].includes(source.item_type) ? source.item_type : "",
    name: source.name ?? "",
    description: source.description ?? "",
    hsn_sac: source.hsn_sac ?? "",
    unit: source.unit ?? "NOS",
    rate: source.rate ?? source.rate_display ?? "",
    gst_rate: source.gst_rate ?? "",
    active: source.active !== false,
  };
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function itemDto(source) {
  return {
    item_type: source.item_type,
    name: cleanText(source.name),
    description: cleanText(source.description),
    hsn_sac: cleanText(source.hsn_sac).replace(/ /g, "").toUpperCase(),
    unit: cleanText(source.unit).toUpperCase(),
    rate: cleanText(source.rate),
    gst_rate: cleanText(source.gst_rate),
    active: Boolean(source.active),
  };
}

function validationEnvelope(message, errors, status = 422) {
  return {
    response: {
      status,
      data: {
        detail: { code: "validation_error", message, errors },
      },
    },
  };
}

function requestErrorForSummary(error) {
  const detail = error?.response?.data?.detail;
  if (!Array.isArray(detail)) return error;
  return validationEnvelope(
    "Please review the highlighted catalogue details.",
    detail.map((item) => ({
      field: Array.isArray(item?.loc)
        ? item.loc.filter((part) => part !== "body").join(".") || "form"
        : "form",
      message: item?.msg || "Invalid value",
    })),
    error?.response?.status || 422,
  );
}

function normalizeRequestError(error) {
  return apiError(requestErrorForSummary(error));
}

function validateDecimal(value, { label, maximum }) {
  const normalized = cleanText(value);
  if (!normalized) return `${label} is required.`;
  if (!DECIMAL_RE.test(normalized)) return `${label} must be a decimal with up to four decimal places.`;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > maximum) {
    return `${label} must be between 0 and ${maximum}.`;
  }
  return "";
}

function validateItem(source) {
  const errors = {};
  if (!["goods", "service"].includes(source.item_type)) errors.item_type = "Choose an item type.";

  const name = cleanText(source.name);
  const description = cleanText(source.description);
  const hsnSac = cleanText(source.hsn_sac).replace(/ /g, "").toUpperCase();
  const unit = cleanText(source.unit);
  if (!name) errors.name = "Name is required.";
  else if (name.length > 240) errors.name = "Name must be 240 characters or fewer.";
  if (description.length > 3000) errors.description = "Description must be 3000 characters or fewer.";
  if (hsnSac && !HSN_SAC_RE.test(hsnSac)) {
    errors.hsn_sac = "HSN/SAC must contain 2 to 16 letters or numbers.";
  }
  if (!unit) errors.unit = "Unit is required.";
  else if (unit.length > 24) errors.unit = "Unit must be 24 characters or fewer.";

  const rateError = validateDecimal(source.rate, { label: "Rate", maximum: 9999999999.99 });
  const gstError = validateDecimal(source.gst_rate, { label: "GST rate", maximum: 100 });
  if (rateError) errors.rate = rateError;
  if (gstError) errors.gst_rate = gstError;
  return errors;
}

function validationSummary(errors) {
  const items = Object.entries(errors);
  if (!items.length) return null;
  return validationEnvelope(
    "Please correct the catalogue details below.",
    items.map(([field, message]) => ({ field, message })),
  );
}

function ItemState({ active }) {
  return (
    <span className={`admin-status admin-status--${active ? "active" : "inactive"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function ItemType({ type }) {
  return (
    <span className={`admin-type-badge admin-type-badge--${type}`}>
      {type === "goods" ? <Package aria-hidden="true" /> : <Wrench aria-hidden="true" />}
      {type === "goods" ? "Goods" : "Service"}
    </span>
  );
}

function CatalogueEditorDialog({ item, mutation, metadataQuery, gstSuggestions, unitSuggestions, onClose }) {
  const [form, setForm] = useState(() => itemFrom(item));
  const [fieldErrors, setFieldErrors] = useState({});
  const [pendingDeactivation, setPendingDeactivation] = useState(null);
  const isEditing = Boolean(item?.id);
  const formError = validationSummary(fieldErrors) || (mutation.error ? requestErrorForSummary(mutation.error) : null);

  const clearError = (field) => {
    setFieldErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([name]) => name !== field && !name.startsWith(`${field}.`)),
    ));
  };

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    clearError(field);
    mutation.reset();
  };

  const submit = (event) => {
    event.preventDefault();
    const errors = validateItem(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    const payload = itemDto(form);
    if (isEditing && item.active !== false && !payload.active) {
      setPendingDeactivation(payload);
      return;
    }
    mutation.mutate({ id: item?.id, payload });
  };

  const requestClose = () => {
    if (!mutation.isPending && !pendingDeactivation) onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent
        className="admin-dialog admin-dialog--medium admin-dialog--catalogue"
        onEscapeKeyDown={(event) => { if (mutation.isPending || pendingDeactivation) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (mutation.isPending || pendingDeactivation) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit catalogue item" : "Create catalogue item"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the reusable item details. Saving sends a complete catalogue record."
              : "Add reusable goods or services for faster invoice preparation."}
          </DialogDescription>
        </DialogHeader>

        <form className="admin-form" onSubmit={submit} noValidate>
          <div className="admin-dialog__scroll">
            <div className="admin-form-grid">
              <Field label="Item type" required error={fieldErrors.item_type}>
                <select
                  className="admin-select"
                  name="item_type"
                  value={form.item_type}
                  onChange={(event) => updateField("item_type", event.target.value)}
                  aria-invalid={Boolean(fieldErrors.item_type)}
                >
                  <option value="" disabled>Select item type</option>
                  <option value="service">Service</option>
                  <option value="goods">Goods</option>
                </select>
              </Field>

              <Field label="Name" required error={fieldErrors.name}>
                <input
                  className="admin-input"
                  name="name"
                  value={form.name}
                  onChange={(event) => updateField("name", event.target.value)}
                  maxLength={240}
                  autoFocus
                  aria-invalid={Boolean(fieldErrors.name)}
                />
              </Field>

              <Field label="Description" error={fieldErrors.description} className="admin-field--span-2">
                <textarea
                  className="admin-textarea"
                  name="description"
                  value={form.description}
                  onChange={(event) => updateField("description", event.target.value)}
                  maxLength={3000}
                  rows={4}
                />
              </Field>

              <Field label="HSN / SAC" hint="2–16 letters or numbers" error={fieldErrors.hsn_sac}>
                <input
                  className="admin-input admin-input--uppercase"
                  name="hsn_sac"
                  value={form.hsn_sac}
                  onChange={(event) => updateField("hsn_sac", event.target.value.toUpperCase())}
                  maxLength={16}
                  autoCapitalize="characters"
                  aria-invalid={Boolean(fieldErrors.hsn_sac)}
                />
              </Field>

              <Field label="Unit" required hint="Choose a suggestion or enter a custom unit" error={fieldErrors.unit}>
                <input
                  className="admin-input admin-input--uppercase"
                  name="unit"
                  value={form.unit}
                  onChange={(event) => updateField("unit", event.target.value.toUpperCase())}
                  maxLength={24}
                  list="admin-catalogue-unit-suggestions"
                  autoCapitalize="characters"
                  aria-invalid={Boolean(fieldErrors.unit)}
                />
                <datalist id="admin-catalogue-unit-suggestions">
                  {unitSuggestions.map((unit) => <option value={unit} key={unit} />)}
                </datalist>
              </Field>

              <Field label="Rate (₹)" required hint="Up to four decimal places" error={fieldErrors.rate}>
                <input
                  className="admin-input"
                  name="rate"
                  type="text"
                  inputMode="decimal"
                  value={form.rate}
                  onChange={(event) => updateField("rate", event.target.value)}
                  placeholder="Enter rate"
                  aria-invalid={Boolean(fieldErrors.rate)}
                />
              </Field>

              <Field label="GST rate (%)" required hint="Choose a suggestion or enter any valid rate from 0 to 100" error={fieldErrors.gst_rate}>
                <input
                  className="admin-input"
                  name="gst_rate"
                  type="text"
                  inputMode="decimal"
                  value={form.gst_rate}
                  onChange={(event) => updateField("gst_rate", event.target.value)}
                  placeholder="Enter GST rate"
                  list="admin-catalogue-gst-suggestions"
                  aria-invalid={Boolean(fieldErrors.gst_rate)}
                />
                <datalist id="admin-catalogue-gst-suggestions">
                  {gstSuggestions.map((rate) => <option value={rate} key={rate}>{rate}%</option>)}
                </datalist>
              </Field>
            </div>

            {metadataQuery.isPending ? (
              <LoadingState compact label="Loading rate suggestions…" />
            ) : metadataQuery.isError ? (
              <InlineNotice tone="warning" title="Suggestions unavailable">
                <p>You can still enter a custom unit and any valid GST rate from 0 to 100.</p>
                <button className="admin-button admin-button--ghost admin-button--compact" type="button" onClick={() => metadataQuery.refetch()}>
                  Retry suggestions
                </button>
              </InlineNotice>
            ) : null}

            {gstSuggestions.length ? (
              <div className="admin-suggestions" aria-label="Common GST rate suggestions">
                <span className="admin-suggestions__label">Common GST rates</span>
                <div className="admin-suggestions__list">
                  {gstSuggestions.map((rate) => (
                    <button
                      className="admin-suggestion-button"
                      type="button"
                      key={rate}
                      onClick={() => updateField("gst_rate", rate)}
                      aria-label={`Use ${rate}% GST rate`}
                      aria-pressed={form.gst_rate === rate}
                    >
                      {rate}%
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="admin-checkbox-row">
              <input
                className="admin-checkbox"
                name="active"
                type="checkbox"
                checked={form.active}
                onChange={(event) => updateField("active", event.target.checked)}
              />
              <span className="admin-checkbox-row__content">
                <strong>Active catalogue item</strong>
                <small>Inactive items remain on historical invoices but are hidden from the active list.</small>
              </span>
            </label>

            <ValidationSummary error={formError} />
          </div>

          <DialogFooter className="admin-dialog__footer">
            <button className="admin-button admin-button--ghost" type="button" onClick={requestClose} disabled={mutation.isPending}>
              Cancel
            </button>
            <button className="admin-button admin-button--primary" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : null}
              {mutation.isPending ? "Saving…" : isEditing ? "Save item" : "Create item"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingDeactivation)}
        onOpenChange={(open) => { if (!open) setPendingDeactivation(null); }}
        title="Save and deactivate catalogue item?"
        description={`${item?.name || "This item"} will be saved as inactive and hidden from the active catalogue.`}
        confirmLabel="Save and deactivate"
        busy={false}
        onConfirm={() => {
          const payload = pendingDeactivation;
          setPendingDeactivation(null);
          if (payload) mutation.mutate({ id: item.id, payload });
        }}
      />
    </>
  );
}

function ItemActions({ item, onEdit, onDeactivate }) {
  return (
    <div className="admin-row-actions">
      <button
        className="admin-button admin-button--ghost admin-button--compact"
        type="button"
        onClick={() => onEdit(item)}
        aria-label={`Edit ${item.name}`}
      >
        <Pencil aria-hidden="true" /> Edit
      </button>
      {item.active !== false ? (
        <button
          className="admin-button admin-button--danger-ghost admin-button--compact"
          type="button"
          onClick={() => onDeactivate(item)}
          aria-label={`Deactivate ${item.name}`}
        >
          <PackageX aria-hidden="true" /> Deactivate
        </button>
      ) : null}
    </div>
  );
}

function CatalogueTable({ items, onEdit, onDeactivate }) {
  return (
    <div className="admin-data-view admin-data-view--desktop">
      <div className="admin-table-wrap">
        <table className="admin-table">
          <caption className="admin-visually-hidden">Catalogue records</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Type</th>
              <th scope="col">HSN / SAC</th>
              <th scope="col">Unit</th>
              <th scope="col">Rate</th>
              <th scope="col">GST</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
              <th scope="col"><span className="admin-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <div className="admin-cell-stack">
                    <strong>{item.name}</strong>
                    <span>{item.description || "No description"}</span>
                  </div>
                </td>
                <td><ItemType type={item.item_type} /></td>
                <td>{item.hsn_sac || "—"}</td>
                <td>{item.unit}</td>
                <td><strong>{formatMoney(item.rate_paise, item.rate_display ?? item.rate)}</strong></td>
                <td>{item.gst_rate}%</td>
                <td><ItemState active={item.active !== false} /></td>
                <td>{formatDate(item.updated_at)}</td>
                <td><ItemActions item={item} onEdit={onEdit} onDeactivate={onDeactivate} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CatalogueCards({ items, onEdit, onDeactivate }) {
  return (
    <div className="admin-data-view admin-data-view--mobile">
      <div className="admin-record-list">
        {items.map((item) => (
          <article className="admin-record-card" key={item.id}>
            <div className="admin-record-card__header">
              <div className="admin-primary-cell">
                <span className="admin-record-icon" aria-hidden="true">
                  {item.item_type === "goods" ? <Package /> : <Wrench />}
                </span>
                <div>
                  <h3>{item.name}</h3>
                  <p>{item.description || "No description"}</p>
                </div>
              </div>
              <ItemState active={item.active !== false} />
            </div>
            <dl className="admin-record-card__details">
              <div><dt>Type</dt><dd><ItemType type={item.item_type} /></dd></div>
              <div><dt>HSN / SAC</dt><dd>{item.hsn_sac || "—"}</dd></div>
              <div><dt>Unit</dt><dd>{item.unit}</dd></div>
              <div><dt>Rate</dt><dd>{formatMoney(item.rate_paise, item.rate_display ?? item.rate)}</dd></div>
              <div><dt>GST</dt><dd>{item.gst_rate}%</dd></div>
              <div><dt>Updated</dt><dd>{formatDate(item.updated_at)}</dd></div>
            </dl>
            <ItemActions item={item} onEdit={onEdit} onDeactivate={onDeactivate} />
          </article>
        ))}
      </div>
    </div>
  );
}

export default function CataloguePage() {
  useAdminTitle("Catalogue");
  const queryClient = useQueryClient();
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  const active = activeFilter === "all" ? undefined : activeFilter === "active";
  const itemType = typeFilter === "all" ? undefined : typeFilter;
  const catalogueQuery = useQuery({
    queryKey: [...CATALOGUE_LIST_QUERY_KEY, {
      q: search,
      itemType: typeFilter,
      active: activeFilter,
      page,
      pageSize: PAGE_SIZE,
    }],
    queryFn: () => adminApi.catalogue.list({
      q: search,
      item_type: itemType,
      active,
      page,
      page_size: PAGE_SIZE,
    }),
  });

  const metadataQuery = useQuery({
    queryKey: [...CATALOGUE_QUERY_KEY, "metadata"],
    queryFn: adminApi.metadata,
    staleTime: 5 * 60 * 1000,
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, payload }) => (id
      ? adminApi.catalogue.update(id, payload)
      : adminApi.catalogue.create(payload)),
    onSuccess: (_savedItem, variables) => {
      queryClient.invalidateQueries({ queryKey: CATALOGUE_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["admin", "activity"] });
      toast.success(variables.id ? "Catalogue item updated." : "Catalogue item created.");
      setPage(1);
      setEditorOpen(false);
      setEditingItem(null);
    },
    onError: (error) => toast.error(normalizeRequestError(error).message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id) => adminApi.catalogue.deactivate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CATALOGUE_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["admin", "activity"] });
      toast.success("Catalogue item deactivated.");
      setPage(1);
      setDeactivateTarget(null);
    },
    onError: (error) => toast.error(normalizeRequestError(error).message),
  });

  const openCreate = () => {
    saveMutation.reset();
    setEditingItem(null);
    setEditorOpen(true);
  };

  const openEdit = (item) => {
    saveMutation.reset();
    setEditingItem(item);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saveMutation.isPending) return;
    setEditorOpen(false);
    setEditingItem(null);
    saveMutation.reset();
  };

  const submitSearch = (event) => {
    event.preventDefault();
    setSearch(searchDraft.trim());
    setPage(1);
  };

  const clearFilters = () => {
    setSearchDraft("");
    setSearch("");
    setTypeFilter("all");
    setActiveFilter("active");
    setPage(1);
  };

  const items = catalogueQuery.data?.items ?? [];
  const total = catalogueQuery.data?.total ?? 0;
  const filtersApplied = Boolean(search || typeFilter !== "all" || activeFilter !== "active");
  const gstSuggestions = Array.isArray(metadataQuery.data?.gst_rates)
    ? metadataQuery.data.gst_rates.map(String)
    : [];
  const unitSuggestions = Array.isArray(metadataQuery.data?.units)
    ? metadataQuery.data.units.map(String)
    : [];

  return (
    <div className="admin-page admin-page--catalogue">
      <style>{CATALOGUE_PAGE_STYLES}</style>
      <PageHeader
        eyebrow="Master data"
        title="Catalogue"
        description="Maintain reusable goods and services with exact pricing and tax rates."
        actions={(
          <button className="admin-button admin-button--primary" type="button" onClick={openCreate}>
            <Plus aria-hidden="true" /> New item
          </button>
        )}
      />

      <SectionCard className="admin-card--filters">
        <form className="admin-filters" role="search" onSubmit={submitSearch}>
          <Field label="Search catalogue" className="admin-filter admin-filter--search">
            <div className="admin-input-with-icon">
              <Search aria-hidden="true" />
              <input
                className="admin-input"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Name, description, or HSN/SAC"
                maxLength={200}
              />
            </div>
          </Field>
          <Field label="Type" className="admin-filter">
            <select
              className="admin-select"
              value={typeFilter}
              onChange={(event) => {
                setTypeFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All types</option>
              <option value="goods">Goods</option>
              <option value="service">Services</option>
            </select>
          </Field>
          <Field label="Status" className="admin-filter">
            <select
              className="admin-select"
              value={activeFilter}
              onChange={(event) => {
                setActiveFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All statuses</option>
            </select>
          </Field>
          <div className="admin-filter-actions">
            <button className="admin-button admin-button--outline" type="submit">
              <Search aria-hidden="true" /> Search
            </button>
            {(searchDraft || filtersApplied) ? (
              <button className="admin-button admin-button--ghost" type="button" onClick={clearFilters}>
                <RotateCcw aria-hidden="true" /> Reset
              </button>
            ) : null}
          </div>
        </form>
      </SectionCard>

      <SectionCard
        title="Catalogue items"
        description={catalogueQuery.isPending ? "Loading catalogue records…" : `${total} ${total === 1 ? "item" : "items"}`}
        action={catalogueQuery.isFetching && !catalogueQuery.isPending ? <LoadingState compact label="Refreshing…" /> : null}
        className="admin-card--data"
      >
        {catalogueQuery.isPending ? (
          <LoadingState label="Loading catalogue…" />
        ) : catalogueQuery.isError ? (
          <ErrorState error={catalogueQuery.error} onRetry={() => catalogueQuery.refetch()} title="We couldn't load the catalogue" />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={filtersApplied ? "No items match these filters" : "No active catalogue items yet"}
            copy={filtersApplied ? "Change or reset the filters to broaden the catalogue." : "Create reusable goods or services for invoice line items."}
            action={filtersApplied ? (
              <button className="admin-button admin-button--outline" type="button" onClick={clearFilters}>
                <RotateCcw aria-hidden="true" /> Reset filters
              </button>
            ) : (
              <button className="admin-button admin-button--primary" type="button" onClick={openCreate}>
                <Plus aria-hidden="true" /> Create item
              </button>
            )}
          />
        ) : (
          <>
            <CatalogueTable items={items} onEdit={openEdit} onDeactivate={setDeactivateTarget} />
            <CatalogueCards items={items} onEdit={openEdit} onDeactivate={setDeactivateTarget} />
            <Pagination
              page={catalogueQuery.data?.page ?? page}
              pageSize={catalogueQuery.data?.page_size ?? PAGE_SIZE}
              total={total}
              onPageChange={setPage}
            />
          </>
        )}
      </SectionCard>

      {editorOpen ? (
        <CatalogueEditorDialog
          item={editingItem}
          mutation={saveMutation}
          metadataQuery={metadataQuery}
          gstSuggestions={gstSuggestions}
          unitSuggestions={unitSuggestions}
          onClose={closeEditor}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(open) => {
          if (!open && !deactivateMutation.isPending) setDeactivateTarget(null);
        }}
        title="Deactivate catalogue item?"
        description={deactivateTarget
          ? `${deactivateTarget.name} will be hidden from the active catalogue but retained on historical invoices.`
          : "The catalogue item will be deactivated."}
        confirmLabel="Deactivate"
        busy={deactivateMutation.isPending}
        onConfirm={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
      />
    </div>
  );
}
