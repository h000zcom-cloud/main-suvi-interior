import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Copy,
  CreditCard,
  Download,
  Eye,
  FilePenLine,
  FileText,
  Landmark,
  LoaderCircle,
  Plus,
  ReceiptIndianRupee,
  Trash2,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { adminApi, apiError, invalidateInvoiceQueries } from "@/admin/api";
import {
  ConfirmDialog,
  ErrorState,
  Field,
  formatDate,
  formatMoney,
  InlineNotice,
  LoadingState,
  PageHeader,
  SectionCard,
  StatusBadge,
  useAdminTitle,
  ValidationSummary,
} from "@/admin/components/AdminUI";

const PAYMENT_METHODS = [
  ["bank_transfer", "Bank transfer"],
  ["upi", "UPI"],
  ["cheque", "Cheque"],
  ["cash", "Cash"],
  ["card", "Card"],
  ["other", "Other"],
];
const PAYMENT_METHOD_VALUES = new Set(PAYMENT_METHODS.map(([value]) => value));

const MUTABLE_PAYMENT_STATUSES = new Set(["issued", "partially_paid", "paid", "overdue"]);

function formatDateTime(value, fallback = "—") {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function titleCase(value, fallback = "—") {
  if (!value) return fallback;
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function invoiceName(invoice) {
  return invoice?.invoice_number || `Draft · ${String(invoice?.id || "").slice(-6).toUpperCase()}`;
}

function money(container, key) {
  return formatMoney(container?.[`${key}_paise`], container?.[`${key}_display`]);
}

function moneyPaise(container, key) {
  const value = Number(container?.[`${key}_paise`]);
  return Number.isFinite(value) ? value : 0;
}

function toPaise(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const paise = (Number(whole) * 100) + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

function paymentMethodLabel(value) {
  return PAYMENT_METHODS.find(([method]) => method === value)?.[1] || titleCase(value);
}

function taxRegimeLabel(value) {
  if (value === "intra_state") return "Intra-state · CGST + SGST";
  if (value === "inter_state") return "Inter-state · IGST";
  if (value === "no_tax") return "No GST calculation";
  return titleCase(value);
}

function safeFilename(disposition, fallback) {
  const encoded = String(disposition || "").match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = String(disposition || "").match(/filename="?([^";]+)"?/i)?.[1];
  let filename = quoted || fallback;
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded);
    } catch {
      filename = encoded;
    }
  }
  return String(filename || fallback).replace(/[\\/:*?"<>|]/g, "-");
}

function AddressBlock({ address }) {
  const source = address || {};
  const locality = [source.city, source.state && `${source.state}${source.state_code ? ` (${source.state_code})` : ""}`, source.pincode]
    .filter(Boolean)
    .join(", ");
  const lines = [source.line1, source.line2, source.line3, locality, source.country].filter(Boolean);

  if (!lines.length) return <p className="admin-document-address__empty">Address not recorded</p>;

  return (
    <address className="admin-document-address">
      {lines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}
    </address>
  );
}

function PartyPanel({ eyebrow, party, address, note }) {
  const source = party || {};
  return (
    <section className="admin-document-party">
      <p className="admin-document-party__eyebrow">{eyebrow}</p>
      <h3>{source.display_name || source.trade_name || source.legal_name || "Not recorded"}</h3>
      {source.legal_name && source.legal_name !== source.display_name ? <p>{source.legal_name}</p> : null}
      {note ? <span className="admin-document-party__note">{note}</span> : null}
      <AddressBlock address={address} />
      <dl className="admin-document-party__facts">
        {source.gstin ? <div><dt>GSTIN</dt><dd>{source.gstin}</dd></div> : null}
        {source.pan ? <div><dt>PAN</dt><dd>{source.pan}</dd></div> : null}
        {source.contact_person ? <div><dt>Contact</dt><dd>{source.contact_person}</dd></div> : null}
        {source.phone ? <div><dt>Phone</dt><dd>{source.phone}</dd></div> : null}
        {source.email ? <div><dt>Email</dt><dd>{source.email}</dd></div> : null}
        {source.website ? <div><dt>Website</dt><dd>{source.website}</dd></div> : null}
      </dl>
    </section>
  );
}

function Fact({ label, children }) {
  return (
    <div className="admin-fact">
      <dt>{label}</dt>
      <dd>{children ?? "—"}</dd>
    </div>
  );
}

function TotalRow({ label, value, emphasis = false }) {
  return (
    <div className={`admin-invoice-total ${emphasis ? "admin-invoice-total--emphasis" : ""}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function emptyPaymentForm(paymentDate = "") {
  return {
    amount: "",
    tds_withheld_amount: "0.00",
    payment_date: paymentDate,
    method: "",
    reference: "",
    notes: "",
  };
}

function emptyEInvoiceForm() {
  return {
    irn: "",
    ack_number: "",
    ack_date: "",
    signed_qr_data: "",
  };
}

export default function InvoiceDetailPage() {
  const { invoiceId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [issueReview, setIssueReview] = useState(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelError, setCancelError] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [paymentBusinessDate, setPaymentBusinessDate] = useState("");
  const [paymentErrors, setPaymentErrors] = useState({});
  const [paymentToDelete, setPaymentToDelete] = useState(null);
  const [eInvoiceOpen, setEInvoiceOpen] = useState(false);
  const [eInvoiceForm, setEInvoiceForm] = useState(emptyEInvoiceForm);
  const [eInvoiceErrors, setEInvoiceErrors] = useState({});
  const [clearEInvoiceOpen, setClearEInvoiceOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const previewUrlRef = useRef("");
  const currentInvoiceIdRef = useRef(invoiceId);
  const mountedRef = useRef(true);
  const [latestActionError, setLatestActionError] = useState(null);
  currentInvoiceIdRef.current = invoiceId;

  const invoiceQuery = useQuery({
    queryKey: ["admin", "invoice", invoiceId],
    queryFn: () => adminApi.invoices.get(invoiceId),
    enabled: Boolean(invoiceId),
  });
  const metadataQuery = useQuery({
    queryKey: ["admin", "metadata"],
    queryFn: adminApi.metadata,
  });

  const invoice = invoiceQuery.data;
  useAdminTitle(invoice?.invoice_number || (invoice ? "Draft invoice" : "Invoice detail"));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (previewUrlRef.current) {
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = "";
      }
    };
  }, []);

  useEffect(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
    setIssueReview(null);
    setCancelOpen(false);
    setCancelReason("");
    setCancelError("");
    setPaymentOpen(false);
    setPaymentBusinessDate("");
    setPaymentErrors({});
    setPaymentToDelete(null);
    setEInvoiceOpen(false);
    setEInvoiceErrors({});
    setClearEInvoiceOpen(false);
    setPreviewOpen(false);
    setPreviewUrl("");
    setLatestActionError(null);
  }, [invoiceId]);

  function isCurrentTarget(targetInvoiceId) {
    return mountedRef.current && currentInvoiceIdRef.current === targetInvoiceId;
  }

  function clearCurrentActionError(targetInvoiceId) {
    if (isCurrentTarget(targetInvoiceId)) setLatestActionError(null);
  }

  function acceptInvoiceResponse(updated, message, targetInvoiceId) {
    queryClient.setQueryData(["admin", "invoice", targetInvoiceId], updated);
    invalidateInvoiceQueries(queryClient, targetInvoiceId);
    if (!isCurrentTarget(targetInvoiceId)) return;
    setLatestActionError(null);
    if (message) toast.success(message);
  }

  function reportMutationError(error, fallback, targetInvoiceId) {
    if (!isCurrentTarget(targetInvoiceId)) return;
    const normalized = apiError(error, fallback);
    setLatestActionError(error);
    toast.error(normalized.message);
  }

  const issueMutation = useMutation({
    mutationFn: ({ targetInvoiceId, expectedRevision }) => adminApi.invoices.issue(
      targetInvoiceId,
      { expected_revision: expectedRevision },
    ),
    onMutate: ({ targetInvoiceId }) => clearCurrentActionError(targetInvoiceId),
    onSuccess: (updated, { targetInvoiceId }) => {
      acceptInvoiceResponse(updated, `${updated.invoice_number || "Invoice"} issued successfully.`, targetInvoiceId);
      if (isCurrentTarget(targetInvoiceId)) setIssueReview(null);
    },
    onError: (error, { targetInvoiceId }) => {
      const normalized = apiError(error, "The draft could not be issued.");
      const refreshed = error?.response?.data?.detail?.invoice;
      if (
        normalized.status === 409
        && ["invoice_recalculated", "invoice_revision_conflict"].includes(normalized.code)
        && refreshed?.id === targetInvoiceId
      ) {
        acceptInvoiceResponse(refreshed, "", targetInvoiceId);
        if (isCurrentTarget(targetInvoiceId)) {
          setIssueReview(null);
          toast.warning(normalized.message);
        }
        return;
      }
      reportMutationError(error, "The draft could not be issued.", targetInvoiceId);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: ({ targetInvoiceId }) => adminApi.invoices.duplicate(targetInvoiceId, {}),
    onMutate: ({ targetInvoiceId }) => clearCurrentActionError(targetInvoiceId),
    onSuccess: (created, { targetInvoiceId }) => {
      queryClient.setQueryData(["admin", "invoice", created.id], created);
      invalidateInvoiceQueries(queryClient, created.id);
      if (!isCurrentTarget(targetInvoiceId)) return;
      toast.success("A new draft was created from this invoice.");
      navigate(`/admin/invoices/${created.id}/edit`);
    },
    onError: (error, { targetInvoiceId }) => reportMutationError(error, "The invoice could not be duplicated.", targetInvoiceId),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ targetInvoiceId, reason }) => adminApi.invoices.cancel(targetInvoiceId, { reason }),
    onMutate: ({ targetInvoiceId }) => clearCurrentActionError(targetInvoiceId),
    onSuccess: (updated, { targetInvoiceId }) => {
      acceptInvoiceResponse(updated, "Invoice cancelled locally.", targetInvoiceId);
      if (!isCurrentTarget(targetInvoiceId)) return;
      setCancelOpen(false);
      setCancelReason("");
      setCancelError("");
    },
    onError: (error, { targetInvoiceId }) => reportMutationError(error, "The invoice could not be cancelled.", targetInvoiceId),
  });

  const paymentMutation = useMutation({
    mutationFn: ({ targetInvoiceId, payload }) => adminApi.invoices.addPayment(targetInvoiceId, payload),
    onMutate: ({ targetInvoiceId }) => clearCurrentActionError(targetInvoiceId),
    onSuccess: (updated, { targetInvoiceId }) => {
      acceptInvoiceResponse(updated, "Payment and TDS settlement recorded.", targetInvoiceId);
      if (!isCurrentTarget(targetInvoiceId)) return;
      setPaymentOpen(false);
      setPaymentForm(emptyPaymentForm());
      setPaymentBusinessDate("");
      setPaymentErrors({});
    },
    onError: (error, { targetInvoiceId }) => reportMutationError(error, "The payment could not be recorded.", targetInvoiceId),
  });

  const deletePaymentMutation = useMutation({
    mutationFn: ({ targetInvoiceId, paymentId }) => adminApi.invoices.deletePayment(targetInvoiceId, paymentId),
    onMutate: ({ targetInvoiceId }) => clearCurrentActionError(targetInvoiceId),
    onSuccess: (updated, { targetInvoiceId }) => {
      acceptInvoiceResponse(updated, "Payment record deleted and invoice balance recalculated.", targetInvoiceId);
      if (isCurrentTarget(targetInvoiceId)) setPaymentToDelete(null);
    },
    onError: (error, { targetInvoiceId }) => reportMutationError(error, "The payment record could not be deleted.", targetInvoiceId),
  });

  const eInvoiceMutation = useMutation({
    mutationFn: ({ targetInvoiceId, payload }) => adminApi.invoices.updateEInvoice(targetInvoiceId, payload),
    onMutate: ({ targetInvoiceId }) => clearCurrentActionError(targetInvoiceId),
    onSuccess: (updated, { targetInvoiceId, payload }) => {
      const cleared = !payload.irn && !payload.ack_number && !payload.ack_date && !payload.signed_qr_data;
      acceptInvoiceResponse(updated, cleared ? "Local e-invoice metadata cleared." : "Manual e-invoice metadata saved.", targetInvoiceId);
      if (!isCurrentTarget(targetInvoiceId)) return;
      setEInvoiceOpen(false);
      setClearEInvoiceOpen(false);
      setEInvoiceErrors({});
    },
    onError: (error, { targetInvoiceId }) => reportMutationError(error, "The e-invoice metadata could not be updated.", targetInvoiceId),
  });

  const downloadPdfMutation = useMutation({
    mutationFn: ({ targetInvoiceId }) => adminApi.invoices.pdf(targetInvoiceId, false),
    onMutate: ({ targetInvoiceId }) => clearCurrentActionError(targetInvoiceId),
    onSuccess: ({ blob, disposition }, { targetInvoiceId, displayName }) => {
      if (!isCurrentTarget(targetInvoiceId)) return;
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = safeFilename(disposition, `Suvi-Interior-${displayName}.pdf`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      toast.success("Invoice PDF downloaded.");
    },
    onError: (error, { targetInvoiceId }) => reportMutationError(error, "The invoice PDF could not be downloaded.", targetInvoiceId),
  });

  const previewPdfMutation = useMutation({
    mutationFn: ({ targetInvoiceId }) => adminApi.invoices.pdf(targetInvoiceId, true),
    onMutate: ({ targetInvoiceId }) => clearCurrentActionError(targetInvoiceId),
    onSuccess: ({ blob }, { targetInvoiceId }) => {
      if (!isCurrentTarget(targetInvoiceId)) return;
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const objectUrl = URL.createObjectURL(blob);
      previewUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
      setPreviewOpen(true);
    },
    onError: (error, { targetInvoiceId }) => reportMutationError(error, "The invoice PDF preview could not be loaded.", targetInvoiceId),
  });

  function closePdfPreview() {
    setPreviewOpen(false);
    setPreviewUrl("");
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
  }

  function openPaymentDialog() {
    const targetInvoiceId = invoiceId;
    paymentMutation.reset();
    setPaymentForm(emptyPaymentForm());
    setPaymentBusinessDate("");
    setPaymentErrors({});
    setPaymentOpen(true);
    void metadataQuery.refetch().then((result) => {
      if (!isCurrentTarget(targetInvoiceId) || !result.isSuccess || result.isRefetchError) return;
      const currentBusinessDate = result.data?.business_date || "";
      setPaymentBusinessDate(currentBusinessDate);
      if (currentBusinessDate) {
        setPaymentForm((current) => (
          current.payment_date ? current : { ...current, payment_date: currentBusinessDate }
        ));
      }
    }).catch(() => {
      // Keep the date blank; the backend remains authoritative when metadata is unavailable.
    });
  }

  function updatePaymentForm(event) {
    const { name, value } = event.target;
    setPaymentForm((current) => ({ ...current, [name]: value }));
    setPaymentErrors((current) => ({ ...current, [name]: "", form: "" }));
  }

  function submitPayment(event) {
    event.preventDefault();
    const errors = {};
    const amountPaise = toPaise(paymentForm.amount);
    const tdsPaise = toPaise(paymentForm.tds_withheld_amount);
    const balancePaise = moneyPaise(invoice?.totals, "balance");

    if (amountPaise === null || amountPaise <= 0) errors.amount = "Enter a positive amount with no more than two decimals.";
    if (tdsPaise === null || tdsPaise < 0) errors.tds_withheld_amount = "Enter zero or a positive TDS amount with no more than two decimals.";
    if (!paymentForm.payment_date) {
      errors.payment_date = "Choose the payment date.";
    } else if (invoice?.invoice_date && paymentForm.payment_date < invoice.invoice_date) {
      errors.payment_date = "Payment date cannot be earlier than the invoice date.";
    } else if (paymentBusinessDate && paymentForm.payment_date > paymentBusinessDate) {
      errors.payment_date = "Payment date cannot be later than the current business date.";
    }
    if (!PAYMENT_METHOD_VALUES.has(paymentForm.method)) errors.method = "Choose a valid payment method.";
    if (amountPaise !== null && tdsPaise !== null && amountPaise + tdsPaise > balancePaise) {
      errors.form = `Payment plus TDS cannot exceed the ${money(invoice?.totals, "balance")} outstanding balance.`;
    }
    setPaymentErrors(errors);
    if (Object.keys(errors).length) {
      const firstInvalidId = errors.amount || errors.form
        ? "payment-amount"
        : errors.tds_withheld_amount
          ? "payment-tds"
          : errors.payment_date
            ? "payment-date"
            : "payment-method";
      window.requestAnimationFrame(() => document.getElementById(firstInvalidId)?.focus());
      return;
    }

    paymentMutation.mutate({
      targetInvoiceId: invoiceId,
      payload: {
        amount: paymentForm.amount,
        tds_withheld_amount: paymentForm.tds_withheld_amount || "0",
        payment_date: paymentForm.payment_date,
        method: paymentForm.method,
        reference: paymentForm.reference.trim(),
        notes: paymentForm.notes.trim(),
      },
    });
  }

  function openEInvoiceDialog() {
    const metadata = invoice?.e_invoice || {};
    eInvoiceMutation.reset();
    setEInvoiceForm({
      irn: metadata.irn || "",
      ack_number: metadata.ack_number || "",
      ack_date: metadata.ack_date || "",
      signed_qr_data: metadata.signed_qr_data || "",
    });
    setEInvoiceErrors({});
    setEInvoiceOpen(true);
  }

  function updateEInvoiceForm(event) {
    const { name, value } = event.target;
    setEInvoiceForm((current) => ({
      ...current,
      [name]: name === "irn" ? value.toUpperCase() : value,
    }));
    setEInvoiceErrors((current) => ({ ...current, [name]: "", form: "" }));
  }

  function submitEInvoice(event) {
    event.preventDefault();
    const errors = {};
    const irn = eInvoiceForm.irn.trim().toUpperCase();
    const ackNumber = eInvoiceForm.ack_number.trim();
    const hasMetadata = Boolean(irn || ackNumber || eInvoiceForm.ack_date || eInvoiceForm.signed_qr_data.trim());

    if (hasMetadata && !irn) errors.irn = "IRN is required with acknowledgement metadata.";
    if (irn && !/^[A-F0-9]{64}$/.test(irn)) errors.irn = "IRN must be exactly 64 hexadecimal characters.";
    if (hasMetadata && !ackNumber) errors.ack_number = "Acknowledgement number is required with an IRN.";
    if (ackNumber && !/^[A-Za-z0-9/-]{1,30}$/.test(ackNumber)) errors.ack_number = "Use 1–30 letters, numbers, slashes, or hyphens.";
    if (hasMetadata && !eInvoiceForm.ack_date) errors.ack_date = "Acknowledgement date is required with an IRN.";
    if (!hasMetadata) errors.form = "Enter issued e-invoice metadata, or use Clear metadata on the detail page.";
    setEInvoiceErrors(errors);
    if (Object.keys(errors).length) {
      const firstInvalidId = errors.irn || errors.form
        ? "e-invoice-irn"
        : errors.ack_number
          ? "e-invoice-ack-number"
          : "e-invoice-ack-date";
      window.requestAnimationFrame(() => document.getElementById(firstInvalidId)?.focus());
      return;
    }

    eInvoiceMutation.mutate({
      targetInvoiceId: invoiceId,
      payload: {
        irn,
        ack_number: ackNumber,
        ack_date: eInvoiceForm.ack_date,
        signed_qr_data: eInvoiceForm.signed_qr_data.trim(),
      },
    });
  }

  function openCancelDialog() {
    cancelMutation.reset();
    setCancelReason("");
    setCancelError("");
    setCancelOpen(true);
  }

  function submitCancellation(event) {
    event.preventDefault();
    const reason = cancelReason.trim();
    if (reason.length < 2) {
      setCancelError("Give a reason of at least two characters.");
      window.requestAnimationFrame(() => document.getElementById("cancel-reason")?.focus());
      return;
    }
    cancelMutation.mutate({ targetInvoiceId: invoiceId, reason });
  }

  if (invoiceQuery.isPending && !invoice) {
    return (
      <div className="admin-page admin-invoice-detail-page">
        <PageHeader eyebrow="Invoice register" title="Invoice detail" description="Loading the saved document and payment ledger." />
        <LoadingState label="Loading invoice document…" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="admin-page admin-invoice-detail-page">
        <PageHeader
          eyebrow="Invoice register"
          title="Invoice unavailable"
          actions={<Link className="admin-button admin-button--outline" to="/admin/invoices"><ArrowLeft aria-hidden="true" /> Back to invoices</Link>}
        />
        <ErrorState error={invoiceQuery.error} onRetry={() => invoiceQuery.refetch()} title="We couldn't load this invoice" />
      </div>
    );
  }

  const totals = invoice.totals || {};
  const supplier = invoice.supplier_snapshot || {};
  const customer = invoice.customer_snapshot || {};
  const eInvoice = invoice.e_invoice || {};
  const payments = invoice.payments || [];
  const isDraft = invoice.status === "draft";
  const isCancelled = invoice.status === "cancelled";
  const isIssuedLike = MUTABLE_PAYMENT_STATUSES.has(invoice.status);
  const balancePaise = moneyPaise(totals, "balance");
  const settledPaise = moneyPaise(totals, "settled");
  const hasIrn = Boolean(String(eInvoice.irn || "").trim());
  const cancellationBlocked = settledPaise > 0 || hasIrn;
  const pdfBusy = downloadPdfMutation.isPending || previewPdfMutation.isPending;

  return (
    <div className="admin-page admin-invoice-detail-page">
      <Link className="admin-back-link" to="/admin/invoices">
        <ArrowLeft aria-hidden="true" /> Back to invoice register
      </Link>

      <PageHeader
        eyebrow={invoice.document_title || "Invoice document"}
        title={invoiceName(invoice)}
        description={isDraft
          ? "Review the saved draft. Its invoice number and final issued snapshot have not been allocated yet."
          : "A document-oriented view of the issued snapshot, tax calculation, and settlement ledger."}
        actions={(
          <div className="admin-page-actions">
            {isDraft ? (
              <Link className="admin-button admin-button--outline" to={`/admin/invoices/${invoice.id}/edit`}>
                <FilePenLine aria-hidden="true" /> Edit draft
              </Link>
            ) : null}
            {isDraft ? (
              <button
                className="admin-button admin-button--primary"
                type="button"
                onClick={() => {
                  issueMutation.reset();
                  setIssueReview({
                    targetInvoiceId: invoice.id,
                    expectedRevision: invoice.revision,
                  });
                }}
                disabled={issueMutation.isPending}
              >
                {issueMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                Issue invoice
              </button>
            ) : null}
            <button className="admin-button admin-button--outline" type="button" onClick={() => duplicateMutation.mutate({ targetInvoiceId: invoiceId })} disabled={duplicateMutation.isPending}>
              {duplicateMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <Copy aria-hidden="true" />}
              Duplicate
            </button>
            <button className="admin-button admin-button--outline" type="button" onClick={() => previewPdfMutation.mutate({ targetInvoiceId: invoiceId })} disabled={pdfBusy}>
              {previewPdfMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <Eye aria-hidden="true" />}
              Preview PDF
            </button>
            <button className="admin-button admin-button--outline" type="button" onClick={() => downloadPdfMutation.mutate({ targetInvoiceId: invoiceId, displayName: invoiceName(invoice) })} disabled={pdfBusy}>
              {downloadPdfMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              Download PDF
            </button>
            {isIssuedLike && !isCancelled ? (
              <button className="admin-button admin-button--danger" type="button" onClick={openCancelDialog} disabled={cancelMutation.isPending}>
                <Ban aria-hidden="true" /> Cancel invoice
              </button>
            ) : null}
          </div>
        )}
      />

      {latestActionError ? (
        <div className="admin-action-error">
          <ValidationSummary error={latestActionError} />
          <button className="admin-button admin-button--ghost" type="button" onClick={() => setLatestActionError(null)}>Dismiss</button>
        </div>
      ) : null}

      {invoiceQuery.isError ? (
        <InlineNotice tone="warning" title="The latest refresh failed">
          <div className="admin-refresh-warning__content">
            <p>The retained invoice document is still shown. Retry to confirm the latest server state.</p>
            <button className="admin-button admin-button--outline" type="button" onClick={() => invoiceQuery.refetch()} disabled={invoiceQuery.isFetching}>
              Retry refresh
            </button>
          </div>
        </InlineNotice>
      ) : null}

      {!isDraft ? (
        <InlineNotice tone="info" title="Issued values are frozen">
          Amounts and party snapshots on an issued invoice cannot be edited. Duplicate it to create a new draft instead.
        </InlineNotice>
      ) : null}
      {isCancelled ? (
        <InlineNotice tone="danger" title="Cancelled invoice">
          This document is retained for the audit trail and cannot accept payments or metadata changes.
          {invoice.cancel_reason ? ` Reason: ${invoice.cancel_reason}` : ""}
        </InlineNotice>
      ) : null}

      <article className="admin-invoice-document" aria-label={`${invoiceName(invoice)} document detail`}>
        <header className="admin-invoice-document__masthead">
          <div className="admin-invoice-document__supplier-mark">
            <span>{supplier.trade_name || supplier.display_name || "Suvi Interior"}</span>
            <small>{supplier.legal_name || "Interior design studio"}</small>
          </div>
          <div className="admin-invoice-document__identity">
            <StatusBadge status={invoice.status} />
            <p>{invoice.document_title || "INVOICE"}</p>
            <h2>{invoice.invoice_number || "NUMBER PENDING"}</h2>
            <code>{invoice.id}</code>
          </div>
        </header>

        <dl className="admin-invoice-document__facts">
          <Fact label="Invoice date">{formatDate(invoice.invoice_date)}</Fact>
          <Fact label="Due date">{formatDate(invoice.due_date)}</Fact>
          <Fact label="Project reference">{invoice.project_reference || "—"}</Fact>
          <Fact label="PO reference">{invoice.po_reference || "—"}</Fact>
          <Fact label="Financial year">{invoice.financial_year || "Allocated on issue"}</Fact>
          <Fact label="Sequence">{invoice.sequence_number ?? "Allocated on issue"}</Fact>
        </dl>

        <section className="admin-invoice-document__section" aria-labelledby="invoice-parties-heading">
          <div className="admin-invoice-document__section-heading">
            <div>
              <p className="admin-eyebrow">Document parties</p>
              <h2 id="invoice-parties-heading">Supplier, bill-to, and ship-to</h2>
            </div>
            <span>{isDraft ? "Saved draft snapshot" : "Frozen at issue"}</span>
          </div>
          <div className="admin-document-parties">
            <PartyPanel eyebrow="Supplier" party={supplier} address={supplier.address} note={titleCase(supplier.gst_registration_mode, "Registration not recorded")} />
            <PartyPanel eyebrow="Bill to" party={customer} address={customer.billing_address} note={titleCase(customer.customer_type, "Customer")} />
            <PartyPanel
              eyebrow="Ship to"
              party={customer}
              address={customer.shipping_same_as_billing ? customer.billing_address : customer.shipping_address}
              note={customer.shipping_same_as_billing ? "Same as bill-to address" : "Separate delivery address"}
            />
          </div>
        </section>

        <section className="admin-invoice-document__section" aria-labelledby="gst-treatment-heading">
          <div className="admin-invoice-document__section-heading">
            <div>
              <p className="admin-eyebrow">Tax treatment</p>
              <h2 id="gst-treatment-heading">GST regime and place of supply</h2>
            </div>
          </div>
          <dl className="admin-tax-facts">
            <Fact label="GST regime">{taxRegimeLabel(invoice.tax_regime)}</Fact>
            <Fact label="Place of supply">
              {invoice.place_of_supply?.state ? `${invoice.place_of_supply.state} (${invoice.place_of_supply.state_code})` : "—"}
            </Fact>
            <Fact label="Reverse charge">{invoice.reverse_charge ? "Yes" : "No"}</Fact>
            <Fact label="Tax mode">{invoice.tax_mode === "no_tax" ? "No tax" : "Automatic GST"}</Fact>
            <Fact label="Supplier registration">{titleCase(supplier.gst_registration_mode)}</Fact>
            <Fact label="E-invoice applicability">{supplier.e_invoice_applicable ? "Marked applicable" : "Not marked applicable"}</Fact>
          </dl>
        </section>

        <section className="admin-invoice-document__section" aria-labelledby="invoice-lines-heading">
          <div className="admin-invoice-document__section-heading">
            <div>
              <p className="admin-eyebrow">Calculation</p>
              <h2 id="invoice-lines-heading">Line items</h2>
            </div>
            <span>{invoice.lines?.length || 0} {(invoice.lines?.length || 0) === 1 ? "line" : "lines"}</span>
          </div>
          <div className="admin-table-shell admin-invoice-lines-shell">
            <table className="admin-table admin-invoice-lines">
              <caption className="admin-table__caption">Complete invoice line calculation</caption>
              <thead>
                <tr>
                  <th scope="col"># / item</th>
                  <th scope="col">HSN/SAC</th>
                  <th scope="col">Qty / unit</th>
                  <th scope="col">Rate</th>
                  <th scope="col">Gross</th>
                  <th scope="col">Discount</th>
                  <th scope="col">Taxable</th>
                  <th scope="col">GST</th>
                  <th scope="col">Line total</th>
                </tr>
              </thead>
              <tbody>
                {(invoice.lines || []).map((line, index) => (
                  <tr key={line.id || index}>
                    <td data-label="# / item">
                      <span className="admin-line-number">{index + 1}</span>
                      <strong>{line.name || "Unnamed item"}</strong>
                      <small>{titleCase(line.item_type)}</small>
                      {line.description ? <p>{line.description}</p> : null}
                    </td>
                    <td data-label="HSN/SAC">{line.hsn_sac || "—"}</td>
                    <td data-label="Qty / unit"><strong>{line.quantity}</strong><small>{line.unit || "—"}</small></td>
                    <td data-label="Rate">{money(line, "unit_rate")}</td>
                    <td data-label="Gross">{money(line, "gross")}</td>
                    <td data-label="Discount">
                      <span>{money(line, "discount")}</span>
                      {line.discount_type !== "none" ? <small>{titleCase(line.discount_type)} · {line.discount_value}</small> : <small>None</small>}
                    </td>
                    <td data-label="Taxable">{money(line, "taxable")}</td>
                    <td data-label="GST">
                      <span className="admin-line-tax__rate">{line.gst_rate || "0"}% · {money(line, "tax")}</span>
                      {invoice.tax_regime === "intra_state" ? (
                        <small>CGST {line.cgst_rate}% {money(line, "cgst")} · SGST {line.sgst_rate}% {money(line, "sgst")}</small>
                      ) : null}
                      {invoice.tax_regime === "inter_state" ? <small>IGST {line.igst_rate}% {money(line, "igst")}</small> : null}
                      {invoice.tax_regime === "no_tax" ? <small>No tax applied</small> : null}
                    </td>
                    <td data-label="Line total"><strong>{money(line, "line_total")}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="admin-invoice-totals-layout">
            <div className="admin-invoice-totals-layout__note">
              <FileText aria-hidden="true" />
              <div>
                <strong>{invoice.document_title || "Invoice"}</strong>
                <p>Calculated in INR using the saved invoice lines and tax treatment shown above.</p>
              </div>
            </div>
            <dl className="admin-invoice-totals">
              <TotalRow label="Gross subtotal" value={money(totals, "subtotal")} />
              <TotalRow label="Discount" value={money(totals, "discount")} />
              <TotalRow label="Taxable amount" value={money(totals, "taxable")} />
              <TotalRow label="CGST" value={money(totals, "cgst")} />
              <TotalRow label="SGST" value={money(totals, "sgst")} />
              <TotalRow label="IGST" value={money(totals, "igst")} />
              <TotalRow label="Total GST" value={money(totals, "total_tax")} />
              <TotalRow label={invoice.post_tax_adjustment_label || "Post-tax adjustment"} value={money(totals, "post_tax_adjustment")} />
              <TotalRow label="Round off" value={money(totals, "round_off")} />
              <TotalRow label="Grand total" value={money(totals, "grand_total")} emphasis />
            </dl>
          </div>
        </section>

        <section className="admin-invoice-document__section" aria-labelledby="amount-summary-heading">
          <div className="admin-invoice-document__section-heading">
            <div>
              <p className="admin-eyebrow">Settlement</p>
              <h2 id="amount-summary-heading">Amount and payment summary</h2>
            </div>
          </div>
          <dl className="admin-payment-summary">
            <div className="admin-payment-summary__item"><dt>Invoice total</dt><dd>{money(totals, "grand_total")}</dd></div>
            <div className="admin-payment-summary__item"><dt>Cash received</dt><dd>{money(totals, "received")}</dd></div>
            <div className="admin-payment-summary__item"><dt>TDS withheld</dt><dd>{money(totals, "tds_withheld")}</dd></div>
            <div className="admin-payment-summary__item"><dt>Total settled</dt><dd>{money(totals, "settled")}</dd></div>
            <div className="admin-payment-summary__item admin-payment-summary__item--balance"><dt>Balance due</dt><dd>{money(totals, "balance")}</dd></div>
          </dl>
        </section>

        <section className="admin-invoice-document__section" aria-labelledby="invoice-notes-heading">
          <div className="admin-invoice-document__section-heading">
            <div>
              <p className="admin-eyebrow">Document copy</p>
              <h2 id="invoice-notes-heading">Notes and terms</h2>
            </div>
          </div>
          <div className="admin-document-copy-grid">
            <div className="admin-document-copy">
              <h3>Notes</h3>
              <p>{invoice.notes || "No notes recorded."}</p>
            </div>
            <div className="admin-document-copy">
              <h3>Terms</h3>
              <p>{invoice.terms || "No payment terms recorded."}</p>
            </div>
          </div>
        </section>
      </article>

      <SectionCard
        className="admin-payment-history"
        title="Payment history"
        description="Recorded receipts and TDS withholding contribute to the settled amount. Deleting a record recalculates the balance."
        action={isIssuedLike && !isCancelled && balancePaise > 0 ? (
          <button className="admin-button admin-button--primary" type="button" onClick={openPaymentDialog} disabled={paymentMutation.isPending}>
            <Plus aria-hidden="true" /> Add payment
          </button>
        ) : null}
      >
        {isDraft ? (
          <div className="admin-section-empty"><ReceiptIndianRupee aria-hidden="true" /><p>Payments can be recorded only after this draft is issued.</p></div>
        ) : payments.length === 0 ? (
          <div className="admin-section-empty"><ReceiptIndianRupee aria-hidden="true" /><p>No payments or TDS settlements have been recorded.</p></div>
        ) : (
          <div className="admin-table-shell">
            <table className="admin-table admin-payment-table">
              <caption className="admin-table__caption">Payment and TDS settlement history</caption>
              <thead>
                <tr>
                  <th scope="col">Payment date</th>
                  <th scope="col">Method</th>
                  <th scope="col">Amount received</th>
                  <th scope="col">TDS withheld</th>
                  <th scope="col">Settlement</th>
                  <th scope="col">Reference / notes</th>
                  <th scope="col">Recorded</th>
                  <th scope="col"><span className="admin-table__action-label">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id}>
                    <td data-label="Payment date">{formatDate(payment.payment_date)}</td>
                    <td data-label="Method">{paymentMethodLabel(payment.method)}</td>
                    <td data-label="Amount received">{money(payment, "amount")}</td>
                    <td data-label="TDS withheld">{money(payment, "tds_withheld")}</td>
                    <td data-label="Settlement"><strong>{money(payment, "settlement")}</strong></td>
                    <td data-label="Reference / notes">
                      <span>{payment.reference || "—"}</span>
                      {payment.notes ? <small>{payment.notes}</small> : null}
                    </td>
                    <td data-label="Recorded">
                      <span>{formatDateTime(payment.created_at)}</span>
                      {payment.created_by ? <small>By {payment.created_by}</small> : null}
                    </td>
                    <td data-label="Actions">
                      {!isCancelled ? (
                        <button
                          className="admin-icon-button admin-icon-button--danger"
                          type="button"
                          onClick={() => {
                            deletePaymentMutation.reset();
                            setPaymentToDelete(payment);
                          }}
                          disabled={deletePaymentMutation.isPending}
                          aria-label={`Delete payment from ${formatDate(payment.payment_date)}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard
        className="admin-e-invoice-card"
        title="Manual e-invoice metadata"
        description="Keep IRN acknowledgement details alongside the issued invoice when obtained through an external process."
        action={!isDraft && !isCancelled ? (
          <div className="admin-card-actions">
            <button className="admin-button admin-button--outline" type="button" onClick={openEInvoiceDialog} disabled={eInvoiceMutation.isPending}>
              <Landmark aria-hidden="true" /> {hasIrn ? "Update metadata" : "Add metadata"}
            </button>
            {hasIrn ? (
              <button className="admin-button admin-button--danger" type="button" onClick={() => setClearEInvoiceOpen(true)} disabled={eInvoiceMutation.isPending}>
                <Trash2 aria-hidden="true" /> Clear metadata
              </button>
            ) : null}
          </div>
        ) : null}
      >
        <InlineNotice tone="warning" title="IRP is not connected">
          This workspace only stores metadata entered manually. It does not generate, submit, validate, or cancel an e-invoice with the Invoice Registration Portal.
        </InlineNotice>
        {isDraft ? <p className="admin-section-copy">Issue the draft before attaching externally obtained e-invoice metadata.</p> : null}
        {!isDraft && !hasIrn ? <p className="admin-section-copy">No IRN or acknowledgement metadata is recorded locally.</p> : null}
        {hasIrn ? (
          <dl className="admin-e-invoice-metadata">
            <Fact label="IRN"><code className="admin-code-wrap">{eInvoice.irn}</code></Fact>
            <Fact label="Acknowledgement number">{eInvoice.ack_number || "—"}</Fact>
            <Fact label="Acknowledgement date">{formatDate(eInvoice.ack_date)}</Fact>
            <Fact label="Source">{titleCase(eInvoice.source || "manual")}</Fact>
            <Fact label="Last updated">{formatDateTime(eInvoice.updated_at)}</Fact>
            <Fact label="Updated by">{eInvoice.updated_by || "—"}</Fact>
          </dl>
        ) : null}
        {eInvoice.signed_qr_data ? (
          <details className="admin-e-invoice-payload">
            <summary>View stored signed QR payload</summary>
            <pre>{eInvoice.signed_qr_data}</pre>
          </details>
        ) : null}
      </SectionCard>

      <SectionCard className="admin-audit-card" title="Document audit" description="Immutable lifecycle timestamps and the latest document revision.">
        <dl className="admin-audit-grid">
          <Fact label="Created">{formatDateTime(invoice.created_at)}</Fact>
          <Fact label="Created by">{invoice.created_by || "—"}</Fact>
          <Fact label="Last updated">{formatDateTime(invoice.updated_at)}</Fact>
          <Fact label="Updated by">{invoice.updated_by || "—"}</Fact>
          <Fact label="Issued">{formatDateTime(invoice.issued_at)}</Fact>
          <Fact label="Issued by">{invoice.issued_by || "—"}</Fact>
          <Fact label="Cancelled">{formatDateTime(invoice.cancelled_at)}</Fact>
          <Fact label="Cancelled by">{invoice.cancelled_by || "—"}</Fact>
          <Fact label="Revision">{invoice.revision ?? "—"}</Fact>
          <Fact label="Schema version">{invoice.schema_version ?? "—"}</Fact>
          <Fact label="Document ID"><code className="admin-code-wrap">{invoice.id}</code></Fact>
          <Fact label="Cancellation reason">{invoice.cancel_reason || "—"}</Fact>
        </dl>
      </SectionCard>

      <ConfirmDialog
        open={Boolean(issueReview)}
        onOpenChange={(open) => {
          if (!open && !issueMutation.isPending) setIssueReview(null);
        }}
        title="Issue this draft?"
        description="Issuing allocates the next invoice number and freezes financial values and party snapshots. The backend revalidates the exact draft revision and GST compliance against current business settings. If the draft or those settings change, issuance stops and you must review the refreshed draft before confirming again. An issued invoice cannot be changed back into an editable draft."
        confirmLabel="Issue invoice"
        tone="primary"
        busy={issueMutation.isPending}
        onConfirm={() => {
          if (issueReview) issueMutation.mutate(issueReview);
        }}
      />

      <Dialog
        open={paymentOpen}
        onOpenChange={(open) => {
          if (!open && paymentMutation.isPending) return;
          setPaymentOpen(open);
        }}
      >
        <DialogContent className="admin-dialog">
          <DialogHeader>
            <DialogTitle>Record payment and TDS</DialogTitle>
            <DialogDescription>
              Record cash received and any tax withheld by the customer. Their sum reduces the outstanding balance.
            </DialogDescription>
          </DialogHeader>
          <form className="admin-dialog-form" onSubmit={submitPayment} noValidate>
            <div className="admin-dialog-form__grid">
              <Field label="Amount received" required error={paymentErrors.amount} hint={`Outstanding: ${money(totals, "balance")}`}>
                <input
                  id="payment-amount"
                  name="amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={paymentForm.amount}
                  onChange={updatePaymentForm}
                  required
                  aria-invalid={Boolean(paymentErrors.amount || paymentErrors.form)}
                  aria-describedby={paymentErrors.amount || paymentErrors.form ? "payment-form-errors" : undefined}
                  autoFocus
                />
              </Field>
              <Field label="TDS withheld" error={paymentErrors.tds_withheld_amount} hint="Use 0.00 when no tax was withheld.">
                <input
                  id="payment-tds"
                  name="tds_withheld_amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={paymentForm.tds_withheld_amount}
                  onChange={updatePaymentForm}
                  aria-invalid={Boolean(paymentErrors.tds_withheld_amount || paymentErrors.form)}
                  aria-describedby={paymentErrors.tds_withheld_amount || paymentErrors.form ? "payment-form-errors" : undefined}
                />
              </Field>
              <Field label="Payment date" required error={paymentErrors.payment_date}>
                <input
                  id="payment-date"
                  name="payment_date"
                  type="date"
                  min={invoice.invoice_date || undefined}
                  max={paymentBusinessDate || undefined}
                  value={paymentForm.payment_date}
                  onChange={updatePaymentForm}
                  required
                  aria-invalid={Boolean(paymentErrors.payment_date)}
                  aria-describedby={paymentErrors.payment_date ? "payment-form-errors" : undefined}
                />
              </Field>
              <Field label="Payment method" required error={paymentErrors.method}>
                <select
                  id="payment-method"
                  name="method"
                  value={paymentForm.method}
                  onChange={updatePaymentForm}
                  required
                  aria-invalid={Boolean(paymentErrors.method)}
                  aria-describedby={paymentErrors.method ? "payment-form-errors" : undefined}
                >
                  <option value="" disabled>Select payment method</option>
                  {PAYMENT_METHODS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Reference" hint="Bank reference, UTR, cheque number, or receipt note" className="admin-dialog-form__wide">
                <input name="reference" type="text" maxLength={240} value={paymentForm.reference} onChange={updatePaymentForm} />
              </Field>
              <Field label="Notes" className="admin-dialog-form__wide">
                <textarea name="notes" rows={3} maxLength={2000} value={paymentForm.notes} onChange={updatePaymentForm} />
              </Field>
            </div>
            {Object.values(paymentErrors).some(Boolean) ? (
              <div id="payment-form-errors" className="admin-form-error" role="alert">
                <strong>Check the payment details</strong>
                <ul>{Array.from(new Set(Object.values(paymentErrors).filter(Boolean))).map((message) => <li key={message}>{message}</li>)}</ul>
              </div>
            ) : null}
            <ValidationSummary error={paymentMutation.error} />
            <DialogFooter className="admin-dialog__footer">
              <button className="admin-button admin-button--ghost" type="button" onClick={() => setPaymentOpen(false)} disabled={paymentMutation.isPending}>Cancel</button>
              <button className="admin-button admin-button--primary" type="submit" disabled={paymentMutation.isPending}>
                {paymentMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <CreditCard aria-hidden="true" />}
                Record settlement
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(paymentToDelete)}
        onOpenChange={(open) => {
          if (!open && !deletePaymentMutation.isPending) setPaymentToDelete(null);
        }}
        title="Delete this payment record?"
        description={paymentToDelete
          ? `${money(paymentToDelete, "settlement")} from ${formatDate(paymentToDelete.payment_date)} will be removed, and the invoice balance and status will be recalculated.`
          : "The payment will be removed and the invoice recalculated."}
        confirmLabel="Delete payment"
        tone="danger"
        busy={deletePaymentMutation.isPending}
        onConfirm={() => paymentToDelete && deletePaymentMutation.mutate({ targetInvoiceId: invoiceId, paymentId: paymentToDelete.id })}
      />

      <Dialog
        open={eInvoiceOpen}
        onOpenChange={(open) => {
          if (!open && eInvoiceMutation.isPending) return;
          setEInvoiceOpen(open);
        }}
      >
        <DialogContent className="admin-dialog">
          <DialogHeader>
            <DialogTitle>{hasIrn ? "Update manual e-invoice metadata" : "Add manual e-invoice metadata"}</DialogTitle>
            <DialogDescription>Store details only after they have been obtained through the appropriate external process.</DialogDescription>
          </DialogHeader>
          <InlineNotice tone="warning" title="No IRP connection">
            Saving here does not file, register, verify, or cancel anything with the Invoice Registration Portal.
          </InlineNotice>
          <form className="admin-dialog-form" onSubmit={submitEInvoice} noValidate>
            <div className="admin-dialog-form__grid">
              <Field label="IRN" required error={eInvoiceErrors.irn} hint="Exactly 64 hexadecimal characters" className="admin-dialog-form__wide">
                <input
                  id="e-invoice-irn"
                  name="irn"
                  type="text"
                  maxLength={64}
                  value={eInvoiceForm.irn}
                  onChange={updateEInvoiceForm}
                  autoCapitalize="characters"
                  required
                  aria-invalid={Boolean(eInvoiceErrors.irn || eInvoiceErrors.form)}
                  aria-describedby={eInvoiceErrors.irn || eInvoiceErrors.form ? "e-invoice-form-errors" : undefined}
                  autoFocus
                />
              </Field>
              <Field label="Acknowledgement number" required error={eInvoiceErrors.ack_number}>
                <input
                  id="e-invoice-ack-number"
                  name="ack_number"
                  type="text"
                  maxLength={30}
                  value={eInvoiceForm.ack_number}
                  onChange={updateEInvoiceForm}
                  required
                  aria-invalid={Boolean(eInvoiceErrors.ack_number)}
                  aria-describedby={eInvoiceErrors.ack_number ? "e-invoice-form-errors" : undefined}
                />
              </Field>
              <Field label="Acknowledgement date" required error={eInvoiceErrors.ack_date}>
                <input
                  id="e-invoice-ack-date"
                  name="ack_date"
                  type="date"
                  value={eInvoiceForm.ack_date}
                  onChange={updateEInvoiceForm}
                  required
                  aria-invalid={Boolean(eInvoiceErrors.ack_date)}
                  aria-describedby={eInvoiceErrors.ack_date ? "e-invoice-form-errors" : undefined}
                />
              </Field>
              <Field label="Signed QR payload" hint="Optional raw signed data; it must fit the PDF QR encoder (4,096-character input limit)" className="admin-dialog-form__wide">
                <textarea name="signed_qr_data" rows={5} maxLength={4096} value={eInvoiceForm.signed_qr_data} onChange={updateEInvoiceForm} />
              </Field>
            </div>
            {Object.values(eInvoiceErrors).some(Boolean) ? (
              <div id="e-invoice-form-errors" className="admin-form-error" role="alert">
                <strong>Check the e-invoice metadata</strong>
                <ul>{Array.from(new Set(Object.values(eInvoiceErrors).filter(Boolean))).map((message) => <li key={message}>{message}</li>)}</ul>
              </div>
            ) : null}
            <ValidationSummary error={eInvoiceMutation.error} />
            <DialogFooter className="admin-dialog__footer">
              <button className="admin-button admin-button--ghost" type="button" onClick={() => setEInvoiceOpen(false)} disabled={eInvoiceMutation.isPending}>Cancel</button>
              <button className="admin-button admin-button--primary" type="submit" disabled={eInvoiceMutation.isPending}>
                {eInvoiceMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <Landmark aria-hidden="true" />}
                Save metadata
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={clearEInvoiceOpen}
        onOpenChange={(open) => {
          if (open || !eInvoiceMutation.isPending) setClearEInvoiceOpen(open);
        }}
        title="Clear local e-invoice metadata?"
        description="This removes the locally stored IRN, acknowledgement, and signed QR payload only. It does not cancel or update an e-invoice at the IRP; complete any required external cancellation first."
        confirmLabel="Clear local metadata"
        tone="danger"
        busy={eInvoiceMutation.isPending}
        onConfirm={() => eInvoiceMutation.mutate({
          targetInvoiceId: invoiceId,
          payload: { irn: "", ack_number: "", ack_date: null, signed_qr_data: "" },
        })}
      />

      <Dialog
        open={cancelOpen}
        onOpenChange={(open) => {
          if (!open && cancelMutation.isPending) return;
          setCancelOpen(open);
        }}
      >
        <DialogContent className="admin-dialog admin-dialog--small">
          <DialogHeader>
            <DialogTitle>Cancel {invoice.invoice_number || "invoice"} locally?</DialogTitle>
            <DialogDescription>
              Cancellation is retained in the audit trail and cannot be reversed in this workspace. Give a clear reason for the record.
            </DialogDescription>
          </DialogHeader>
          {settledPaise > 0 ? (
            <InlineNotice tone="danger" title="Recorded settlement blocks cancellation">
              Delete all payment and TDS records ({money(totals, "settled")} currently settled) before cancelling locally, or use the appropriate credit-note workflow outside this invoice editor.
            </InlineNotice>
          ) : null}
          {hasIrn ? (
            <InlineNotice tone="danger" title="Stored IRN blocks cancellation">
              Complete any applicable cancellation with the IRP externally before clearing local IRN metadata. Clearing metadata does not contact or cancel at the IRP.
            </InlineNotice>
          ) : null}
          {!cancellationBlocked ? (
            <InlineNotice tone="warning" title="Local action only">
              This marks the invoice cancelled in this workspace. It does not notify a customer or contact any tax portal.
            </InlineNotice>
          ) : null}
          <form className="admin-dialog-form" onSubmit={submitCancellation} noValidate>
            <Field label="Cancellation reason" required hint="2–1,000 characters">
              <textarea
                id="cancel-reason"
                name="cancel_reason"
                rows={4}
                maxLength={1000}
                value={cancelReason}
                onChange={(event) => {
                  setCancelReason(event.target.value);
                  setCancelError("");
                }}
                disabled={cancellationBlocked || cancelMutation.isPending}
                required
                aria-invalid={Boolean(cancelError)}
                aria-describedby={cancelError ? "cancel-reason-error" : undefined}
                autoFocus={!cancellationBlocked}
              />
            </Field>
            {cancelError ? <p id="cancel-reason-error" className="admin-form-error" role="alert">{cancelError}</p> : null}
            <ValidationSummary error={cancelMutation.error} />
            <DialogFooter className="admin-dialog__footer">
              <button className="admin-button admin-button--ghost" type="button" onClick={() => setCancelOpen(false)} disabled={cancelMutation.isPending}>Keep invoice</button>
              <button className="admin-button admin-button--danger" type="submit" disabled={cancellationBlocked || cancelMutation.isPending}>
                {cancelMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <Ban aria-hidden="true" />}
                Cancel invoice
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={(open) => { if (!open) closePdfPreview(); }}>
        <DialogContent className="admin-dialog admin-pdf-dialog">
          <DialogHeader>
            <DialogTitle>PDF preview · {invoiceName(invoice)}</DialogTitle>
            <DialogDescription>Private authenticated preview. Download the file if your browser cannot display PDFs inline.</DialogDescription>
          </DialogHeader>
          <div className="admin-pdf-preview">
            {previewUrl ? <iframe className="admin-pdf-preview__frame" src={previewUrl} title={`PDF preview of ${invoiceName(invoice)}`} /> : <LoadingState label="Preparing PDF preview…" />}
          </div>
          <DialogFooter className="admin-dialog__footer">
            <button className="admin-button admin-button--ghost" type="button" onClick={closePdfPreview}>Close preview</button>
            <button className="admin-button admin-button--primary" type="button" onClick={() => downloadPdfMutation.mutate({ targetInvoiceId: invoiceId, displayName: invoiceName(invoice) })} disabled={downloadPdfMutation.isPending}>
              {downloadPdfMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
              Download PDF
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
