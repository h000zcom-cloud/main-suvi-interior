import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FilePenLine,
  FileSignature,
  FileText,
  LoaderCircle,
  Send,
  Trash2,
  XCircle,
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
import {
  adminApi,
  apiError,
  invalidateQuotationQueries,
} from "@/admin/api";
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

const STATUS_CONFIRMATIONS = {
  accepted: {
    title: "Accept this quotation?",
    description: "This records the customer's acceptance. The accepted quotation can then be converted into an invoice draft.",
    confirmLabel: "Mark accepted",
    tone: "primary",
  },
  declined: {
    title: "Decline this quotation?",
    description: "This records that the customer declined the sent quotation. The stored snapshot remains available for audit and duplication.",
    confirmLabel: "Mark declined",
    tone: "danger",
  },
  expired: {
    title: "Mark this quotation expired?",
    description: "Its validity date has elapsed. This records expiry while retaining the sent snapshot for reference and duplication.",
    confirmLabel: "Mark expired",
    tone: "outline",
  },
};

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

function quotationName(quotation) {
  if (quotation?.quotation_number) return quotation.quotation_number;
  const reference = String(quotation?.id || "").slice(-6).toUpperCase();
  const label = quotation?.status === "draft" ? "Quotation draft" : "Quotation number pending";
  return reference ? `${label} · ${reference}` : label;
}

function money(container, key) {
  return formatMoney(container?.[`${key}_paise`], container?.[`${key}_display`]);
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

function convertedInvoiceId(quotation) {
  return quotation?.converted_invoice_id
    || quotation?.converted_to_invoice_id
    || quotation?.invoice_id
    || quotation?.converted_invoice?.id
    || quotation?.conversion?.invoice_id
    || "";
}

function AddressBlock({ address }) {
  const source = address || {};
  const locality = [
    source.city,
    source.state && `${source.state}${source.state_code ? ` (${source.state_code})` : ""}`,
    source.pincode,
  ].filter(Boolean).join(", ");
  const lines = [source.line1, source.line2, source.line3, locality, source.country].filter(Boolean);
  if (!lines.length) return <p className="admin-document-address__empty">Address not recorded</p>;
  return <address className="admin-document-address">{lines.map((line, index) => <span key={`${line}-${index}`}>{line}</span>)}</address>;
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
  return <div className="admin-fact"><dt>{label}</dt><dd>{children ?? "—"}</dd></div>;
}

function TotalRow({ label, value, emphasis = false }) {
  return <div className={`admin-invoice-total ${emphasis ? "admin-invoice-total--emphasis" : ""}`}><dt>{label}</dt><dd>{value}</dd></div>;
}

function taxRegimeLabel(value) {
  if (value === "intra_state") return "Intra-state · CGST + SGST";
  if (value === "inter_state") return "Inter-state · IGST";
  if (value === "no_tax") return "No GST calculation";
  return titleCase(value);
}

function quotationValidityElapsed(quotation, businessDate) {
  return Boolean(
    businessDate
    && quotation?.valid_until
    && quotation.valid_until < businessDate,
  );
}

function revisionNumber(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : null;
}

export default function QuotationDetailPage() {
  const { quotationId = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [sendReview, setSendReview] = useState(null);
  const [statusReview, setStatusReview] = useState(null);
  const [duplicateReview, setDuplicateReview] = useState(null);
  const [deleteReview, setDeleteReview] = useState(null);
  const [convertReview, setConvertReview] = useState(null);
  const [conversionForm, setConversionForm] = useState({ invoice_date: "", due_date: "" });
  const [conversionErrors, setConversionErrors] = useState({});
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewFilename, setPreviewFilename] = useState("");
  const [statusGuardPending, setStatusGuardPending] = useState(false);
  const previewUrlRef = useRef("");
  const previewRevisionRef = useRef(null);
  const currentQuotationIdRef = useRef(quotationId);
  const currentQuotationRevisionRef = useRef(null);
  const mountedRef = useRef(true);
  const [latestActionError, setLatestActionError] = useState(null);
  const [reviewWarning, setReviewWarning] = useState("");
  currentQuotationIdRef.current = quotationId;

  const quotationQuery = useQuery({
    queryKey: ["admin", "quotation", quotationId],
    queryFn: () => adminApi.quotations.get(quotationId),
    enabled: Boolean(quotationId),
  });
  const metadataQuery = useQuery({
    queryKey: ["admin", "metadata"],
    queryFn: adminApi.metadata,
  });

  const quotation = quotationQuery.data;
  currentQuotationRevisionRef.current = quotation?.revision ?? null;
  useAdminTitle(quotation?.quotation_number || (quotation ? "Draft quotation" : "Quotation detail"));

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
    previewRevisionRef.current = null;
    setSendReview(null);
    setStatusReview(null);
    setDuplicateReview(null);
    setDeleteReview(null);
    setConvertReview(null);
    setConversionForm({ invoice_date: "", due_date: "" });
    setConversionErrors({});
    setPreviewOpen(false);
    setPreviewUrl("");
    setPreviewFilename("");
    setStatusGuardPending(false);
    setLatestActionError(null);
    setReviewWarning("");
  }, [quotationId]);

  useEffect(() => {
    if (!previewUrlRef.current || previewRevisionRef.current === null) return;
    if (String(previewRevisionRef.current) === String(quotation?.revision ?? "")) return;
    URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = "";
    previewRevisionRef.current = null;
    setPreviewOpen(false);
    setPreviewUrl("");
    setPreviewFilename("");
    setReviewWarning("The quotation changed after this PDF was generated. Create a fresh preview before downloading or sharing it.");
  }, [quotation?.revision]);

  useEffect(() => {
    if (!convertReview || conversionForm.invoice_date || !metadataQuery.data?.business_date) return;
    setConversionForm((current) => ({
      ...current,
      invoice_date: current.invoice_date || metadataQuery.data.business_date,
    }));
  }, [convertReview, conversionForm.invoice_date, metadataQuery.data?.business_date]);

  function isCurrentTarget(targetQuotationId, expectedRevision) {
    if (!mountedRef.current || currentQuotationIdRef.current !== targetQuotationId) return false;
    if (expectedRevision === undefined) return true;
    return String(currentQuotationRevisionRef.current ?? "") === String(expectedRevision ?? "");
  }

  function rejectStalePdf(targetQuotationId) {
    if (!isCurrentTarget(targetQuotationId)) return;
    queryClient.invalidateQueries({ queryKey: ["admin", "quotation", targetQuotationId], exact: true });
    setReviewWarning("The quotation changed while its PDF was being generated. Review the latest revision and create a fresh PDF.");
    toast.warning("The outdated PDF response was discarded.");
  }

  function cacheQuotationResponse(candidate, targetQuotationId, convertedInvoice = null) {
    if (!candidate || candidate.id !== targetQuotationId) return false;
    const cached = queryClient.getQueryData(["admin", "quotation", targetQuotationId]);
    const cachedRevision = revisionNumber(cached?.revision);
    const candidateRevision = revisionNumber(candidate.revision);
    if (
      candidateRevision === null
      || (cachedRevision !== null && candidateRevision < cachedRevision)
    ) {
      invalidateQuotationQueries(queryClient, targetQuotationId, { convertedInvoice });
      return false;
    }
    invalidateQuotationQueries(queryClient, targetQuotationId, {
      quotation: candidate,
      convertedInvoice,
    });
    return true;
  }

  function closeMutationDialogs() {
    setSendReview(null);
    setStatusReview(null);
    setDuplicateReview(null);
    setDeleteReview(null);
    setConvertReview(null);
    setConversionErrors({});
  }

  function clearCurrentActionError(targetQuotationId) {
    if (isCurrentTarget(targetQuotationId)) setLatestActionError(null);
  }

  function acceptQuotationResponse(updated, message, targetQuotationId, expectedRevision) {
    const returnedRevision = revisionNumber(updated?.revision);
    const requestedRevision = revisionNumber(expectedRevision);
    let responseAccepted = false;
    if (requestedRevision !== null && returnedRevision !== null && returnedRevision < requestedRevision) {
      invalidateQuotationQueries(queryClient, targetQuotationId);
    } else {
      responseAccepted = cacheQuotationResponse(updated, targetQuotationId);
    }
    if (!isCurrentTarget(targetQuotationId)) return;
    if (!responseAccepted) {
      closePdfPreview();
      closeMutationDialogs();
      setReviewWarning("A newer quotation revision is already available. The delayed action response was discarded and the latest document is being refreshed.");
      toast.warning("A stale quotation response was discarded.");
      return;
    }
    setLatestActionError(null);
    setReviewWarning("");
    closePdfPreview();
    closeMutationDialogs();
    if (message) toast.success(message);
  }

  function handleStructuredConflict(error, fallback, targetQuotationId) {
    const refreshed = error?.response?.data?.detail?.quotation;
    if (!refreshed || refreshed.id !== targetQuotationId) return false;
    const normalized = apiError(error, fallback);
    const responseAccepted = cacheQuotationResponse(refreshed, targetQuotationId);
    if (isCurrentTarget(targetQuotationId)) {
      setLatestActionError(null);
      closePdfPreview();
      closeMutationDialogs();
      setReviewWarning(responseAccepted
        ? `${normalized.message} Review the refreshed quotation before confirming another action.`
        : "A newer quotation revision is already available. The older conflict response was discarded and the latest document is being refreshed.");
      toast.warning(responseAccepted ? normalized.message : "A stale quotation response was discarded.");
    }
    return true;
  }

  function reportMutationError(error, fallback, targetQuotationId) {
    if (!isCurrentTarget(targetQuotationId)) return;
    const normalized = apiError(error, fallback);
    closeMutationDialogs();
    setLatestActionError(error);
    toast.error(normalized.message);
  }

  const sendMutation = useMutation({
    mutationFn: ({ targetQuotationId, expectedRevision }) => adminApi.quotations.send(
      targetQuotationId,
      { expected_revision: expectedRevision },
    ),
    onMutate: ({ targetQuotationId }) => clearCurrentActionError(targetQuotationId),
    onSuccess: (updated, { targetQuotationId, expectedRevision }) => {
      acceptQuotationResponse(
        updated,
        `${updated.quotation_number || "Quotation"} sent and frozen.`,
        targetQuotationId,
        expectedRevision,
      );
    },
    onError: (error, { targetQuotationId }) => {
      if (handleStructuredConflict(error, "The quotation could not be sent.", targetQuotationId)) return;
      reportMutationError(error, "The quotation could not be sent.", targetQuotationId);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ targetQuotationId, expectedRevision, status }) => adminApi.quotations.status(
      targetQuotationId,
      { expected_revision: expectedRevision, status },
    ),
    onMutate: ({ targetQuotationId }) => clearCurrentActionError(targetQuotationId),
    onSuccess: (updated, {
      targetQuotationId,
      expectedRevision,
      status,
    }) => {
      acceptQuotationResponse(
        updated,
        `Quotation marked ${titleCase(status).toLowerCase()}.`,
        targetQuotationId,
        expectedRevision,
      );
    },
    onError: (error, { targetQuotationId }) => {
      if (handleStructuredConflict(error, "The quotation status could not be changed.", targetQuotationId)) return;
      reportMutationError(error, "The quotation status could not be changed.", targetQuotationId);
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: ({ targetQuotationId, expectedRevision }) => adminApi.quotations.duplicate(
      targetQuotationId,
      { expected_revision: expectedRevision },
    ),
    onMutate: ({ targetQuotationId }) => clearCurrentActionError(targetQuotationId),
    onSuccess: (created, { targetQuotationId }) => {
      invalidateQuotationQueries(queryClient, targetQuotationId);
      queryClient.setQueryData(["admin", "quotation", created.id], created);
      if (!isCurrentTarget(targetQuotationId)) return;
      closeMutationDialogs();
      toast.success("A new quotation draft was created.");
      navigate(`/admin/quotations/${created.id}/edit`);
    },
    onError: (error, { targetQuotationId }) => {
      if (handleStructuredConflict(error, "The quotation could not be duplicated.", targetQuotationId)) return;
      reportMutationError(error, "The quotation could not be duplicated.", targetQuotationId);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ targetQuotationId, expectedRevision }) => adminApi.quotations.delete(
      targetQuotationId,
      expectedRevision,
    ),
    onMutate: ({ targetQuotationId }) => clearCurrentActionError(targetQuotationId),
    onSuccess: (_, { targetQuotationId }) => {
      queryClient.removeQueries({ queryKey: ["admin", "quotation", targetQuotationId], exact: true });
      invalidateQuotationQueries(queryClient);
      if (!isCurrentTarget(targetQuotationId)) return;
      closeMutationDialogs();
      toast.success("Quotation draft deleted.");
      navigate("/admin/quotations");
    },
    onError: (error, { targetQuotationId }) => {
      if (handleStructuredConflict(error, "The quotation draft could not be deleted.", targetQuotationId)) return;
      reportMutationError(error, "The quotation draft could not be deleted.", targetQuotationId);
    },
  });

  const convertMutation = useMutation({
    mutationFn: ({ targetQuotationId, expectedRevision, invoiceDate, dueDate }) => adminApi.quotations.convert(
      targetQuotationId,
      { expected_revision: expectedRevision, invoice_date: invoiceDate, due_date: dueDate || null },
    ),
    onMutate: ({ targetQuotationId }) => clearCurrentActionError(targetQuotationId),
    onSuccess: (result, { targetQuotationId }) => {
      const responseAccepted = cacheQuotationResponse(
        result.quotation,
        targetQuotationId,
        result.invoice,
      );
      if (!isCurrentTarget(targetQuotationId)) return;
      closePdfPreview();
      closeMutationDialogs();
      setLatestActionError(null);
      setReviewWarning("");
      if (!result.invoice?.id) {
        toast.error("The conversion completed without an invoice identifier. Refresh the quotation to review it.");
        return;
      }
      if (responseAccepted) {
        toast.success(result.idempotent ? "The existing converted invoice was opened." : "Invoice draft created from the accepted quotation.");
      } else {
        toast.warning("Conversion completed; a newer quotation revision was retained while the invoice opens.");
      }
      navigate(`/admin/invoices/${result.invoice.id}`);
    },
    onError: (error, { targetQuotationId }) => {
      if (handleStructuredConflict(error, "The quotation could not be converted.", targetQuotationId)) return;
      reportMutationError(error, "The quotation could not be converted.", targetQuotationId);
    },
  });

  const downloadPdfMutation = useMutation({
    mutationFn: ({ targetQuotationId, expectedRevision }) => adminApi.quotations.pdf(
      targetQuotationId,
      false,
      expectedRevision,
    ),
    onMutate: ({ targetQuotationId }) => clearCurrentActionError(targetQuotationId),
    onSuccess: ({ blob, disposition, renderedRevision }, {
      targetQuotationId,
      expectedRevision,
      displayName,
    }) => {
      if (
        !isCurrentTarget(targetQuotationId, expectedRevision)
        || revisionNumber(renderedRevision) !== revisionNumber(expectedRevision)
      ) {
        rejectStalePdf(targetQuotationId);
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = safeFilename(disposition, `Suvi-Interior-${displayName}.pdf`);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      toast.success("Quotation PDF downloaded.");
    },
    onError: (error, { targetQuotationId, expectedRevision }) => {
      if (handleStructuredConflict(error, "The quotation PDF could not be generated from the reviewed revision.", targetQuotationId)) return;
      if (!isCurrentTarget(targetQuotationId, expectedRevision)) {
        rejectStalePdf(targetQuotationId);
        return;
      }
      reportMutationError(error, "The quotation PDF could not be downloaded.", targetQuotationId);
    },
  });

  const previewPdfMutation = useMutation({
    mutationFn: ({ targetQuotationId, expectedRevision }) => adminApi.quotations.pdf(
      targetQuotationId,
      true,
      expectedRevision,
    ),
    onMutate: ({ targetQuotationId }) => clearCurrentActionError(targetQuotationId),
    onSuccess: ({ blob, disposition, renderedRevision }, {
      targetQuotationId,
      expectedRevision,
      displayName,
    }) => {
      if (
        !isCurrentTarget(targetQuotationId, expectedRevision)
        || revisionNumber(renderedRevision) !== revisionNumber(expectedRevision)
      ) {
        rejectStalePdf(targetQuotationId);
        return;
      }
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      const objectUrl = URL.createObjectURL(blob);
      previewUrlRef.current = objectUrl;
      previewRevisionRef.current = expectedRevision;
      setPreviewUrl(objectUrl);
      setPreviewFilename(safeFilename(disposition, `Suvi-Interior-${displayName}.pdf`));
      setPreviewOpen(true);
    },
    onError: (error, { targetQuotationId, expectedRevision }) => {
      if (handleStructuredConflict(error, "The quotation PDF preview could not be generated from the reviewed revision.", targetQuotationId)) return;
      if (!isCurrentTarget(targetQuotationId, expectedRevision)) {
        rejectStalePdf(targetQuotationId);
        return;
      }
      reportMutationError(error, "The quotation PDF preview could not be loaded.", targetQuotationId);
    },
  });

  function downloadCurrentPreview() {
    if (!previewUrl) return;
    const anchor = document.createElement("a");
    anchor.href = previewUrl;
    anchor.download = previewFilename || "Suvi-Interior-Quotation-Draft.pdf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    toast.success("The reviewed quotation PDF was downloaded.");
  }

  function closePdfPreview() {
    setPreviewOpen(false);
    setPreviewUrl("");
    setPreviewFilename("");
    previewRevisionRef.current = null;
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = "";
    }
  }

  async function openStatusReview(status) {
    if (mutationBusy || pdfBusy || statusGuardPending) return;
    const targetQuotationId = quotation.id;
    setStatusGuardPending(true);
    statusMutation.reset();
    clearCurrentActionError(targetQuotationId);
    try {
      const [latestQuotationResult, latestMetadataResult] = await Promise.all([
        quotationQuery.refetch({ throwOnError: true }),
        metadataQuery.refetch({ throwOnError: true }),
      ]);
      if (!isCurrentTarget(targetQuotationId)) return;
      const latestQuotation = latestQuotationResult.data;
      const latestBusinessDate = latestMetadataResult.data?.business_date || "";
      const latestSendPending = latestQuotation?.status === "sent"
        && (latestQuotation.send_pending || !latestQuotation.quotation_number);
      if (!latestQuotation || latestQuotation.status !== "sent" || latestSendPending) {
        setStatusReview(null);
        setReviewWarning("The quotation changed while this action was being prepared. Review its latest lifecycle state before continuing.");
        toast.warning("The quotation status changed. Review the refreshed document.");
        return;
      }
      if (!latestBusinessDate) {
        setStatusReview(null);
        setReviewWarning("The current business date could not be confirmed. Retry after metadata is available before changing quotation status.");
        toast.warning("The business date could not be confirmed.");
        return;
      }
      const elapsed = quotationValidityElapsed(latestQuotation, latestBusinessDate);
      if (["accepted", "declined"].includes(status) && elapsed) {
        setStatusReview(null);
        setReviewWarning("This quotation has passed its validity date. Mark it expired or duplicate it to prepare a revised proposal.");
        toast.warning("An elapsed quotation cannot be accepted or declined.");
        return;
      }
      if (status === "expired" && !elapsed) {
        setStatusReview(null);
        setReviewWarning(`This quotation remains valid through ${formatDate(latestQuotation.valid_until)} and cannot be marked expired yet.`);
        toast.warning("This quotation is still within its validity period.");
        return;
      }
      setReviewWarning("");
      setStatusReview({
        targetQuotationId: latestQuotation.id,
        expectedRevision: latestQuotation.revision,
        status,
      });
    } catch (error) {
      if (!isCurrentTarget(targetQuotationId)) return;
      const normalized = apiError(error, "The latest quotation state could not be confirmed.");
      setStatusReview(null);
      setReviewWarning(`${normalized.message} Retry before changing the quotation status.`);
      toast.error(normalized.message);
    } finally {
      if (isCurrentTarget(targetQuotationId)) setStatusGuardPending(false);
    }
  }

  function openConversionDialog() {
    convertMutation.reset();
    setConversionErrors({});
    setConversionForm({ invoice_date: metadataQuery.data?.business_date || "", due_date: "" });
    setConvertReview({
      targetQuotationId: quotation.id,
      expectedRevision: quotation.revision,
    });
  }

  function updateConversionForm(event) {
    const { name, value } = event.target;
    setConversionForm((current) => ({ ...current, [name]: value }));
    setConversionErrors((current) => ({ ...current, [name]: "" }));
  }

  function submitConversion(event) {
    event.preventDefault();
    if (!convertReview) return;
    const errors = {};
    if (!conversionForm.invoice_date) errors.invoice_date = "Invoice date is required.";
    if (conversionForm.invoice_date && conversionForm.due_date && conversionForm.due_date < conversionForm.invoice_date) {
      errors.due_date = "Due date cannot be earlier than the invoice date.";
    }
    setConversionErrors(errors);
    if (Object.keys(errors).length) {
      window.requestAnimationFrame(() => document.querySelector(".admin-conversion-dialog [aria-invalid='true']")?.focus());
      return;
    }
    convertMutation.mutate({
      ...convertReview,
      invoiceDate: conversionForm.invoice_date,
      dueDate: conversionForm.due_date,
    });
  }

  if (quotationQuery.isPending && !quotation) {
    return (
      <div className="admin-page admin-invoice-detail-page admin-quotation-detail-page">
        <PageHeader eyebrow="Quotation register" title="Quotation detail" description="Loading the saved proposal snapshot." />
        <LoadingState label="Loading quotation…" />
      </div>
    );
  }

  if (!quotation) {
    return (
      <div className="admin-page admin-invoice-detail-page admin-quotation-detail-page">
        <PageHeader eyebrow="Quotation register" title="Quotation unavailable" actions={<Link className="admin-button admin-button--outline" to="/admin/quotations"><ArrowLeft aria-hidden="true" /> Back to quotations</Link>} />
        <ErrorState error={quotationQuery.error} onRetry={() => quotationQuery.refetch()} title="We couldn't load this quotation" />
      </div>
    );
  }

  const totals = quotation.totals || {};
  const supplier = quotation.supplier_snapshot || quotation.business_snapshot || {};
  const customer = quotation.customer_snapshot || quotation.draft_input?.customer_snapshot || {};
  const isDraft = quotation.status === "draft";
  const isSent = quotation.status === "sent";
  const sendPending = isSent && (quotation.send_pending || !quotation.quotation_number);
  const actionableSent = isSent && !sendPending;
  const isAccepted = quotation.status === "accepted";
  const isConverted = quotation.status === "converted";
  const currentBusinessDate = metadataQuery.data?.business_date || "";
  const validityElapsed = quotationValidityElapsed(quotation, currentBusinessDate);
  const invoiceId = convertedInvoiceId(quotation);
  const mutationBusy = sendMutation.isPending
    || statusMutation.isPending
    || duplicateMutation.isPending
    || deleteMutation.isPending
    || convertMutation.isPending;
  const pdfBusy = downloadPdfMutation.isPending || previewPdfMutation.isPending;
  const actionBusy = mutationBusy || pdfBusy || statusGuardPending;

  return (
    <div className="admin-page admin-invoice-detail-page admin-quotation-detail-page">
      <Link className="admin-back-link" to="/admin/quotations"><ArrowLeft aria-hidden="true" /> Back to quotation register</Link>
      <PageHeader
        eyebrow="Quotation document"
        title={sendPending ? "Quotation number pending" : quotationName(quotation)}
        description={isDraft
          ? "Review the saved draft. Its number and sent snapshot have not been allocated or frozen yet."
          : sendPending
            ? "The quotation snapshot is frozen, but its send operation still needs to finish numbering."
            : "Review the stored customer proposal, lifecycle status, and backend-authoritative calculation."}
        actions={(
          <div className="admin-page-actions">
            {isDraft ? <Link className="admin-button admin-button--outline" to={`/admin/quotations/${quotation.id}/edit`}><FilePenLine aria-hidden="true" /> Edit draft</Link> : null}
            {isDraft || sendPending ? (
              <button className="admin-button admin-button--primary" type="button" onClick={() => {
                sendMutation.reset();
                const request = { targetQuotationId: quotation.id, expectedRevision: quotation.revision };
                if (sendPending) sendMutation.mutate(request);
                else setSendReview(request);
              }} disabled={actionBusy}>
                {sendMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <Send aria-hidden="true" />} {sendPending ? "Resume send" : "Send quotation"}
              </button>
            ) : null}
            {actionableSent && !validityElapsed ? <button className="admin-button admin-button--primary" type="button" onClick={() => openStatusReview("accepted")} disabled={actionBusy}><CheckCircle2 aria-hidden="true" /> Accept</button> : null}
            {actionableSent && !validityElapsed ? <button className="admin-button admin-button--danger" type="button" onClick={() => openStatusReview("declined")} disabled={actionBusy}><XCircle aria-hidden="true" /> Decline</button> : null}
            {actionableSent && validityElapsed ? <button className="admin-button admin-button--outline" type="button" onClick={() => openStatusReview("expired")} disabled={actionBusy}><Clock3 aria-hidden="true" /> Mark expired</button> : null}
            {isAccepted ? <button className="admin-button admin-button--primary" type="button" onClick={openConversionDialog} disabled={actionBusy || metadataQuery.isPending}><FileText aria-hidden="true" /> Convert to invoice draft</button> : null}
            <button className="admin-button admin-button--outline" type="button" onClick={() => {
              duplicateMutation.reset();
              setDuplicateReview({ targetQuotationId: quotation.id, expectedRevision: quotation.revision });
            }} disabled={actionBusy || sendPending}><Copy aria-hidden="true" /> Duplicate</button>
            <button className="admin-button admin-button--outline" type="button" onClick={() => previewPdfMutation.mutate({ targetQuotationId: quotation.id, expectedRevision: quotation.revision, displayName: quotationName(quotation) })} disabled={actionBusy}><Eye aria-hidden="true" /> Preview PDF</button>
            <button className="admin-button admin-button--outline" type="button" onClick={() => downloadPdfMutation.mutate({ targetQuotationId: quotation.id, expectedRevision: quotation.revision, displayName: quotationName(quotation) })} disabled={actionBusy}><Download aria-hidden="true" /> Download PDF</button>
            {isDraft ? <button className="admin-button admin-button--danger" type="button" onClick={() => {
              deleteMutation.reset();
              setDeleteReview({ targetQuotationId: quotation.id, expectedRevision: quotation.revision });
            }} disabled={actionBusy}><Trash2 aria-hidden="true" /> Delete draft</button> : null}
          </div>
        )}
      />

      {reviewWarning ? (
        <InlineNotice tone="warning" title="Quotation changed — review required">
          <div className="admin-refresh-warning__content"><p>{reviewWarning}</p><button className="admin-button admin-button--ghost" type="button" onClick={() => setReviewWarning("")}>Dismiss</button></div>
        </InlineNotice>
      ) : null}
      {latestActionError ? <div className="admin-action-error"><ValidationSummary error={latestActionError} /><button className="admin-button admin-button--ghost" type="button" onClick={() => setLatestActionError(null)}>Dismiss</button></div> : null}
      {quotationQuery.isError ? (
        <InlineNotice tone="warning" title="The latest refresh failed">
          <div className="admin-refresh-warning__content"><p>The retained quotation is still shown. Retry to confirm the latest server state.</p><button className="admin-button admin-button--outline" type="button" onClick={() => quotationQuery.refetch()} disabled={quotationQuery.isFetching}>Retry refresh</button></div>
        </InlineNotice>
      ) : null}
      {sendPending ? <InlineNotice tone="warning" title="Quotation send needs to resume">The customer and financial snapshot is frozen, but numbering did not finish. Use Resume send to safely complete the same numbering operation.</InlineNotice> : null}
      {!isDraft && !sendPending ? <InlineNotice tone="info" title="Sent values are frozen">The numbered customer snapshot and calculation cannot be edited. Duplicate this quotation to create a new draft.</InlineNotice> : null}
      {actionableSent && !validityElapsed ? <InlineNotice tone="info" title={`Valid through ${formatDate(quotation.valid_until)}`}>Expiry can be recorded only after the validity date has elapsed.</InlineNotice> : null}
      {quotation.status === "declined" ? <InlineNotice tone="warning" title="Quotation declined">The proposal remains available for audit and duplication; it is not invoice revenue.</InlineNotice> : null}
      {quotation.status === "expired" ? <InlineNotice tone="warning" title="Quotation expired">The proposal's validity has elapsed. Duplicate it to prepare a revised quotation.</InlineNotice> : null}
      {isConverted ? (
        <InlineNotice tone="success" title="Converted to an invoice draft">
          {invoiceId ? <p>This quotation is linked to <Link className="admin-link" to={`/admin/invoices/${invoiceId}`}>its invoice draft</Link>.</p> : <p>The conversion is recorded. Refresh if the linked invoice identifier is not yet visible.</p>}
        </InlineNotice>
      ) : null}

      <article className="admin-invoice-document admin-quotation-document" aria-label={`${quotationName(quotation)} quotation detail`}>
        <header className="admin-invoice-document__masthead">
          <div className="admin-invoice-document__supplier-mark"><span>{supplier.trade_name || supplier.display_name || "Suvi Interior"}</span>{supplier.legal_name ? <small>{supplier.legal_name}</small> : null}</div>
          <div className="admin-invoice-document__identity"><StatusBadge status={quotation.status} /><p>QUOTATION</p><h2>{quotation.quotation_number || "NUMBER PENDING"}</h2><code>{quotation.id}</code></div>
        </header>
        <dl className="admin-invoice-document__facts">
          <Fact label="Quotation date">{formatDate(quotation.quotation_date)}</Fact>
          <Fact label="Valid until">{formatDate(quotation.valid_until)}</Fact>
          <Fact label="Project reference">{quotation.project_reference || "—"}</Fact>
          <Fact label="PO reference">{quotation.po_reference || "—"}</Fact>
          <Fact label="Sent">{formatDateTime(quotation.sent_at)}</Fact>
          <Fact label="Revision">{quotation.revision ?? "—"}</Fact>
        </dl>

        <section className="admin-invoice-document__section" aria-labelledby="quotation-parties-heading">
          <div className="admin-invoice-document__section-heading"><div><p className="admin-eyebrow">Document parties</p><h2 id="quotation-parties-heading">Supplier, customer, and delivery</h2></div><span>{isDraft ? "Saved draft snapshot" : "Frozen at send"}</span></div>
          <div className="admin-document-parties">
            <PartyPanel eyebrow="Supplier" party={supplier} address={supplier.address} note={titleCase(supplier.gst_registration_mode, "Registration not recorded")} />
            <PartyPanel eyebrow="Prepared for" party={customer} address={customer.billing_address} note={titleCase(customer.customer_type, "Customer")} />
            <PartyPanel eyebrow="Deliver to" party={customer} address={customer.shipping_same_as_billing ? customer.billing_address : customer.shipping_address} note={customer.shipping_same_as_billing ? "Same as billing address" : "Separate delivery address"} />
          </div>
        </section>

        <section className="admin-invoice-document__section" aria-labelledby="quotation-tax-heading">
          <div className="admin-invoice-document__section-heading"><div><p className="admin-eyebrow">Tax treatment</p><h2 id="quotation-tax-heading">GST regime and place of supply</h2></div></div>
          <dl className="admin-tax-facts">
            <Fact label="GST regime">{taxRegimeLabel(quotation.tax_regime)}</Fact>
            <Fact label="Place of supply">{quotation.place_of_supply?.state ? `${quotation.place_of_supply.state} (${quotation.place_of_supply.state_code})` : "—"}</Fact>
            <Fact label="Reverse charge">{quotation.reverse_charge ? "Yes" : "No"}</Fact>
            <Fact label="Tax mode">{quotation.tax_mode === "no_tax" ? "No tax" : "Automatic GST"}</Fact>
            <Fact label="Supplier registration">{titleCase(supplier.gst_registration_mode)}</Fact>
            <Fact label="Snapshot state">{isDraft ? "Saved draft" : "Frozen at send"}</Fact>
          </dl>
        </section>

        <section className="admin-invoice-document__section" aria-labelledby="quotation-lines-heading">
          <div className="admin-invoice-document__section-heading"><div><p className="admin-eyebrow">Calculation</p><h2 id="quotation-lines-heading">Quoted goods and services</h2></div><span>{quotation.lines?.length || 0} {(quotation.lines?.length || 0) === 1 ? "line" : "lines"}</span></div>
          <div className="admin-table-shell admin-invoice-lines-shell">
            <table className="admin-table admin-invoice-lines">
              <caption className="admin-table__caption">Complete quotation line calculation</caption>
              <thead><tr><th scope="col"># / item</th><th scope="col">HSN/SAC</th><th scope="col">Qty / unit</th><th scope="col">Rate</th><th scope="col">Gross</th><th scope="col">Discount</th><th scope="col">Taxable</th><th scope="col">GST</th><th scope="col">Quoted line total</th></tr></thead>
              <tbody>
                {(quotation.lines || []).map((line, index) => (
                  <tr key={line.id || index}>
                    <td data-label="# / item"><span className="admin-line-number">{index + 1}</span><strong>{line.name || "Unnamed item"}</strong><small>{titleCase(line.item_type)}</small>{line.description ? <p>{line.description}</p> : null}</td>
                    <td data-label="HSN/SAC">{line.hsn_sac || "—"}</td>
                    <td data-label="Qty / unit"><strong>{line.quantity}</strong><small>{line.unit || "—"}</small></td>
                    <td data-label="Rate">{money(line, "unit_rate")}</td>
                    <td data-label="Gross">{money(line, "gross")}</td>
                    <td data-label="Discount"><span>{money(line, "discount")}</span>{line.discount_type !== "none" ? <small>{titleCase(line.discount_type)} · {line.discount_value}</small> : <small>None</small>}</td>
                    <td data-label="Taxable">{money(line, "taxable")}</td>
                    <td data-label="GST"><span className="admin-line-tax__rate">{line.gst_rate || "0"}% · {money(line, "tax")}</span>{quotation.tax_regime === "intra_state" ? <small>CGST {line.cgst_rate}% {money(line, "cgst")} · SGST {line.sgst_rate}% {money(line, "sgst")}</small> : null}{quotation.tax_regime === "inter_state" ? <small>IGST {line.igst_rate}% {money(line, "igst")}</small> : null}{quotation.tax_regime === "no_tax" ? <small>No tax applied</small> : null}</td>
                    <td data-label="Quoted line total"><strong>{money(line, "line_total")}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-invoice-totals-layout">
            <div className="admin-invoice-totals-layout__note"><FileSignature aria-hidden="true" /><div><strong>Quoted value, not revenue</strong><p>This proposal is calculated in INR from the stored quotation snapshot. It is not included in invoice revenue, receivables, or ageing.</p></div></div>
            <dl className="admin-invoice-totals">
              <TotalRow label="Gross subtotal" value={money(totals, "subtotal")} />
              <TotalRow label="Discount" value={money(totals, "discount")} />
              <TotalRow label="Taxable amount" value={money(totals, "taxable")} />
              <TotalRow label="CGST" value={money(totals, "cgst")} />
              <TotalRow label="SGST" value={money(totals, "sgst")} />
              <TotalRow label="IGST" value={money(totals, "igst")} />
              <TotalRow label="Total GST" value={money(totals, "total_tax")} />
              <TotalRow label={quotation.post_tax_adjustment_label || "Post-tax adjustment"} value={money(totals, "post_tax_adjustment")} />
              <TotalRow label="Round off" value={money(totals, "round_off")} />
              <TotalRow label="Quoted total" value={money(totals, "grand_total")} emphasis />
            </dl>
          </div>
        </section>

        <section className="admin-invoice-document__section" aria-labelledby="quotation-copy-heading">
          <div className="admin-invoice-document__section-heading"><div><p className="admin-eyebrow">Proposal copy</p><h2 id="quotation-copy-heading">Notes and terms</h2></div></div>
          <div className="admin-document-copy-grid"><div className="admin-document-copy"><h3>Notes</h3><p>{quotation.notes || "No notes recorded."}</p></div><div className="admin-document-copy"><h3>Terms</h3><p>{quotation.terms || "No terms recorded."}</p></div></div>
        </section>
      </article>

      <SectionCard className="admin-audit-card" title="Quotation audit" description="Lifecycle timestamps, status, and current document revision.">
        <dl className="admin-audit-grid">
          <Fact label="Created">{formatDateTime(quotation.created_at)}</Fact>
          <Fact label="Created by">{quotation.created_by || "—"}</Fact>
          <Fact label="Last updated">{formatDateTime(quotation.updated_at)}</Fact>
          <Fact label="Updated by">{quotation.updated_by || "—"}</Fact>
          <Fact label="Sent">{formatDateTime(quotation.sent_at)}</Fact>
          <Fact label="Sent by">{quotation.sent_by || "—"}</Fact>
          <Fact label="Accepted">{formatDateTime(quotation.accepted_at)}</Fact>
          <Fact label="Declined">{formatDateTime(quotation.declined_at)}</Fact>
          <Fact label="Expired">{formatDateTime(quotation.expired_at)}</Fact>
          <Fact label="Converted">{formatDateTime(quotation.converted_at)}</Fact>
          <Fact label="Revision">{quotation.revision ?? "—"}</Fact>
          <Fact label="Schema version">{quotation.schema_version ?? "—"}</Fact>
          <Fact label="Document ID"><code className="admin-code-wrap">{quotation.id}</code></Fact>
          <Fact label="Linked invoice">{invoiceId ? <Link className="admin-link" to={`/admin/invoices/${invoiceId}`}>{invoiceId}</Link> : "—"}</Fact>
        </dl>
      </SectionCard>

      <ConfirmDialog
        open={Boolean(sendReview)}
        onOpenChange={(open) => { if (!open && !sendMutation.isPending) setSendReview(null); }}
        title="Send this quotation?"
        description="Sending allocates the next quotation number and freezes the customer snapshot and calculated values. The backend recalculates against the captured draft revision and current business settings. If recalculation changes anything, sending stops, the refreshed quotation is shown, and you must review it and click Send quotation again."
        confirmLabel="Send quotation"
        tone="primary"
        busy={sendMutation.isPending}
        onConfirm={() => { if (sendReview) sendMutation.mutate(sendReview); }}
      />

      <ConfirmDialog
        open={Boolean(statusReview)}
        onOpenChange={(open) => { if (!open && !statusMutation.isPending) setStatusReview(null); }}
        title={statusReview ? STATUS_CONFIRMATIONS[statusReview.status]?.title : "Change quotation status?"}
        description={statusReview ? STATUS_CONFIRMATIONS[statusReview.status]?.description : "Confirm the quotation status change."}
        confirmLabel={statusReview ? STATUS_CONFIRMATIONS[statusReview.status]?.confirmLabel : "Confirm"}
        tone={statusReview ? STATUS_CONFIRMATIONS[statusReview.status]?.tone : "primary"}
        busy={statusMutation.isPending}
        onConfirm={() => { if (statusReview) statusMutation.mutate(statusReview); }}
      />

      <ConfirmDialog
        open={Boolean(duplicateReview)}
        onOpenChange={(open) => { if (!open && !duplicateMutation.isPending) setDuplicateReview(null); }}
        title="Duplicate this quotation?"
        description="A new editable draft will be created from this exact stored snapshot. No new validity duration or date will be invented."
        confirmLabel="Create duplicate"
        tone="primary"
        busy={duplicateMutation.isPending}
        onConfirm={() => { if (duplicateReview) duplicateMutation.mutate(duplicateReview); }}
      />

      <ConfirmDialog
        open={Boolean(deleteReview)}
        onOpenChange={(open) => { if (!open && !deleteMutation.isPending) setDeleteReview(null); }}
        title="Delete this quotation draft?"
        description="This removes the unnumbered draft from the quotation register. This action cannot be undone."
        confirmLabel="Delete draft"
        tone="danger"
        busy={deleteMutation.isPending}
        onConfirm={() => { if (deleteReview) deleteMutation.mutate(deleteReview); }}
      />

      <Dialog open={Boolean(convertReview)} onOpenChange={(open) => { if (!open && !convertMutation.isPending) setConvertReview(null); }}>
        <DialogContent className="admin-dialog admin-dialog--small admin-conversion-dialog">
          <DialogHeader>
            <DialogTitle>Convert accepted quotation</DialogTitle>
            <DialogDescription>Create an invoice draft from this frozen quotation. Only the invoice date is required; the due date is optional. Conversion does not issue the invoice.</DialogDescription>
          </DialogHeader>
          <InlineNotice tone="info" title="Due date is optional">Invoice date uses the current business date when available. Due date starts blank and can reflect an agreed payment term when needed.</InlineNotice>
          {metadataQuery.isError ? <InlineNotice tone="warning" title="Business date unavailable">The date could not be prefilled. Enter the required invoice date; the due date can remain blank. The backend remains authoritative.</InlineNotice> : null}
          <form className="admin-dialog-form" onSubmit={submitConversion} noValidate>
            <div className="admin-dialog-form__grid">
              <Field label="Invoice date" required error={conversionErrors.invoice_date}>
                <input name="invoice_date" type="date" value={conversionForm.invoice_date} onChange={updateConversionForm} aria-invalid={Boolean(conversionErrors.invoice_date)} autoFocus />
              </Field>
              <Field label="Due date" hint="Optional; add the agreed payment due date." error={conversionErrors.due_date}>
                <input name="due_date" type="date" min={conversionForm.invoice_date || undefined} value={conversionForm.due_date} onChange={updateConversionForm} aria-invalid={Boolean(conversionErrors.due_date)} />
              </Field>
            </div>
            <ValidationSummary error={convertMutation.error} />
            <DialogFooter className="admin-dialog__footer">
              <button className="admin-button admin-button--ghost" type="button" onClick={() => setConvertReview(null)} disabled={convertMutation.isPending}>Keep quotation</button>
              <button className="admin-button admin-button--primary" type="submit" disabled={convertMutation.isPending}>
                {convertMutation.isPending ? <LoaderCircle className="admin-spin" aria-hidden="true" /> : <FileText aria-hidden="true" />} Create invoice draft
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={(open) => { if (!open) closePdfPreview(); }}>
        <DialogContent className="admin-dialog admin-pdf-dialog">
          <DialogHeader><DialogTitle>Quotation PDF preview · {quotationName(quotation)}</DialogTitle><DialogDescription>This private preview is the exact generated file. Open it separately for a larger view or download this same snapshot.</DialogDescription></DialogHeader>
          <div className="admin-pdf-preview">{previewUrl ? <iframe className="admin-pdf-preview__frame" src={previewUrl} title={`PDF preview of ${quotationName(quotation)}`} /> : <LoadingState label="Preparing PDF preview…" />}</div>
          <DialogFooter className="admin-dialog__footer">
            <button className="admin-button admin-button--ghost" type="button" onClick={closePdfPreview}>Close preview</button>
            {previewUrl ? <a className="admin-button admin-button--outline" href={previewUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" /> Open separately</a> : null}
            <button className="admin-button admin-button--primary" type="button" onClick={downloadCurrentPreview} disabled={!previewUrl}><Download aria-hidden="true" /> Download this PDF</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
