import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Building2,
  FilePlus2,
  LoaderCircle,
  Mail,
  MapPin,
  Pencil,
  Phone,
  Plus,
  RotateCcw,
  Search,
  UserRound,
  UserX,
  UsersRound,
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
  LoadingState,
  PageHeader,
  Pagination,
  SectionCard,
  ValidationSummary,
  formatDate,
  useAdminTitle,
} from "@/admin/components/AdminUI";

const PAGE_SIZE = 20;
const CUSTOMER_QUERY_KEY = ["admin", "customers"];
const CUSTOMER_LIST_QUERY_KEY = [...CUSTOMER_QUERY_KEY, "list"];
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUSTOMER_PAGE_STYLES = `
  .admin-page--customers .admin-data-view--mobile { display: none; }
  .admin-page--customers .admin-table-wrap { overflow-x: auto; }
  .admin-page--customers .admin-filters {
    display: grid;
    grid-template-columns: minmax(18rem, 1fr) minmax(10rem, auto) auto;
    align-items: end;
    gap: 1rem;
  }
  .admin-page--customers .admin-record-list { display: grid; gap: 0.875rem; }
  .admin-dialog--customer {
    width: min(60rem, calc(100vw - 2rem));
    max-width: 60rem;
    max-height: calc(100dvh - 2rem);
  }
  .admin-dialog--customer .admin-dialog__scroll {
    max-height: calc(100dvh - 13rem);
    overflow-y: auto;
    padding-right: 0.25rem;
  }
  .admin-dialog--customer .admin-form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1rem;
  }
  .admin-dialog--customer .admin-field--span-2 { grid-column: 1 / -1; }
  @media (max-width: 767px) {
    .admin-page--customers .admin-data-view--desktop { display: none; }
    .admin-page--customers .admin-data-view--mobile { display: block; }
    .admin-page--customers .admin-filters,
    .admin-dialog--customer .admin-form-grid { grid-template-columns: minmax(0, 1fr); }
    .admin-dialog--customer .admin-field--span-2 { grid-column: auto; }
    .admin-dialog--customer {
      width: calc(100vw - 1rem);
      max-height: calc(100dvh - 1rem);
    }
    .admin-dialog--customer .admin-dialog__scroll { max-height: calc(100dvh - 12rem); }
  }
`;

function blankAddress() {
  return {
    line1: "",
    line2: "",
    line3: "",
    city: "",
    state: "",
    state_code: "",
    pincode: "",
    country: "India",
  };
}

function addressFrom(source) {
  return {
    line1: source?.line1 ?? "",
    line2: source?.line2 ?? "",
    line3: source?.line3 ?? "",
    city: source?.city ?? "",
    state: source?.state ?? "",
    state_code: source?.state_code ?? "",
    pincode: source?.pincode ?? "",
    country: source?.country ?? "India",
  };
}

function blankCustomer() {
  return {
    customer_type: "",
    legal_name: "",
    display_name: "",
    gstin: "",
    pan: "",
    contact_person: "",
    phone: "",
    email: "",
    billing_address: blankAddress(),
    shipping_same_as_billing: true,
    shipping_address: blankAddress(),
    notes: "",
    active: true,
  };
}

function customerFrom(source) {
  if (!source) return blankCustomer();
  return {
    customer_type: ["business", "individual"].includes(source.customer_type) ? source.customer_type : "",
    legal_name: source.legal_name ?? "",
    display_name: source.display_name ?? "",
    gstin: source.gstin ?? "",
    pan: source.pan ?? "",
    contact_person: source.contact_person ?? "",
    phone: source.phone ?? "",
    email: source.email ?? "",
    billing_address: addressFrom(source.billing_address),
    shipping_same_as_billing: source.shipping_same_as_billing !== false,
    shipping_address: addressFrom(source.shipping_address),
    notes: source.notes ?? "",
    active: source.active !== false,
  };
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function addressDto(source) {
  return {
    line1: cleanText(source?.line1),
    line2: cleanText(source?.line2),
    line3: cleanText(source?.line3),
    city: cleanText(source?.city),
    state: cleanText(source?.state),
    state_code: cleanText(source?.state_code),
    pincode: cleanText(source?.pincode),
    country: cleanText(source?.country),
  };
}

function customerDto(source) {
  const shippingSame = Boolean(source.shipping_same_as_billing);
  return {
    customer_type: source.customer_type,
    legal_name: cleanText(source.legal_name),
    display_name: cleanText(source.display_name),
    gstin: cleanText(source.gstin).toUpperCase(),
    pan: cleanText(source.pan).toUpperCase(),
    contact_person: cleanText(source.contact_person),
    phone: cleanText(source.phone),
    email: cleanText(source.email).toLowerCase(),
    billing_address: addressDto(source.billing_address),
    shipping_same_as_billing: shippingSame,
    shipping_address: shippingSame ? null : addressDto(source.shipping_address),
    notes: cleanText(source.notes),
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
    "Please review the highlighted customer details.",
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

function addLengthError(errors, field, value, maximum, label, required = false) {
  const length = cleanText(value).length;
  if (required && !length) errors[field] = `${label} is required.`;
  else if (length > maximum) errors[field] = `${label} must be ${maximum} characters or fewer.`;
}

function validateAddress(source, prefix, errors) {
  [
    ["line1", 240, "Address line 1"],
    ["line2", 240, "Address line 2"],
    ["line3", 240, "Address line 3"],
    ["city", 120, "City"],
    ["state", 120, "State"],
    ["country", 80, "Country"],
  ].forEach(([field, maximum, label]) => {
    addLengthError(errors, `${prefix}.${field}`, source?.[field], maximum, label);
  });

  const stateCode = cleanText(source?.state_code);
  const pincode = cleanText(source?.pincode);
  if (stateCode && !/^\d{2}$/.test(stateCode)) {
    errors[`${prefix}.state_code`] = "State code must contain exactly two digits.";
  }
  if (pincode && !/^[1-9]\d{5}$/.test(pincode)) {
    errors[`${prefix}.pincode`] = "PIN code must be a valid six-digit Indian PIN code.";
  }
}

function validateCustomer(source) {
  const errors = {};
  if (!["business", "individual"].includes(source.customer_type)) {
    errors.customer_type = "Choose a customer type.";
  }
  addLengthError(errors, "display_name", source.display_name, 200, "Display name", true);
  addLengthError(errors, "legal_name", source.legal_name, 200, "Legal name");
  addLengthError(errors, "contact_person", source.contact_person, 160, "Contact person");
  addLengthError(errors, "phone", source.phone, 30, "Phone");
  addLengthError(errors, "email", source.email, 254, "Email");
  addLengthError(errors, "notes", source.notes, 5000, "Notes");

  const gstin = cleanText(source.gstin).toUpperCase();
  const pan = cleanText(source.pan).toUpperCase();
  const email = cleanText(source.email);
  const phone = cleanText(source.phone);
  const stateCode = cleanText(source.billing_address?.state_code);
  if (gstin && !GSTIN_RE.test(gstin)) errors.gstin = "Enter a valid 15-character GSTIN.";
  if (pan && !PAN_RE.test(pan)) errors.pan = "Enter a valid 10-character PAN.";
  if (email && !EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";
  if (phone) {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15) errors.phone = "Phone must contain 7 to 15 digits.";
  }
  if (gstin && stateCode && gstin.slice(0, 2) !== stateCode) {
    errors.gstin = "GSTIN state code must match the billing state code.";
  }

  validateAddress(source.billing_address, "billing_address", errors);
  if (!source.shipping_same_as_billing) {
    if (!source.shipping_address) errors.shipping_address = "Enter a shipping address.";
    else validateAddress(source.shipping_address, "shipping_address", errors);
  }
  return errors;
}

function validationSummary(errors) {
  const items = Object.entries(errors);
  if (!items.length) return null;
  return validationEnvelope(
    "Please correct the customer details below.",
    items.map(([field, message]) => ({ field, message })),
  );
}

function addressSummary(address) {
  if (!address) return "No address added";
  return [address.line1, address.city, address.state, address.pincode].filter(Boolean).join(", ") || "No address added";
}

function CustomerState({ active }) {
  return (
    <span className={`admin-status admin-status--${active ? "active" : "inactive"}`}>
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function AddressFields({ prefix, title, description, value, errors, onChange }) {
  const errorFor = (field) => errors[`${prefix}.${field}`];
  return (
    <fieldset className="admin-form-section">
      <legend className="admin-form-section__title">{title}</legend>
      {description ? <p className="admin-form-section__copy">{description}</p> : null}
      <div className="admin-form-grid">
        <Field label="Address line 1" error={errorFor("line1")} className="admin-field--span-2">
          <input
            className="admin-input"
            name={`${prefix}.line1`}
            value={value.line1}
            onChange={(event) => onChange("line1", event.target.value)}
            maxLength={240}
            autoComplete="address-line1"
          />
        </Field>
        <Field label="Address line 2" error={errorFor("line2")} className="admin-field--span-2">
          <input
            className="admin-input"
            name={`${prefix}.line2`}
            value={value.line2}
            onChange={(event) => onChange("line2", event.target.value)}
            maxLength={240}
            autoComplete="address-line2"
          />
        </Field>
        <Field label="Address line 3" error={errorFor("line3")} className="admin-field--span-2">
          <input
            className="admin-input"
            name={`${prefix}.line3`}
            value={value.line3}
            onChange={(event) => onChange("line3", event.target.value)}
            maxLength={240}
            autoComplete="address-line3"
          />
        </Field>
        <Field label="City" error={errorFor("city")}>
          <input
            className="admin-input"
            name={`${prefix}.city`}
            value={value.city}
            onChange={(event) => onChange("city", event.target.value)}
            maxLength={120}
            autoComplete="address-level2"
          />
        </Field>
        <Field label="State" error={errorFor("state")}>
          <input
            className="admin-input"
            name={`${prefix}.state`}
            value={value.state}
            onChange={(event) => onChange("state", event.target.value)}
            maxLength={120}
            autoComplete="address-level1"
          />
        </Field>
        <Field label="State code" hint="Two-digit GST state code" error={errorFor("state_code")}>
          <input
            className="admin-input"
            name={`${prefix}.state_code`}
            value={value.state_code}
            onChange={(event) => onChange("state_code", event.target.value)}
            maxLength={2}
            inputMode="numeric"
            aria-invalid={Boolean(errorFor("state_code"))}
          />
        </Field>
        <Field label="PIN code" error={errorFor("pincode")}>
          <input
            className="admin-input"
            name={`${prefix}.pincode`}
            value={value.pincode}
            onChange={(event) => onChange("pincode", event.target.value)}
            maxLength={6}
            inputMode="numeric"
            autoComplete="postal-code"
            aria-invalid={Boolean(errorFor("pincode"))}
          />
        </Field>
        <Field label="Country" error={errorFor("country")} className="admin-field--span-2">
          <input
            className="admin-input"
            name={`${prefix}.country`}
            value={value.country}
            onChange={(event) => onChange("country", event.target.value)}
            maxLength={80}
            autoComplete="country-name"
          />
        </Field>
      </div>
    </fieldset>
  );
}

function CustomerEditorDialog({ customer, mutation, onClose }) {
  const [form, setForm] = useState(() => customerFrom(customer));
  const [fieldErrors, setFieldErrors] = useState({});
  const [pendingDeactivation, setPendingDeactivation] = useState(null);
  const isEditing = Boolean(customer?.id);
  const formError = validationSummary(fieldErrors) || (mutation.error ? requestErrorForSummary(mutation.error) : null);

  const clearErrors = (...fields) => {
    setFieldErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([name]) => !fields.some((field) => name === field || name.startsWith(`${field}.`))),
    ));
  };

  const updateField = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
    clearErrors(field, ...(field === "shipping_same_as_billing" ? ["shipping_address"] : []));
    mutation.reset();
  };

  const updateAddress = (section, field, value) => {
    setForm((current) => ({
      ...current,
      [section]: { ...current[section], [field]: value },
    }));
    clearErrors(`${section}.${field}`, ...(section === "billing_address" && field === "state_code" ? ["gstin"] : []));
    mutation.reset();
  };

  const submit = (event) => {
    event.preventDefault();
    const errors = validateCustomer(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;
    const payload = customerDto(form);
    if (isEditing && customer.active !== false && !payload.active) {
      setPendingDeactivation(payload);
      return;
    }
    mutation.mutate({ id: customer?.id, payload });
  };

  const requestClose = () => {
    if (!mutation.isPending && !pendingDeactivation) onClose();
  };

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      <DialogContent
        className="admin-dialog admin-dialog--large admin-dialog--customer"
        onEscapeKeyDown={(event) => { if (mutation.isPending || pendingDeactivation) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (mutation.isPending || pendingDeactivation) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{isEditing ? "Edit customer" : "Create customer"}</DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Update the customer master record. Saving sends a complete, validated customer profile."
              : "Add the identity, contact, tax, and address details used on invoices."}
          </DialogDescription>
        </DialogHeader>

        <form className="admin-form" onSubmit={submit} noValidate>
          <div className="admin-dialog__scroll">
            <fieldset className="admin-form-section">
              <legend className="admin-form-section__title">Identity</legend>
              <div className="admin-form-grid">
                <Field label="Customer type" required error={fieldErrors.customer_type}>
                  <select
                    className="admin-select"
                    name="customer_type"
                    value={form.customer_type}
                    onChange={(event) => updateField("customer_type", event.target.value)}
                    aria-invalid={Boolean(fieldErrors.customer_type)}
                  >
                    <option value="" disabled>Select customer type</option>
                    <option value="business">Business</option>
                    <option value="individual">Individual</option>
                  </select>
                </Field>
                <Field label="Display name" required error={fieldErrors.display_name}>
                  <input
                    className="admin-input"
                    name="display_name"
                    value={form.display_name}
                    onChange={(event) => updateField("display_name", event.target.value)}
                    maxLength={200}
                    autoComplete="organization"
                    autoFocus
                    aria-invalid={Boolean(fieldErrors.display_name)}
                  />
                </Field>
                <Field label="Legal name" error={fieldErrors.legal_name} className="admin-field--span-2">
                  <input
                    className="admin-input"
                    name="legal_name"
                    value={form.legal_name}
                    onChange={(event) => updateField("legal_name", event.target.value)}
                    maxLength={200}
                    autoComplete="organization"
                  />
                </Field>
                <Field label="GSTIN" hint="15-character GST registration number" error={fieldErrors.gstin}>
                  <input
                    className="admin-input admin-input--uppercase"
                    name="gstin"
                    value={form.gstin}
                    onChange={(event) => updateField("gstin", event.target.value.toUpperCase())}
                    maxLength={15}
                    autoCapitalize="characters"
                    aria-invalid={Boolean(fieldErrors.gstin)}
                  />
                </Field>
                <Field label="PAN" hint="10-character permanent account number" error={fieldErrors.pan}>
                  <input
                    className="admin-input admin-input--uppercase"
                    name="pan"
                    value={form.pan}
                    onChange={(event) => updateField("pan", event.target.value.toUpperCase())}
                    maxLength={10}
                    autoCapitalize="characters"
                    aria-invalid={Boolean(fieldErrors.pan)}
                  />
                </Field>
              </div>
            </fieldset>

            <fieldset className="admin-form-section">
              <legend className="admin-form-section__title">Contact</legend>
              <div className="admin-form-grid">
                <Field label="Contact person" error={fieldErrors.contact_person} className="admin-field--span-2">
                  <input
                    className="admin-input"
                    name="contact_person"
                    value={form.contact_person}
                    onChange={(event) => updateField("contact_person", event.target.value)}
                    maxLength={160}
                    autoComplete="name"
                  />
                </Field>
                <Field label="Phone" error={fieldErrors.phone}>
                  <input
                    className="admin-input"
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={(event) => updateField("phone", event.target.value)}
                    maxLength={30}
                    autoComplete="tel"
                    aria-invalid={Boolean(fieldErrors.phone)}
                  />
                </Field>
                <Field label="Email" error={fieldErrors.email}>
                  <input
                    className="admin-input"
                    name="email"
                    type="email"
                    value={form.email}
                    onChange={(event) => updateField("email", event.target.value)}
                    maxLength={254}
                    autoComplete="email"
                    aria-invalid={Boolean(fieldErrors.email)}
                  />
                </Field>
              </div>
            </fieldset>

            <AddressFields
              prefix="billing_address"
              title="Billing address"
              description="The state code is used to validate GST identity consistency."
              value={form.billing_address}
              errors={fieldErrors}
              onChange={(field, value) => updateAddress("billing_address", field, value)}
            />

            <fieldset className="admin-form-section">
              <legend className="admin-form-section__title">Shipping</legend>
              <label className="admin-checkbox-row">
                <input
                  className="admin-checkbox"
                  name="shipping_same_as_billing"
                  type="checkbox"
                  checked={form.shipping_same_as_billing}
                  onChange={(event) => updateField("shipping_same_as_billing", event.target.checked)}
                />
                <span className="admin-checkbox-row__content">
                  <strong>Shipping address is the same as billing</strong>
                  <small>Turn this off to store a separate delivery address.</small>
                </span>
              </label>
            </fieldset>

            {!form.shipping_same_as_billing ? (
              <AddressFields
                prefix="shipping_address"
                title="Shipping address"
                value={form.shipping_address}
                errors={fieldErrors}
                onChange={(field, value) => updateAddress("shipping_address", field, value)}
              />
            ) : null}

            <fieldset className="admin-form-section">
              <legend className="admin-form-section__title">Internal details</legend>
              <div className="admin-form-grid">
                <Field label="Notes" error={fieldErrors.notes} className="admin-field--span-2">
                  <textarea
                    className="admin-textarea"
                    name="notes"
                    value={form.notes}
                    onChange={(event) => updateField("notes", event.target.value)}
                    maxLength={5000}
                    rows={4}
                  />
                </Field>
              </div>
              <label className="admin-checkbox-row">
                <input
                  className="admin-checkbox"
                  name="active"
                  type="checkbox"
                  checked={form.active}
                  onChange={(event) => updateField("active", event.target.checked)}
                />
                <span className="admin-checkbox-row__content">
                  <strong>Active customer</strong>
                  <small>Inactive customers remain available for historical records.</small>
                </span>
              </label>
            </fieldset>

            <ValidationSummary error={formError} />
          </div>

          <DialogFooter className="admin-dialog__footer">
            <button className="admin-button admin-button--ghost" type="button" onClick={requestClose} disabled={mutation.isPending}>
              Cancel
            </button>
            <button className="admin-button admin-button--primary" type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : null}
              {mutation.isPending ? "Saving…" : isEditing ? "Save customer" : "Create customer"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(pendingDeactivation)}
        onOpenChange={(open) => { if (!open) setPendingDeactivation(null); }}
        title="Save and deactivate customer?"
        description={`${customer?.display_name || "This customer"} will be saved as inactive and hidden from the active directory.`}
        confirmLabel="Save and deactivate"
        busy={false}
        onConfirm={() => {
          const payload = pendingDeactivation;
          setPendingDeactivation(null);
          if (payload) mutation.mutate({ id: customer.id, payload });
        }}
      />
    </>
  );
}

function CustomerActions({ customer, onEdit, onDeactivate }) {
  return (
    <div className="admin-row-actions">
      <Link
        className="admin-button admin-button--ghost admin-button--compact"
        to={`/admin/invoices/new?customer=${encodeURIComponent(customer.id)}`}
        aria-label={`Create invoice for ${customer.display_name}`}
      >
        <FilePlus2 aria-hidden="true" /> Invoice
      </Link>
      <button
        className="admin-button admin-button--ghost admin-button--compact"
        type="button"
        onClick={() => onEdit(customer)}
        aria-label={`Edit ${customer.display_name}`}
      >
        <Pencil aria-hidden="true" /> Edit
      </button>
      {customer.active !== false ? (
        <button
          className="admin-button admin-button--danger-ghost admin-button--compact"
          type="button"
          onClick={() => onDeactivate(customer)}
          aria-label={`Deactivate ${customer.display_name}`}
        >
          <UserX aria-hidden="true" /> Deactivate
        </button>
      ) : null}
    </div>
  );
}

function CustomerTable({ customers, onEdit, onDeactivate }) {
  return (
    <div className="admin-data-view admin-data-view--desktop">
      <div className="admin-table-wrap">
        <table className="admin-table">
          <caption className="admin-visually-hidden">Customer records</caption>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Contact</th>
              <th scope="col">Billing location</th>
              <th scope="col">Status</th>
              <th scope="col">Updated</th>
              <th scope="col"><span className="admin-visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <div className="admin-primary-cell">
                    <span className="admin-record-icon" aria-hidden="true">
                      {customer.customer_type === "individual" ? <UserRound /> : <Building2 />}
                    </span>
                    <div>
                      <strong>{customer.display_name}</strong>
                      <span>{customer.legal_name || (customer.customer_type === "individual" ? "Individual" : "Business")}</span>
                      {customer.gstin ? <small>GSTIN {customer.gstin}</small> : null}
                    </div>
                  </div>
                </td>
                <td>
                  <div className="admin-cell-stack">
                    <span>{customer.contact_person || "No contact person"}</span>
                    <small>{customer.phone || customer.email || "No contact details"}</small>
                  </div>
                </td>
                <td>{addressSummary(customer.billing_address)}</td>
                <td><CustomerState active={customer.active !== false} /></td>
                <td>{formatDate(customer.updated_at)}</td>
                <td><CustomerActions customer={customer} onEdit={onEdit} onDeactivate={onDeactivate} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CustomerCards({ customers, onEdit, onDeactivate }) {
  return (
    <div className="admin-data-view admin-data-view--mobile">
      <div className="admin-record-list">
        {customers.map((customer) => (
          <article className="admin-record-card" key={customer.id}>
            <div className="admin-record-card__header">
              <div className="admin-primary-cell">
                <span className="admin-record-icon" aria-hidden="true">
                  {customer.customer_type === "individual" ? <UserRound /> : <Building2 />}
                </span>
                <div>
                  <h3>{customer.display_name}</h3>
                  <p>{customer.legal_name || (customer.customer_type === "individual" ? "Individual" : "Business")}</p>
                </div>
              </div>
              <CustomerState active={customer.active !== false} />
            </div>
            <dl className="admin-record-card__details">
              {customer.contact_person ? (
                <div><dt>Contact</dt><dd>{customer.contact_person}</dd></div>
              ) : null}
              {customer.phone ? (
                <div><dt><Phone aria-hidden="true" /> Phone</dt><dd>{customer.phone}</dd></div>
              ) : null}
              {customer.email ? (
                <div><dt><Mail aria-hidden="true" /> Email</dt><dd>{customer.email}</dd></div>
              ) : null}
              <div><dt><MapPin aria-hidden="true" /> Billing</dt><dd>{addressSummary(customer.billing_address)}</dd></div>
              {customer.gstin ? <div><dt>GSTIN</dt><dd>{customer.gstin}</dd></div> : null}
              <div><dt>Updated</dt><dd>{formatDate(customer.updated_at)}</dd></div>
            </dl>
            <CustomerActions customer={customer} onEdit={onEdit} onDeactivate={onDeactivate} />
          </article>
        ))}
      </div>
    </div>
  );
}

export default function CustomersPage() {
  useAdminTitle("Customers");
  const queryClient = useQueryClient();
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("active");
  const [page, setPage] = useState(1);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [deactivateTarget, setDeactivateTarget] = useState(null);

  const active = activeFilter === "all" ? undefined : activeFilter === "active";
  const customerQuery = useQuery({
    queryKey: [...CUSTOMER_LIST_QUERY_KEY, { q: search, active: activeFilter, page, pageSize: PAGE_SIZE }],
    queryFn: () => adminApi.customers.list({ q: search, active, page, page_size: PAGE_SIZE }),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, payload }) => (id
      ? adminApi.customers.update(id, payload)
      : adminApi.customers.create(payload)),
    onSuccess: (savedCustomer, variables) => {
      queryClient.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEY });
      if (savedCustomer?.id) queryClient.invalidateQueries({ queryKey: ["admin", "customer", savedCustomer.id] });
      queryClient.invalidateQueries({ queryKey: ["admin", "activity"] });
      toast.success(variables.id ? "Customer updated." : "Customer created.");
      setPage(1);
      setEditorOpen(false);
      setEditingCustomer(null);
    },
    onError: (error) => toast.error(normalizeRequestError(error).message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id) => adminApi.customers.deactivate(id),
    onSuccess: (savedCustomer) => {
      queryClient.invalidateQueries({ queryKey: CUSTOMER_QUERY_KEY });
      if (savedCustomer?.id) queryClient.invalidateQueries({ queryKey: ["admin", "customer", savedCustomer.id] });
      queryClient.invalidateQueries({ queryKey: ["admin", "activity"] });
      toast.success("Customer deactivated.");
      setPage(1);
      setDeactivateTarget(null);
    },
    onError: (error) => toast.error(normalizeRequestError(error).message),
  });

  const openCreate = () => {
    saveMutation.reset();
    setEditingCustomer(null);
    setEditorOpen(true);
  };

  const openEdit = (customer) => {
    saveMutation.reset();
    setEditingCustomer(customer);
    setEditorOpen(true);
  };

  const closeEditor = () => {
    if (saveMutation.isPending) return;
    setEditorOpen(false);
    setEditingCustomer(null);
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
    setActiveFilter("active");
    setPage(1);
  };

  const customers = customerQuery.data?.items ?? [];
  const total = customerQuery.data?.total ?? 0;
  const filtersApplied = Boolean(search || activeFilter !== "active");

  return (
    <div className="admin-page admin-page--customers">
      <style>{CUSTOMER_PAGE_STYLES}</style>
      <PageHeader
        eyebrow="Directory"
        title="Customers"
        description="Maintain billing identities, tax details, contacts, and delivery addresses."
        actions={(
          <button className="admin-button admin-button--primary" type="button" onClick={openCreate}>
            <Plus aria-hidden="true" /> New customer
          </button>
        )}
      />

      <SectionCard className="admin-card--filters">
        <form className="admin-filters" role="search" onSubmit={submitSearch}>
          <Field label="Search customers" className="admin-filter admin-filter--search">
            <div className="admin-input-with-icon">
              <Search aria-hidden="true" />
              <input
                className="admin-input"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Name, contact, phone, email, or GSTIN"
                maxLength={200}
              />
            </div>
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
        title="Customer directory"
        description={customerQuery.isPending ? "Loading customer records…" : `${total} ${total === 1 ? "customer" : "customers"}`}
        action={customerQuery.isFetching && !customerQuery.isPending ? <LoadingState compact label="Refreshing…" /> : null}
        className="admin-card--data"
      >
        {customerQuery.isPending ? (
          <LoadingState label="Loading customers…" />
        ) : customerQuery.isError ? (
          <ErrorState error={customerQuery.error} onRetry={() => customerQuery.refetch()} title="We couldn't load customers" />
        ) : customers.length === 0 ? (
          <EmptyState
            icon={UsersRound}
            title={filtersApplied ? "No customers match these filters" : "No active customers yet"}
            copy={filtersApplied ? "Change or reset the filters to broaden the directory." : "Create a customer to start preparing invoices."}
            action={filtersApplied ? (
              <button className="admin-button admin-button--outline" type="button" onClick={clearFilters}>
                <RotateCcw aria-hidden="true" /> Reset filters
              </button>
            ) : (
              <button className="admin-button admin-button--primary" type="button" onClick={openCreate}>
                <Plus aria-hidden="true" /> Create customer
              </button>
            )}
          />
        ) : (
          <>
            <CustomerTable customers={customers} onEdit={openEdit} onDeactivate={setDeactivateTarget} />
            <CustomerCards customers={customers} onEdit={openEdit} onDeactivate={setDeactivateTarget} />
            <Pagination
              page={customerQuery.data?.page ?? page}
              pageSize={customerQuery.data?.page_size ?? PAGE_SIZE}
              total={total}
              onPageChange={setPage}
            />
          </>
        )}
      </SectionCard>

      {editorOpen ? (
        <CustomerEditorDialog customer={editingCustomer} mutation={saveMutation} onClose={closeEditor} />
      ) : null}

      <ConfirmDialog
        open={Boolean(deactivateTarget)}
        onOpenChange={(open) => {
          if (!open && !deactivateMutation.isPending) setDeactivateTarget(null);
        }}
        title="Deactivate customer?"
        description={deactivateTarget
          ? `${deactivateTarget.display_name} will be hidden from the active directory but retained on historical records.`
          : "The customer will be deactivated."}
        confirmLabel="Deactivate"
        busy={deactivateMutation.isPending}
        onConfirm={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
      />
    </div>
  );
}
