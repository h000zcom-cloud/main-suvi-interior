import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  CheckCircle2,
  CloudOff,
  FileText,
  Landmark,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  ReceiptIndianRupee,
  RotateCcw,
  Save,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { toast } from "sonner";
import { adminApi, apiError } from "@/admin/api";
import {
  ErrorState,
  Field,
  InlineNotice,
  LoadingState,
  PageHeader,
  SectionCard,
  ValidationSummary,
  useAdminTitle,
} from "@/admin/components/AdminUI";

const SETTINGS_QUERY_KEY = ["admin", "settings"];
const METADATA_QUERY_KEY = ["admin", "metadata"];

const GST_MODE_LABELS = {
  not_configured: "Not configured",
  unregistered: "Unregistered",
  regular: "Regular registration",
  composition: "Composition scheme",
};

function text(value) {
  return value === null || value === undefined ? "" : String(value);
}

function normalizeDefaultDueDays(value) {
  const normalized = text(value).trim();
  if (!normalized) return 0;
  const dueDays = Number(normalized);
  return Number.isInteger(dueDays) && dueDays >= 0 && dueDays <= 365 ? dueDays : 0;
}

function formFromSettings(settings = {}) {
  const address = settings.address || {};
  const bank = settings.bank || {};

  return {
    display_name: text(settings.display_name),
    trade_name: text(settings.trade_name),
    legal_name: text(settings.legal_name),
    address: {
      line1: text(address.line1),
      line2: text(address.line2),
      line3: text(address.line3),
      city: text(address.city),
      state: text(address.state),
      state_code: text(address.state_code),
      pincode: text(address.pincode),
      country: text(address.country),
    },
    phone: text(settings.phone),
    email: text(settings.email),
    website: text(settings.website),
    gstin: text(settings.gstin),
    pan: text(settings.pan),
    gst_registration_mode: text(settings.gst_registration_mode),
    invoice_prefix: text(settings.invoice_prefix),
    default_due_days: String(normalizeDefaultDueDays(settings.default_due_days)),
    default_terms: text(settings.default_terms),
    default_notes: text(settings.default_notes),
    round_to_rupee: settings.round_to_rupee === true,
    e_invoice_applicable: settings.e_invoice_applicable === true,
    e_invoice_applicability_note: text(settings.e_invoice_applicability_note),
    bank: {
      account_name: text(bank.account_name),
      bank_name: text(bank.bank_name),
      account_number: text(bank.account_number),
      branch: text(bank.branch),
      ifsc: text(bank.ifsc),
    },
    upi_id: text(settings.upi_id),
    authorised_signatory: text(settings.authorised_signatory),
    signature: text(settings.signature),
  };
}

function clean(value) {
  return text(value).trim();
}

function settingsInputPayload(form) {
  // Keep this projection explicit: the API forbids response-only fields and expects a full PUT.
  return {
    display_name: clean(form.display_name),
    trade_name: clean(form.trade_name),
    legal_name: clean(form.legal_name),
    address: {
      line1: clean(form.address.line1),
      line2: clean(form.address.line2),
      line3: clean(form.address.line3),
      city: clean(form.address.city),
      state: clean(form.address.state),
      state_code: clean(form.address.state_code),
      pincode: clean(form.address.pincode),
      country: clean(form.address.country),
    },
    phone: clean(form.phone),
    email: clean(form.email),
    website: clean(form.website),
    gstin: clean(form.gstin).toUpperCase(),
    pan: clean(form.pan).toUpperCase(),
    gst_registration_mode: clean(form.gst_registration_mode),
    invoice_prefix: clean(form.invoice_prefix).toUpperCase(),
    default_due_days: normalizeDefaultDueDays(form.default_due_days),
    default_terms: clean(form.default_terms),
    default_notes: clean(form.default_notes),
    round_to_rupee: form.round_to_rupee === true,
    e_invoice_applicable: form.e_invoice_applicable === true,
    e_invoice_applicability_note: clean(form.e_invoice_applicability_note),
    bank: {
      account_name: clean(form.bank.account_name),
      bank_name: clean(form.bank.bank_name),
      account_number: clean(form.bank.account_number),
      branch: clean(form.bank.branch),
      ifsc: clean(form.bank.ifsc).toUpperCase(),
    },
    upi_id: clean(form.upi_id),
    authorised_signatory: clean(form.authorised_signatory),
    signature: clean(form.signature),
  };
}

function validateSettings(form, registrationModes) {
  const errors = {};

  if (!clean(form.display_name)) errors.display_name = "Display name is required.";
  if (!clean(form.trade_name)) errors.trade_name = "Trade name is required.";

  if (!clean(form.gst_registration_mode)) {
    errors.gst_registration_mode = "Select the GST registration mode.";
  } else if (registrationModes.length && !registrationModes.includes(form.gst_registration_mode)) {
    errors.gst_registration_mode = "Select a supported GST registration mode.";
  }

  if (!clean(form.invoice_prefix)) {
    errors.invoice_prefix = "Invoice prefix is required.";
  } else if (!/^[A-Za-z0-9-]+$/.test(clean(form.invoice_prefix))) {
    errors.invoice_prefix = "Use only letters, numbers, and hyphens.";
  }

  if (form.address.state_code && !/^\d{2}$/.test(form.address.state_code)) {
    errors["address.state_code"] = "State code must contain two digits.";
  }
  if (form.address.pincode && !/^[1-9]\d{5}$/.test(form.address.pincode)) {
    errors["address.pincode"] = "Enter a valid six-digit PIN code.";
  }

  return errors;
}

function serverFieldErrors(error) {
  if (!error) return {};
  return apiError(error).errors.reduce((fields, item) => {
    const field = text(item.field);
    if (field && !fields[field]) fields[field] = item.message;
    return fields;
  }, {});
}

function savedTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function modeLabel(value) {
  return GST_MODE_LABELS[value] || value || "Not set";
}

export default function SettingsPage() {
  useAdminTitle("Business settings");
  const queryClient = useQueryClient();
  const hydratedSource = useRef(null);
  const [form, setForm] = useState(null);
  const [baseline, setBaseline] = useState(null);
  const [clientErrors, setClientErrors] = useState({});
  const [dismissedServerFields, setDismissedServerFields] = useState([]);
  const [lastSavedAt, setLastSavedAt] = useState("");

  const settingsQuery = useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: adminApi.settings.get,
  });
  const metadataQuery = useQuery({
    queryKey: METADATA_QUERY_KEY,
    queryFn: adminApi.metadata,
    staleTime: 5 * 60 * 1000,
  });

  const dirty = useMemo(
    () => Boolean(form && baseline && JSON.stringify(form) !== JSON.stringify(baseline)),
    [baseline, form],
  );

  const saveSettings = useMutation({
    mutationFn: adminApi.settings.update,
    onSuccess: (savedSettings) => {
      const next = formFromSettings(savedSettings);
      hydratedSource.current = savedSettings;
      queryClient.setQueryData(SETTINGS_QUERY_KEY, savedSettings);
      setForm(next);
      setBaseline(next);
      setClientErrors({});
      setDismissedServerFields([]);
      setLastSavedAt(savedSettings.updated_at || new Date().toISOString());
      toast.success("Business settings saved.", { id: "admin-settings-save" });
    },
    onError: (error) => {
      setDismissedServerFields([]);
      const normalized = apiError(error, "Business settings could not be saved.");
      toast.error(normalized.message, { id: "admin-settings-save" });
    },
  });

  useEffect(() => {
    const source = settingsQuery.data;
    if (!source || hydratedSource.current === source) return;
    if (form === null || !dirty) {
      const next = formFromSettings(source);
      hydratedSource.current = source;
      setForm(next);
      setBaseline(next);
      setClientErrors({});
    }
  }, [dirty, form, settingsQuery.data]);

  useEffect(() => {
    if (!dirty) return undefined;
    let navigationConfirmed = false;

    const confirmDirtyNavigation = (event) => {
      if (event.defaultPrevented || !(event.target instanceof window.Element)) return;
      const anchor = event.target.closest("a[href]");
      const signOut = event.target.closest('button[aria-label="Sign out"]');
      if (!anchor && !signOut) return;

      if (anchor) {
        const href = anchor.getAttribute("href") || "";
        if (!href || href.startsWith("#") || anchor.href === window.location.href) return;
      }

      if (!window.confirm("You have unsaved business settings. Leave without saving?")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      navigationConfirmed = true;
    };

    const warnBeforeUnload = (event) => {
      if (navigationConfirmed) return;
      event.preventDefault();
      event.returnValue = "";
    };

    document.addEventListener("click", confirmDirtyNavigation, true);
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      document.removeEventListener("click", confirmDirtyNavigation, true);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, [dirty]);

  const metadata = metadataQuery.data || {};
  const states = Array.isArray(metadata.states) ? metadata.states : [];
  const registrationModes = Array.isArray(metadata.gst_registration_modes)
    ? metadata.gst_registration_modes
    : [];
  const capabilities = metadata.capabilities || {};
  const irpConnected = capabilities.irp_connected === true;
  const manualEInvoiceEntry = capabilities.e_invoice_metadata_entry === "manual";
  const displayedSaveError = useMemo(() => {
    if (!saveSettings.error) return null;
    const normalized = apiError(saveSettings.error, "Business settings could not be saved.");
    const errors = normalized.errors.filter(
      (item) => !dismissedServerFields.includes(text(item.field)),
    );
    return {
      response: {
        status: normalized.status,
        data: {
          detail: {
            code: normalized.code,
            message: normalized.message,
            errors,
          },
        },
      },
    };
  }, [dismissedServerFields, saveSettings.error]);
  const apiFieldErrors = useMemo(
    () => serverFieldErrors(displayedSaveError),
    [displayedSaveError],
  );

  function errorFor(...fields) {
    for (const field of fields) {
      if (clientErrors[field]) return clientErrors[field];
      if (apiFieldErrors[field]) return apiFieldErrors[field];
    }
    return "";
  }

  function clearFeedback(...fields) {
    setClientErrors((current) => {
      if (!fields.some((field) => current[field])) return current;
      const next = { ...current };
      fields.forEach((field) => delete next[field]);
      return next;
    });
    if (saveSettings.error) {
      setDismissedServerFields((current) => [
        ...new Set([...current, ...fields]),
      ]);
    }
  }

  function updateTopLevel(event) {
    const { checked, name, type, value } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
    clearFeedback(name);
  }

  function updateNested(section, event) {
    const { name, value } = event.target;
    const field = name.slice(section.length + 1);
    setForm((current) => ({
      ...current,
      [section]: { ...current[section], [field]: value },
    }));
    clearFeedback(name);
  }

  function updateState(event) {
    const stateCode = event.target.value;
    if (stateCode === "__stored_state__") return;
    const selected = states.find((state) => state.code === stateCode);
    setForm((current) => ({
      ...current,
      address: {
        ...current.address,
        state_code: stateCode,
        state: selected ? selected.name : stateCode ? current.address.state : "",
      },
    }));
    clearFeedback("address.state", "address.state_code");
  }

  function submitSettings(event) {
    event.preventDefault();
    if (!form || saveSettings.isPending) return;
    if (!dirty) {
      toast.message("There are no unsaved settings.");
      return;
    }

    const errors = validateSettings(form, registrationModes);
    setClientErrors(errors);
    if (Object.keys(errors).length) {
      toast.error("Please correct the highlighted settings.");
      const firstField = Object.keys(errors)[0];
      window.requestAnimationFrame(() => {
        document.querySelector(`[name="${firstField}"]`)?.focus();
      });
      return;
    }

    setDismissedServerFields([]);
    saveSettings.reset();
    saveSettings.mutate(settingsInputPayload(form));
  }

  function discardChanges() {
    if (!dirty || !baseline) return;
    if (!window.confirm("Discard all unsaved business settings changes?")) return;
    setForm(formFromSettings(baseline));
    setClientErrors({});
    setDismissedServerFields([]);
    saveSettings.reset();
    toast.message("Unsaved settings were discarded.");
  }

  const pageHeader = (
    <PageHeader
      eyebrow="Workspace setup"
      title="Business settings"
      description="Manage the identity, tax, invoice, payment, and signatory details used across your documents."
      actions={form ? (
        <>
          <button
            className="admin-button admin-button--ghost"
            type="button"
            onClick={discardChanges}
            disabled={!dirty || saveSettings.isPending}
          >
            <RotateCcw aria-hidden="true" /> Discard
          </button>
          <button
            className="admin-button admin-button--primary"
            type="submit"
            form="admin-business-settings-form"
            disabled={!dirty || saveSettings.isPending}
          >
            {saveSettings.isPending ? (
              <LoaderCircle className="admin-spin" aria-hidden="true" />
            ) : (
              <Save aria-hidden="true" />
            )}
            {saveSettings.isPending ? "Saving…" : "Save settings"}
          </button>
        </>
      ) : null}
    />
  );

  if (settingsQuery.isError || metadataQuery.isError) {
    const loadError = settingsQuery.error || metadataQuery.error;
    return (
      <div className="admin-page admin-settings-page">
        {pageHeader}
        <ErrorState
          error={apiError(loadError, "Business settings could not be loaded.")}
          title="We couldn't load business settings"
          onRetry={() => {
            settingsQuery.refetch();
            metadataQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (settingsQuery.isPending || metadataQuery.isPending || !form) {
    return (
      <div className="admin-page admin-settings-page">
        {pageHeader}
        <LoadingState label="Loading business settings…" />
      </div>
    );
  }

  const registrationModeChanged = Boolean(
    baseline?.gst_registration_mode
      && baseline.gst_registration_mode !== form.gst_registration_mode,
  );
  const currentStateIsKnown = !form.address.state_code
    || states.some((state) => state.code === form.address.state_code);
  const stateSelectValue = form.address.state_code
    || (form.address.state ? "__stored_state__" : "");
  const statusTone = saveSettings.isPending
    ? "saving"
    : dirty
      ? "dirty"
      : lastSavedAt
        ? "saved"
        : "clean";
  const statusText = saveSettings.isPending
    ? "Saving business settings…"
    : dirty
      ? "Unsaved changes"
      : lastSavedAt
        ? `Saved ${savedTime(lastSavedAt)}`
        : "Settings are up to date";
  const EInvoiceStatusIcon = irpConnected ? ShieldCheck : CloudOff;
  const eInvoiceDisclosureTitle = !irpConnected && manualEInvoiceEntry
    ? "Manual only — IRP not connected"
    : !irpConnected
      ? "IRP not connected"
      : manualEInvoiceEntry
        ? "Manual e-invoice metadata"
        : "IRP connection available";

  return (
    <div className="admin-page admin-settings-page">
      {pageHeader}

      <div
        className={`admin-settings-status admin-settings-status--${statusTone}`}
        role="status"
        aria-live="polite"
      >
        {saveSettings.isPending ? (
          <LoaderCircle className="admin-spin" aria-hidden="true" />
        ) : (
          <CheckCircle2 aria-hidden="true" />
        )}
        <span>{statusText}</span>
      </div>

      <div className="admin-settings-security">
        <InlineNotice tone="info" title="Credentials stay on the server">
          <div className="admin-settings-security__content">
            <LockKeyhole aria-hidden="true" />
            <p>
              Administrator credentials and integration secrets are server environment configuration.
              This page never displays, stores, or asks for a password, API key, or IRP credential.
            </p>
          </div>
        </InlineNotice>
      </div>

      {Object.keys(clientErrors).length ? (
        <div className="admin-validation" role="alert">
          <strong>Please complete the highlighted settings.</strong>
          <ul>
            {Object.entries(clientErrors).map(([field, message]) => (
              <li key={field}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <ValidationSummary error={displayedSaveError} />

      <form
        id="admin-business-settings-form"
        className="admin-settings-form"
        onSubmit={submitSettings}
        noValidate
        aria-busy={saveSettings.isPending}
      >
        <fieldset className="admin-settings-fieldset" disabled={saveSettings.isPending}>
          <SectionCard
            className="admin-settings-card admin-settings-card--identity"
            title="Business identity and contact"
            description="Names and contact details printed on invoices and customer documents."
            action={<Building2 className="admin-card__icon" aria-hidden="true" />}
          >
            <div className="admin-settings-grid admin-settings-grid--two">
              <Field label="Display name" required error={errorFor("display_name")}>
                <input
                  name="display_name"
                  value={form.display_name}
                  onChange={updateTopLevel}
                  maxLength={160}
                  autoComplete="organization"
                  aria-invalid={Boolean(errorFor("display_name"))}
                />
              </Field>
              <Field label="Trade name" required error={errorFor("trade_name")}>
                <input
                  name="trade_name"
                  value={form.trade_name}
                  onChange={updateTopLevel}
                  maxLength={160}
                  autoComplete="organization"
                  aria-invalid={Boolean(errorFor("trade_name"))}
                />
              </Field>
              <Field
                label="Legal name"
                hint="Leave blank unless a legal name is configured for the business."
                error={errorFor("legal_name")}
              >
                <input
                  name="legal_name"
                  value={form.legal_name}
                  onChange={updateTopLevel}
                  maxLength={200}
                  autoComplete="organization"
                  aria-invalid={Boolean(errorFor("legal_name"))}
                />
              </Field>
              <Field label="Phone" error={errorFor("phone")}>
                <input
                  type="tel"
                  name="phone"
                  value={form.phone}
                  onChange={updateTopLevel}
                  maxLength={30}
                  autoComplete="tel"
                  aria-invalid={Boolean(errorFor("phone"))}
                />
              </Field>
              <Field label="Email" error={errorFor("email")}>
                <input
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={updateTopLevel}
                  maxLength={254}
                  autoComplete="email"
                  aria-invalid={Boolean(errorFor("email"))}
                />
              </Field>
              <Field label="Website" hint="Use a complete http or https URL." error={errorFor("website")}>
                <input
                  type="url"
                  name="website"
                  value={form.website}
                  onChange={updateTopLevel}
                  maxLength={300}
                  autoComplete="url"
                  aria-invalid={Boolean(errorFor("website"))}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            className="admin-settings-card admin-settings-card--address"
            title="Registered address"
            description="The complete business address used for tax and invoice documents."
            action={<MapPin className="admin-card__icon" aria-hidden="true" />}
          >
            <div className="admin-settings-grid admin-settings-grid--two">
              <Field
                className="admin-settings-field--full"
                label="Address line 1"
                error={errorFor("address.line1")}
              >
                <input
                  name="address.line1"
                  value={form.address.line1}
                  onChange={(event) => updateNested("address", event)}
                  maxLength={240}
                  autoComplete="address-line1"
                  aria-invalid={Boolean(errorFor("address.line1"))}
                />
              </Field>
              <Field
                className="admin-settings-field--full"
                label="Address line 2"
                error={errorFor("address.line2")}
              >
                <input
                  name="address.line2"
                  value={form.address.line2}
                  onChange={(event) => updateNested("address", event)}
                  maxLength={240}
                  autoComplete="address-line2"
                  aria-invalid={Boolean(errorFor("address.line2"))}
                />
              </Field>
              <Field
                className="admin-settings-field--full"
                label="Address line 3"
                error={errorFor("address.line3")}
              >
                <input
                  name="address.line3"
                  value={form.address.line3}
                  onChange={(event) => updateNested("address", event)}
                  maxLength={240}
                  autoComplete="address-line3"
                  aria-invalid={Boolean(errorFor("address.line3"))}
                />
              </Field>
              <Field label="City" error={errorFor("address.city")}>
                <input
                  name="address.city"
                  value={form.address.city}
                  onChange={(event) => updateNested("address", event)}
                  maxLength={120}
                  autoComplete="address-level2"
                  aria-invalid={Boolean(errorFor("address.city"))}
                />
              </Field>
              <Field
                label="State or union territory"
                error={errorFor("address.state")}
                hint="Selecting a state keeps its GST state code in sync."
              >
                <select
                  name="address.state"
                  value={stateSelectValue}
                  onChange={updateState}
                  autoComplete="address-level1"
                  aria-invalid={Boolean(errorFor("address.state"))}
                >
                  <option value="">Select state or union territory</option>
                  {!form.address.state_code && form.address.state ? (
                    <option value="__stored_state__">
                      {form.address.state} (state code not set)
                    </option>
                  ) : null}
                  {!currentStateIsKnown ? (
                    <option value={form.address.state_code}>
                      {form.address.state || "Current state"} ({form.address.state_code})
                    </option>
                  ) : null}
                  {states.map((state) => (
                    <option key={state.code} value={state.code}>{state.name} ({state.code})</option>
                  ))}
                </select>
              </Field>
              <Field label="State code" hint="Set from the selected state." error={errorFor("address.state_code")}>
                <input
                  name="address.state_code"
                  value={form.address.state_code}
                  readOnly
                  maxLength={2}
                  inputMode="numeric"
                  aria-invalid={Boolean(errorFor("address.state_code"))}
                />
              </Field>
              <Field label="PIN code" error={errorFor("address.pincode")}>
                <input
                  name="address.pincode"
                  value={form.address.pincode}
                  onChange={(event) => updateNested("address", event)}
                  maxLength={6}
                  inputMode="numeric"
                  autoComplete="postal-code"
                  aria-invalid={Boolean(errorFor("address.pincode"))}
                />
              </Field>
              <Field label="Country" error={errorFor("address.country")}>
                <input
                  name="address.country"
                  value={form.address.country}
                  onChange={(event) => updateNested("address", event)}
                  maxLength={80}
                  autoComplete="country-name"
                  aria-invalid={Boolean(errorFor("address.country"))}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            className="admin-settings-card admin-settings-card--tax"
            title="GST and tax identity"
            description="Registration status and identifiers used for Indian tax documents."
            action={<ReceiptIndianRupee className="admin-card__icon" aria-hidden="true" />}
          >
            <div className="admin-settings-grid admin-settings-grid--three">
              <Field
                label="GST registration mode"
                required
                error={errorFor("gst_registration_mode")}
                hint="Changing this can affect tax treatment on future invoices; review open drafts after saving."
              >
                <select
                  name="gst_registration_mode"
                  value={form.gst_registration_mode}
                  onChange={updateTopLevel}
                  aria-invalid={Boolean(errorFor("gst_registration_mode"))}
                >
                  <option value="">Select registration mode</option>
                  {form.gst_registration_mode
                    && !registrationModes.includes(form.gst_registration_mode) ? (
                      <option value={form.gst_registration_mode}>
                        Current: {modeLabel(form.gst_registration_mode)}
                      </option>
                    ) : null}
                  {registrationModes.map((mode) => (
                    <option key={mode} value={mode}>{modeLabel(mode)}</option>
                  ))}
                </select>
              </Field>
              <Field label="GSTIN" error={errorFor("gstin")} hint="Leave blank when no GSTIN is configured.">
                <input
                  name="gstin"
                  value={form.gstin}
                  onChange={updateTopLevel}
                  maxLength={15}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck="false"
                  aria-invalid={Boolean(errorFor("gstin"))}
                />
              </Field>
              <Field label="PAN" error={errorFor("pan")} hint="Leave blank when no PAN is configured.">
                <input
                  name="pan"
                  value={form.pan}
                  onChange={updateTopLevel}
                  maxLength={10}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck="false"
                  aria-invalid={Boolean(errorFor("pan"))}
                />
              </Field>
            </div>
            {registrationModeChanged ? (
              <InlineNotice tone="warning" title="Review this GST mode change before saving">
                <p>
                  The mode will change from {modeLabel(baseline.gst_registration_mode)} to {modeLabel(form.gst_registration_mode)}.
                  Confirm the GSTIN, registered state, and tax treatment on open drafts; this warning does not block the change.
                </p>
              </InlineNotice>
            ) : null}
          </SectionCard>

          <SectionCard
            className="admin-settings-card admin-settings-card--invoice"
            title="Invoice defaults"
            description="Prefix, notes, terms, and rounding defaults. Due dates are set per invoice and start blank."
            action={<FileText className="admin-card__icon" aria-hidden="true" />}
          >
            <div className="admin-settings-grid admin-settings-grid--two">
              <Field label="Invoice prefix" required error={errorFor("invoice_prefix")}>
                <input
                  name="invoice_prefix"
                  value={form.invoice_prefix}
                  onChange={updateTopLevel}
                  maxLength={12}
                  autoCapitalize="characters"
                  spellCheck="false"
                  aria-invalid={Boolean(errorFor("invoice_prefix"))}
                />
              </Field>
              <label className="admin-check admin-check--panel admin-settings-field--full">
                <input
                  className="admin-checkbox"
                  type="checkbox"
                  name="round_to_rupee"
                  checked={form.round_to_rupee}
                  onChange={updateTopLevel}
                />
                <span className="admin-checkbox__content">
                  <strong>Round invoice totals to the nearest rupee</strong>
                  <small>The configured rounding policy is applied to invoice calculations.</small>
                </span>
              </label>
              <Field
                className="admin-settings-field--full"
                label="Default notes"
                hint="Optional notes copied to new invoices."
                error={errorFor("default_notes")}
              >
                <textarea
                  name="default_notes"
                  value={form.default_notes}
                  onChange={updateTopLevel}
                  maxLength={5000}
                  rows={4}
                  aria-invalid={Boolean(errorFor("default_notes"))}
                />
              </Field>
              <Field
                className="admin-settings-field--full"
                label="Default terms"
                hint="Optional payment or service terms copied to new invoices."
                error={errorFor("default_terms")}
              >
                <textarea
                  name="default_terms"
                  value={form.default_terms}
                  onChange={updateTopLevel}
                  maxLength={5000}
                  rows={5}
                  aria-invalid={Boolean(errorFor("default_terms"))}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            className="admin-settings-card admin-settings-card--e-invoice"
            title="E-invoice applicability"
            description="Record whether e-invoicing applies and retain an internal applicability note."
            action={<EInvoiceStatusIcon className="admin-card__icon" aria-hidden="true" />}
          >
            <InlineNotice
              tone={!irpConnected || manualEInvoiceEntry ? "warning" : "success"}
              title={eInvoiceDisclosureTitle}
            >
              <p>
                {!irpConnected
                  ? "This workspace does not submit, register, or cancel invoices with the Invoice Registration Portal. Register externally, then enter IRN, acknowledgement, and QR metadata manually on the invoice."
                  : manualEInvoiceEntry
                    ? "The IRP connection is available, but e-invoice registration metadata is still entered manually on each invoice."
                    : "Connected IRP capabilities are reported by the server. Applicability here remains a business-level default."}
              </p>
            </InlineNotice>
            <div className="admin-settings-grid admin-settings-grid--two">
              <label className="admin-check admin-check--panel admin-settings-field--full">
                <input
                  className="admin-checkbox"
                  type="checkbox"
                  name="e_invoice_applicable"
                  checked={form.e_invoice_applicable}
                  onChange={updateTopLevel}
                />
                <span className="admin-checkbox__content">
                  <strong>E-invoicing applies to this business</strong>
                  <small>This records applicability only; it does not connect or transmit to the IRP.</small>
                </span>
              </label>
              <Field
                className="admin-settings-field--full"
                label="Applicability note"
                hint="Document the basis, threshold, exception, or review status without entering credentials."
                error={errorFor("e_invoice_applicability_note")}
              >
                <textarea
                  name="e_invoice_applicability_note"
                  value={form.e_invoice_applicability_note}
                  onChange={updateTopLevel}
                  maxLength={1000}
                  rows={4}
                  aria-invalid={Boolean(errorFor("e_invoice_applicability_note"))}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            className="admin-settings-card admin-settings-card--bank"
            title="Bank and payment details"
            description="Optional settlement details printed on invoices. Blank fields stay blank."
            action={<Landmark className="admin-card__icon" aria-hidden="true" />}
          >
            <div className="admin-settings-grid admin-settings-grid--two">
              <Field label="Account name" error={errorFor("bank.account_name")}>
                <input
                  name="bank.account_name"
                  value={form.bank.account_name}
                  onChange={(event) => updateNested("bank", event)}
                  maxLength={160}
                  autoComplete="off"
                  aria-invalid={Boolean(errorFor("bank.account_name"))}
                />
              </Field>
              <Field label="Bank name" error={errorFor("bank.bank_name")}>
                <input
                  name="bank.bank_name"
                  value={form.bank.bank_name}
                  onChange={(event) => updateNested("bank", event)}
                  maxLength={160}
                  autoComplete="off"
                  aria-invalid={Boolean(errorFor("bank.bank_name"))}
                />
              </Field>
              <Field label="Account number" error={errorFor("bank.account_number")}>
                <input
                  name="bank.account_number"
                  value={form.bank.account_number}
                  onChange={(event) => updateNested("bank", event)}
                  maxLength={40}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={Boolean(errorFor("bank.account_number"))}
                />
              </Field>
              <Field label="Branch" error={errorFor("bank.branch")}>
                <input
                  name="bank.branch"
                  value={form.bank.branch}
                  onChange={(event) => updateNested("bank", event)}
                  maxLength={160}
                  autoComplete="off"
                  aria-invalid={Boolean(errorFor("bank.branch"))}
                />
              </Field>
              <Field label="IFSC" error={errorFor("bank.ifsc")}>
                <input
                  name="bank.ifsc"
                  value={form.bank.ifsc}
                  onChange={(event) => updateNested("bank", event)}
                  maxLength={11}
                  autoCapitalize="characters"
                  autoComplete="off"
                  spellCheck="false"
                  aria-invalid={Boolean(errorFor("bank.ifsc"))}
                />
              </Field>
              <Field label="UPI ID" error={errorFor("upi_id")}>
                <input
                  name="upi_id"
                  value={form.upi_id}
                  onChange={updateTopLevel}
                  maxLength={321}
                  autoComplete="off"
                  spellCheck="false"
                  aria-invalid={Boolean(errorFor("upi_id"))}
                />
              </Field>
            </div>
          </SectionCard>

          <SectionCard
            className="admin-settings-card admin-settings-card--signatory"
            title="Authorised signatory"
            description="Optional signatory and signature text printed on documents."
            action={<UserRoundCheck className="admin-card__icon" aria-hidden="true" />}
          >
            <div className="admin-settings-grid admin-settings-grid--two">
              <Field label="Authorised signatory" error={errorFor("authorised_signatory")}>
                <input
                  name="authorised_signatory"
                  value={form.authorised_signatory}
                  onChange={updateTopLevel}
                  maxLength={160}
                  autoComplete="name"
                  aria-invalid={Boolean(errorFor("authorised_signatory"))}
                />
              </Field>
              <Field
                label="Signature text"
                hint="Text only; this setting does not upload a signature file."
                error={errorFor("signature")}
              >
                <input
                  name="signature"
                  value={form.signature}
                  onChange={updateTopLevel}
                  maxLength={160}
                  autoComplete="off"
                  aria-invalid={Boolean(errorFor("signature"))}
                />
              </Field>
            </div>
          </SectionCard>
        </fieldset>

        <div className="admin-settings-form__footer">
          <div className="admin-settings-form__footer-copy">
            <ShieldCheck aria-hidden="true" />
            <p>Only business document settings are submitted. Credentials and secret keys remain server-side.</p>
          </div>
          <div className="admin-settings-form__actions">
            <button
              className="admin-button admin-button--ghost"
              type="button"
              onClick={discardChanges}
              disabled={!dirty || saveSettings.isPending}
            >
              <RotateCcw aria-hidden="true" /> Discard
            </button>
            <button
              className="admin-button admin-button--primary"
              type="submit"
              disabled={!dirty || saveSettings.isPending}
            >
              {saveSettings.isPending ? (
                <LoaderCircle className="admin-spin" aria-hidden="true" />
              ) : (
                <Save aria-hidden="true" />
              )}
              {saveSettings.isPending ? "Saving…" : "Save settings"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
