import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Copy,
  FileSignature,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { adminApi, apiError, invalidateQuotationQueries } from "@/admin/api";
import {
  ErrorState,
  Field,
  InlineNotice,
  LoadingState,
  PageHeader,
  SectionCard,
  ValidationSummary,
  formatDate,
  useAdminTitle,
} from "@/admin/components/AdminUI";

const REQUIRED_ADDRESS_FIELDS = ["line1", "city", "state", "state_code", "pincode"];
const ADDRESS_LABELS = {
  line1: "address line 1",
  city: "city",
  state: "state",
  state_code: "state code",
  pincode: "PIN code",
};
const PERCENT_DENOMINATOR = 1_000_000n;
const MAX_MONEY_FOUR = 99_999_999_999_900n;
const MAX_MONEY_PAISE = 999_999_999_999n;
const MAX_QUANTITY_FOUR = 10_000_000_000n;
const MAX_GST_FOUR = 1_000_000n;
const CUSTOMER_TYPES = new Set(["business", "individual"]);
const ITEM_TYPES = new Set(["goods", "service"]);
const TAX_MODES = new Set(["auto", "no_tax"]);
const DISCOUNT_TYPES = new Set(["none", "percent", "fixed"]);
const CUSTOMER_QUERY = { active: true, page: 1, page_size: 200 };
const CATALOGUE_QUERY = { active: true, page: 1, page_size: 200 };
const UNSAVED_QUOTATION_MESSAGE = "Discard the unsaved quotation changes? Your edits will be lost.";
let localLineSequence = 0;

function nextLineKey() {
  localLineSequence += 1;
  return `admin-quotation-line-${localLineSequence}`;
}

function asText(value, fallback = "") {
  return value === null || value === undefined ? fallback : String(value);
}

function blankAddress(country = "") {
  return {
    line1: "",
    line2: "",
    line3: "",
    city: "",
    state: "",
    state_code: "",
    pincode: "",
    country,
  };
}

function addressFrom(source) {
  const value = source || {};
  return {
    line1: asText(value.line1),
    line2: asText(value.line2),
    line3: asText(value.line3),
    city: asText(value.city),
    state: asText(value.state),
    state_code: asText(value.state_code),
    pincode: asText(value.pincode),
    country: asText(value.country),
  };
}

function blankCustomer() {
  return {
    customer_id: null,
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
    shipping_address: null,
  };
}

function customerSnapshotFrom(source, fallbackId = null) {
  const value = source || {};
  const sameAsBilling = value.shipping_same_as_billing !== false;
  return {
    customer_id: asText(value.customer_id || value.id || fallbackId).trim() || null,
    customer_type: CUSTOMER_TYPES.has(value.customer_type) ? value.customer_type : "",
    legal_name: asText(value.legal_name),
    display_name: asText(value.display_name),
    gstin: asText(value.gstin),
    pan: asText(value.pan),
    contact_person: asText(value.contact_person),
    phone: asText(value.phone),
    email: asText(value.email),
    billing_address: addressFrom(value.billing_address),
    shipping_same_as_billing: sameAsBilling,
    shipping_address: sameAsBilling ? null : addressFrom(value.shipping_address),
  };
}

function blankLine() {
  return {
    local_key: nextLineKey(),
    item_id: null,
    item_type: "",
    name: "",
    description: "",
    hsn_sac: "",
    unit: "NOS",
    quantity: "1",
    unit_rate: "",
    discount_type: "none",
    discount_value: "0",
    gst_rate: "",
  };
}

function lineFromResponse(source) {
  const value = source || {};
  return {
    local_key: nextLineKey(),
    item_id: asText(value.item_id).trim() || null,
    item_type: ITEM_TYPES.has(value.item_type) ? value.item_type : "",
    name: asText(value.name),
    description: asText(value.description),
    hsn_sac: asText(value.hsn_sac),
    unit: asText(value.unit, "NOS"),
    quantity: asText(value.quantity, "1"),
    unit_rate: asText(value.unit_rate),
    discount_type: DISCOUNT_TYPES.has(value.discount_type) ? value.discount_type : "",
    discount_value: asText(value.discount_value, "0"),
    gst_rate: Object.prototype.hasOwnProperty.call(value, "input_gst_rate")
      ? asText(value.input_gst_rate)
      : asText(value.gst_rate),
  };
}

function catalogueSnapshot(item, currentLine) {
  return {
    local_key: currentLine.local_key,
    item_id: asText(item.id).trim() || null,
    item_type: ITEM_TYPES.has(item.item_type) ? item.item_type : "",
    name: asText(item.name),
    description: asText(item.description),
    hsn_sac: asText(item.hsn_sac),
    unit: asText(item.unit, "NOS"),
    quantity: currentLine.quantity || "1",
    unit_rate: asText(item.rate ?? item.rate_display),
    discount_type: currentLine.discount_type,
    discount_value: currentLine.discount_type === "none" ? "0" : currentLine.discount_value,
    gst_rate: asText(item.gst_rate),
  };
}

function initialDraft(settings, selectedCustomer, businessDate) {
  return {
    customer_snapshot: selectedCustomer ? customerSnapshotFrom(selectedCustomer) : blankCustomer(),
    quotation_date: businessDate || "",
    valid_until: "",
    place_of_supply: { state: "", state_code: "" },
    lines: [blankLine()],
    project_reference: "",
    po_reference: "",
    reverse_charge: false,
    tax_mode: "auto",
    notes: asText(settings?.default_notes),
    terms: asText(settings?.default_terms),
    post_tax_adjustment_label: "",
    post_tax_adjustment_amount: "0",
  };
}

function adjustmentFromQuotation(quotation, input) {
  if (Object.prototype.hasOwnProperty.call(input || {}, "post_tax_adjustment_amount")) {
    return asText(input.post_tax_adjustment_amount, "0");
  }
  const display = quotation?.totals?.post_tax_adjustment_display;
  if (display !== null && display !== undefined) return asText(display);
  const paise = quotation?.totals?.post_tax_adjustment_paise;
  if (Number.isInteger(paise)) {
    const sign = paise < 0 ? "-" : "";
    const absolute = Math.abs(paise);
    return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
  }
  return "0";
}

function draftFromQuotation(quotation) {
  const input = quotation?.draft_input || {};
  const snapshot = input.customer_snapshot || quotation?.customer_snapshot || {};
  const responseLines = Array.isArray(input.lines)
    ? input.lines
    : Array.isArray(quotation?.lines)
      ? quotation.lines
      : [];
  const placeOfSupply = input.place_of_supply || quotation?.place_of_supply || {};
  return {
    customer_snapshot: customerSnapshotFrom(snapshot, quotation?.customer_id),
    quotation_date: asText(input.quotation_date ?? quotation?.quotation_date),
    valid_until: asText(input.valid_until ?? quotation?.valid_until),
    place_of_supply: {
      state: asText(placeOfSupply.state),
      state_code: asText(placeOfSupply.state_code),
    },
    lines: responseLines.length ? responseLines.map(lineFromResponse) : [blankLine()],
    project_reference: asText(input.project_reference ?? quotation?.project_reference),
    po_reference: asText(input.po_reference ?? quotation?.po_reference),
    reverse_charge: Boolean(input.reverse_charge ?? quotation?.reverse_charge),
    tax_mode: TAX_MODES.has(input.tax_mode ?? quotation?.tax_mode)
      ? (input.tax_mode ?? quotation.tax_mode)
      : "",
    notes: asText(input.notes ?? quotation?.notes),
    terms: asText(input.terms ?? quotation?.terms),
    post_tax_adjustment_label: asText(
      input.post_tax_adjustment_label ?? quotation?.post_tax_adjustment_label,
    ),
    post_tax_adjustment_amount: adjustmentFromQuotation(quotation, input),
  };
}

function parseScaled(value, decimalPlaces) {
  const source = asText(value).trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(source);
  if (!match || (match[3] || "").length > decimalPlaces) return null;
  const fraction = (match[3] || "").padEnd(decimalPlaces, "0");
  const scale = 10n ** BigInt(decimalPlaces);
  const magnitude = (BigInt(match[2]) * scale) + BigInt(fraction || "0");
  return match[1] === "-" ? -magnitude : magnitude;
}

function roundHalfUp(numerator, denominator) {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  let result = absolute / denominator;
  if ((absolute % denominator) * 2n >= denominator) result += 1n;
  return negative ? -result : result;
}

function fourPlaceValueToPaise(value) {
  return roundHalfUp(value, 100n);
}

function groupIndianDigits(value) {
  if (value.length <= 3) return value;
  const lastThree = value.slice(-3);
  const leading = value.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${leading},${lastThree}`;
}

function formatPaise(value) {
  if (typeof value !== "bigint") return "—";
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const rupees = groupIndianDigits((absolute / 100n).toString());
  const paise = (absolute % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}₹${rupees}.${paise}`;
}

function estimateQuotation(form, settings) {
  const registrationMode = settings?.gst_registration_mode || "not_configured";
  const taxEnabled = registrationMode === "regular" && form.tax_mode === "auto";
  const supplierStateCode = asText(settings?.address?.state_code);
  const supplyStateCode = asText(form.place_of_supply?.state_code);
  let taxRegime = "no_tax";
  if (taxEnabled) {
    taxRegime = !supplierStateCode || !supplyStateCode
      ? "pending"
      : supplierStateCode === supplyStateCode
        ? "intra_state"
        : "inter_state";
  }

  let subtotalPaise = 0n;
  let discountPaise = 0n;
  let taxablePaise = 0n;
  let cgstPaise = 0n;
  let sgstPaise = 0n;
  let igstPaise = 0n;
  let pendingTaxPaise = 0n;
  let incompleteCount = 0;

  const lines = form.lines.map((line) => {
    const quantity = parseScaled(line.quantity, 4);
    const rate = parseScaled(line.unit_rate, 4);
    const gstRate = parseScaled(line.gst_rate, 4);
    let error = "";
    let gross = 0n;
    let discount = 0n;
    let taxable = 0n;
    let tax = 0n;
    let cgst = 0n;
    let sgst = 0n;
    let igst = 0n;

    if (quantity === null || quantity <= 0n || rate === null || rate < 0n) {
      error = "Enter a valid quantity and rate to estimate this line.";
    } else {
      gross = roundHalfUp(quantity * rate, 1_000_000n);
      if (line.discount_type === "percent") {
        const percent = parseScaled(line.discount_value, 4);
        if (percent === null || percent < 0n || percent > MAX_GST_FOUR) {
          error = "Enter a percentage from 0 to 100.";
        } else {
          discount = roundHalfUp(gross * percent, PERCENT_DENOMINATOR);
        }
      } else if (line.discount_type === "fixed") {
        const fixed = parseScaled(line.discount_value, 4);
        if (fixed === null || fixed < 0n) error = "Enter a valid fixed discount.";
        else discount = fourPlaceValueToPaise(fixed);
      }
      if (!error && discount > gross) error = "Discount cannot exceed this line's gross amount.";
      if (!error) {
        taxable = gross - discount;
        if (gstRate === null || gstRate < 0n || gstRate > MAX_GST_FOUR) {
          error = "Select or enter a GST rate from 0 to 100.";
        } else if (taxEnabled) {
          tax = roundHalfUp(taxable * gstRate, PERCENT_DENOMINATOR);
          if (taxRegime === "intra_state") {
            cgst = roundHalfUp(tax, 2n);
            sgst = tax - cgst;
          } else if (taxRegime === "inter_state") {
            igst = tax;
          }
        }
      }
    }

    if (error) incompleteCount += 1;
    subtotalPaise += gross;
    discountPaise += discount;
    taxablePaise += taxable;
    cgstPaise += cgst;
    sgstPaise += sgst;
    igstPaise += igst;
    if (taxEnabled && taxRegime === "pending") pendingTaxPaise += tax;

    return {
      local_key: line.local_key,
      gross_paise: gross,
      discount_paise: discount,
      taxable_paise: taxable,
      tax_paise: tax,
      cgst_paise: cgst,
      sgst_paise: sgst,
      igst_paise: igst,
      line_total_paise: taxable + tax,
      error,
    };
  });

  const totalTaxPaise = cgstPaise + sgstPaise + igstPaise + pendingTaxPaise;
  const adjustmentPaise = parseScaled(form.post_tax_adjustment_amount || "0", 2);
  const adjustmentInvalid = adjustmentPaise === null;
  const safeAdjustment = adjustmentInvalid ? 0n : adjustmentPaise;
  const beforeRoundingPaise = taxablePaise + totalTaxPaise + safeAdjustment;
  const negativeTotal = beforeRoundingPaise < 0n;
  let roundOffPaise = 0n;
  let grandTotalPaise = beforeRoundingPaise;
  if (settings?.round_to_rupee && !negativeTotal) {
    grandTotalPaise = roundHalfUp(beforeRoundingPaise, 100n) * 100n;
    roundOffPaise = grandTotalPaise - beforeRoundingPaise;
  }

  return {
    lines,
    registration_mode: registrationMode,
    tax_enabled: taxEnabled,
    tax_regime: taxRegime,
    incomplete_count: incompleteCount,
    adjustment_invalid: adjustmentInvalid,
    negative_total: negativeTotal,
    totals: {
      subtotal_paise: subtotalPaise,
      discount_paise: discountPaise,
      taxable_paise: taxablePaise,
      cgst_paise: cgstPaise,
      sgst_paise: sgstPaise,
      igst_paise: igstPaise,
      pending_tax_paise: pendingTaxPaise,
      total_tax_paise: totalTaxPaise,
      adjustment_paise: safeAdjustment,
      before_rounding_paise: beforeRoundingPaise,
      round_off_paise: roundOffPaise,
      grand_total_paise: grandTotalPaise,
    },
  };
}

function statePairIsValid(pair, states) {
  if (!pair?.state || !pair?.state_code) return false;
  return (states || []).some(
    (item) => item.code === pair.state_code
      && asText(item.name).toLocaleLowerCase() === asText(pair.state).toLocaleLowerCase(),
  );
}

function businessTaxConfigurationProblem(form, settings, states) {
  if (settings?.gst_registration_mode !== "regular" || form.tax_mode !== "auto") return "";
  if (!statePairIsValid(settings?.address, states)) {
    return "Configure a valid business state and state code in Business settings before saving an automatic-GST quotation draft.";
  }
  const gstin = asText(settings?.gstin).trim();
  if (gstin && gstin.slice(0, 2) !== settings.address.state_code) {
    return "The business GSTIN state code must match the business address before this automatic-GST quotation can be saved.";
  }
  return "";
}

function validateAddressState(address, states, path, errors) {
  if (!address) return;
  if (address.state || address.state_code) {
    if (!statePairIsValid(address, states)) errors[`${path}.state_code`] = "Select a valid Indian state or union territory.";
  }
}

function validateDraft(form, states, estimate) {
  const errors = {};
  const customer = form.customer_snapshot;
  if (!CUSTOMER_TYPES.has(customer.customer_type)) {
    errors["customer_snapshot.customer_type"] = "Choose a valid customer type.";
  }
  if (!customer.display_name.trim()) errors["customer_snapshot.display_name"] = "Customer display name is required.";
  if (!form.quotation_date) errors.quotation_date = "Quotation date is required.";
  if (!form.valid_until) errors.valid_until = "Valid until date is required.";
  if (form.quotation_date && form.valid_until && form.valid_until < form.quotation_date) {
    errors.valid_until = "Valid until cannot be earlier than the quotation date.";
  }
  if (!statePairIsValid(form.place_of_supply, states)) {
    errors["place_of_supply.state_code"] = "Select a valid place of supply.";
  }
  if (!TAX_MODES.has(form.tax_mode)) errors.tax_mode = "Choose a valid tax mode.";
  validateAddressState(customer.billing_address, states, "customer_snapshot.billing_address", errors);
  if (!customer.shipping_same_as_billing) {
    if (!customer.shipping_address) {
      errors["customer_snapshot.shipping_address.line1"] = "A shipping address is required.";
    } else {
      validateAddressState(customer.shipping_address, states, "customer_snapshot.shipping_address", errors);
    }
  }

  if (!form.lines.length) errors.lines = "Add at least one quotation line.";
  if (form.lines.length > 200) errors.lines = "A quotation can contain at most 200 lines.";
  form.lines.forEach((line, index) => {
    const base = `lines.${index}`;
    if (!ITEM_TYPES.has(line.item_type)) errors[`${base}.item_type`] = "Choose a valid line type.";
    if (!line.name.trim()) errors[`${base}.name`] = "Item or service name is required.";
    if (!line.unit.trim()) errors[`${base}.unit`] = "Unit is required.";
    if (line.hsn_sac.trim() && !/^[A-Za-z0-9]{2,16}$/.test(line.hsn_sac.replace(/\s/g, ""))) {
      errors[`${base}.hsn_sac`] = "Use 2–16 letters or digits.";
    }

    const quantity = parseScaled(line.quantity, 4);
    if (quantity === null || quantity <= 0n || quantity > MAX_QUANTITY_FOUR) {
      errors[`${base}.quantity`] = "Enter a quantity above 0 and up to 1,000,000 (4 decimals maximum).";
    }
    const rate = parseScaled(line.unit_rate, 4);
    if (rate === null || rate < 0n || rate > MAX_MONEY_FOUR) {
      errors[`${base}.unit_rate`] = "Enter a non-negative rate with up to 4 decimals.";
    }
    const gstRate = parseScaled(line.gst_rate, 4);
    if (gstRate === null || gstRate < 0n || gstRate > MAX_GST_FOUR) {
      errors[`${base}.gst_rate`] = "Enter a GST rate from 0 to 100 with up to 4 decimals.";
    }

    if (!DISCOUNT_TYPES.has(line.discount_type)) {
      errors[`${base}.discount_type`] = "Choose a valid discount type.";
    }
    const discount = parseScaled(line.discount_value, 4);
    if (line.discount_type === "none") {
      if (discount !== 0n) errors[`${base}.discount_value`] = "No discount must have a zero value.";
    } else if (discount === null || discount < 0n || discount > MAX_MONEY_FOUR) {
      errors[`${base}.discount_value`] = "Enter a non-negative discount with up to 4 decimals.";
    } else if (line.discount_type === "percent" && discount > MAX_GST_FOUR) {
      errors[`${base}.discount_value`] = "Percentage discount cannot exceed 100.";
    }
    if (estimate.lines[index]?.error?.startsWith("Discount cannot")) {
      errors[`${base}.discount_value`] = estimate.lines[index].error;
    }
  });

  const adjustment = parseScaled(form.post_tax_adjustment_amount || "0", 2);
  if (adjustment === null || adjustment > MAX_MONEY_PAISE || adjustment < -MAX_MONEY_PAISE) {
    errors.post_tax_adjustment_amount = "Enter an adjustment with up to 2 decimals within the supported amount range.";
  } else if (adjustment !== 0n && !form.post_tax_adjustment_label.trim()) {
    errors.post_tax_adjustment_label = "A label is required for a non-zero adjustment.";
  }
  if (estimate.negative_total) {
    errors.post_tax_adjustment_amount = "The adjustment cannot make the quotation total negative.";
  }
  return errors;
}

function addressPayload(address) {
  const value = address || blankAddress("");
  return {
    line1: value.line1.trim(),
    line2: value.line2.trim(),
    line3: value.line3.trim(),
    city: value.city.trim(),
    state: value.state.trim(),
    state_code: value.state_code.trim(),
    pincode: value.pincode.trim(),
    country: value.country.trim(),
  };
}

function buildPayload(form) {
  const customer = form.customer_snapshot;
  return {
    customer_snapshot: {
      customer_id: customer.customer_id?.trim() || null,
      customer_type: customer.customer_type,
      legal_name: customer.legal_name.trim(),
      display_name: customer.display_name.trim(),
      gstin: customer.gstin.trim().toUpperCase(),
      pan: customer.pan.trim().toUpperCase(),
      contact_person: customer.contact_person.trim(),
      phone: customer.phone.trim(),
      email: customer.email.trim().toLowerCase(),
      billing_address: addressPayload(customer.billing_address),
      shipping_same_as_billing: customer.shipping_same_as_billing,
      shipping_address: customer.shipping_same_as_billing ? null : addressPayload(customer.shipping_address),
    },
    quotation_date: form.quotation_date,
    valid_until: form.valid_until,
    place_of_supply: {
      state: form.place_of_supply.state.trim(),
      state_code: form.place_of_supply.state_code.trim(),
    },
    lines: form.lines.map((line) => ({
      item_id: line.item_id?.trim() || null,
      item_type: line.item_type,
      name: line.name.trim(),
      description: line.description.trim(),
      hsn_sac: line.hsn_sac.replace(/\s/g, "").toUpperCase(),
      unit: line.unit.trim().toUpperCase(),
      quantity: line.quantity.trim(),
      unit_rate: line.unit_rate.trim(),
      discount_type: line.discount_type,
      discount_value: line.discount_type === "none" ? "0" : line.discount_value.trim(),
      gst_rate: line.gst_rate.trim(),
    })),
    project_reference: form.project_reference.trim(),
    po_reference: form.po_reference.trim(),
    reverse_charge: form.reverse_charge,
    tax_mode: form.tax_mode,
    notes: form.notes.trim(),
    terms: form.terms.trim(),
    post_tax_adjustment_label: form.post_tax_adjustment_label.trim(),
    post_tax_adjustment_amount: (form.post_tax_adjustment_amount || "0").trim(),
  };
}

function missingAddressFields(address) {
  const value = address || {};
  return REQUIRED_ADDRESS_FIELDS.filter((field) => !asText(value[field]).trim());
}

function sendWarnings(form, settings, estimate) {
  const mode = settings?.gst_registration_mode;
  if (!["regular", "composition"].includes(mode)) return [];
  const warnings = [];
  if (!asText(settings?.gstin).trim()) warnings.push("Add the business GSTIN in settings before sending.");
  const supplierMissing = missingAddressFields(settings?.address);
  const supplierSendMissing = supplierMissing.filter(
    (field) => !(estimate.tax_enabled && ["state", "state_code"].includes(field)),
  );
  if (supplierSendMissing.length) {
    warnings.push(`Complete the business ${supplierSendMissing.map((field) => ADDRESS_LABELS[field]).join(", ")} before sending.`);
  }
  const hsnLines = form.lines
    .map((line, index) => (!line.hsn_sac.trim() ? index + 1 : null))
    .filter(Boolean);
  if (hsnLines.length) warnings.push(`Add HSN/SAC to line${hsnLines.length > 1 ? "s" : ""} ${hsnLines.join(", ")} before sending.`);

  const customer = form.customer_snapshot;
  const billingRequired = Boolean(customer.gstin.trim()) || estimate.totals.taxable_paise >= 5_000_000n;
  const billingMissing = billingRequired ? missingAddressFields(customer.billing_address) : [];
  if (billingMissing.length) {
    warnings.push(`Complete the customer billing ${billingMissing.map((field) => ADDRESS_LABELS[field]).join(", ")} before sending.`);
  }
  if (!customer.shipping_same_as_billing) {
    const shippingMissing = missingAddressFields(customer.shipping_address);
    if (shippingMissing.length) {
      warnings.push(`Complete the shipping ${shippingMissing.map((field) => ADDRESS_LABELS[field]).join(", ")} before sending.`);
    }
  }
  if (customer.gstin && customer.billing_address.state_code
      && customer.gstin.slice(0, 2) !== customer.billing_address.state_code) {
    warnings.push("Customer GSTIN state code does not match the billing state.");
  }
  return warnings;
}

function stateNameForCode(code, states) {
  return (states || []).find((state) => state.code === code)?.name || "";
}

function addressText(address) {
  const value = address || {};
  const locality = [value.city, value.state, value.pincode].filter(Boolean).join(" · ");
  return [value.line1, value.line2, value.line3, locality, value.country].filter(Boolean);
}

function AddressFields({ legend, address, path, states, errors, onFieldChange, onStateChange }) {
  return (
    <fieldset className="admin-address-fields">
      <legend className="admin-address-fields__legend">{legend}</legend>
      <div className="admin-form-grid admin-form-grid--two">
        <Field label="Address line 1" error={errors[`${path}.line1`]} className="admin-form-grid__wide">
          <input className="admin-input" value={address.line1} onChange={(event) => onFieldChange("line1", event.target.value)} aria-invalid={Boolean(errors[`${path}.line1`])} autoComplete="address-line1" />
        </Field>
        <Field label="Address line 2" error={errors[`${path}.line2`]} className="admin-form-grid__wide">
          <input className="admin-input" value={address.line2} onChange={(event) => onFieldChange("line2", event.target.value)} aria-invalid={Boolean(errors[`${path}.line2`])} autoComplete="address-line2" />
        </Field>
        <Field label="Address line 3" error={errors[`${path}.line3`]} className="admin-form-grid__wide">
          <input className="admin-input" value={address.line3} onChange={(event) => onFieldChange("line3", event.target.value)} aria-invalid={Boolean(errors[`${path}.line3`])} autoComplete="address-line3" />
        </Field>
        <Field label="City" error={errors[`${path}.city`]}>
          <input className="admin-input" value={address.city} onChange={(event) => onFieldChange("city", event.target.value)} aria-invalid={Boolean(errors[`${path}.city`])} autoComplete="address-level2" />
        </Field>
        <Field label="State / union territory" error={errors[`${path}.state_code`]}>
          <select className="admin-select" value={address.state_code} onChange={(event) => onStateChange(event.target.value)} aria-invalid={Boolean(errors[`${path}.state_code`])} autoComplete="address-level1">
            <option value="">Select state</option>
            {states.map((state) => <option key={state.code} value={state.code}>{state.code} · {state.name}</option>)}
          </select>
        </Field>
        <Field label="PIN code" error={errors[`${path}.pincode`]}>
          <input className="admin-input" value={address.pincode} onChange={(event) => onFieldChange("pincode", event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" maxLength={6} aria-invalid={Boolean(errors[`${path}.pincode`])} autoComplete="postal-code" />
        </Field>
        <Field label="Country" error={errors[`${path}.country`]}>
          <input className="admin-input" value={address.country} onChange={(event) => onFieldChange("country", event.target.value)} aria-invalid={Boolean(errors[`${path}.country`])} autoComplete="country-name" />
        </Field>
      </div>
    </fieldset>
  );
}

function TaxModeNotice({ mode, taxMode }) {
  if (mode === "regular" && taxMode === "auto") {
    return <InlineNotice tone="info" title="GST calculation enabled">The local estimate uses the business state and place of supply to split CGST/SGST or IGST.</InlineNotice>;
  }
  if (mode === "composition") {
    return <InlineNotice tone="warning" title="Composition taxpayer">GST is not charged in this quotation estimate.</InlineNotice>;
  }
  if (mode === "regular" && taxMode === "no_tax") {
    return <InlineNotice tone="warning" title="No-tax override">Entered GST rates do not affect quotation totals while no-tax mode is selected.</InlineNotice>;
  }
  return <InlineNotice tone="info" title="GST not applied">The business is not configured as a regular GST taxpayer, so entered GST rates do not affect totals.</InlineNotice>;
}

function LineEstimate({ estimate }) {
  return (
    <div className="admin-line-estimate" aria-live="polite">
      <div><span>Gross</span><strong>{formatPaise(estimate.gross_paise)}</strong></div>
      <div><span>Discount</span><strong>{formatPaise(estimate.discount_paise)}</strong></div>
      <div><span>Taxable</span><strong>{formatPaise(estimate.taxable_paise)}</strong></div>
      <div><span>GST</span><strong>{formatPaise(estimate.tax_paise)}</strong></div>
      <div className="admin-line-estimate__total"><span>Line estimate</span><strong>{formatPaise(estimate.line_total_paise)}</strong></div>
      {estimate.error ? <p className="admin-line-estimate__error"><TriangleAlert aria-hidden="true" />{estimate.error}</p> : null}
    </div>
  );
}

function taxRegimeLabel(estimate) {
  if (!estimate.tax_enabled) return "No GST applied";
  if (estimate.tax_regime === "intra_state") return "Intra-state · CGST + SGST";
  if (estimate.tax_regime === "inter_state") return "Inter-state · IGST";
  return "Select place of supply for GST split";
}

function QuotationDocumentPreview({ form, settings, estimate }) {
  const customer = form.customer_snapshot;
  const supplierAddress = addressText(settings?.address);
  const customerAddress = addressText(customer.billing_address);
  const distinctShipping = !customer.shipping_same_as_billing ? addressText(customer.shipping_address) : [];
  return (
    <aside className="admin-invoice-editor__preview" aria-label="Local quotation estimate preview">
      <div className="admin-invoice-preview__heading">
        <div><p className="admin-eyebrow">Local estimate</p><h2>Quotation preview</h2></div>
        <span className="admin-invoice-preview__draft">Draft</span>
      </div>
      <div className="admin-invoice-preview">
        <header className="admin-invoice-preview__masthead">
          <div>
            <strong>{settings?.trade_name || settings?.display_name || "Business"}</strong>
            {settings?.legal_name ? <p>{settings.legal_name}</p> : null}
            {supplierAddress.map((line) => <p key={line}>{line}</p>)}
            {settings?.gstin ? <p><b>GSTIN:</b> {settings.gstin}</p> : null}
          </div>
          <div className="admin-invoice-preview__title">
            <FileSignature aria-hidden="true" />
            <h3>QUOTATION</h3>
            <p>Number allocated on send</p>
          </div>
        </header>
        <div className="admin-invoice-preview__meta">
          <section>
            <span>Prepared for</span>
            <strong>{customer.display_name || "Customer not entered"}</strong>
            {customer.legal_name && customer.legal_name !== customer.display_name ? <p>{customer.legal_name}</p> : null}
            {customerAddress.map((line) => <p key={line}>{line}</p>)}
            {customer.gstin ? <p><b>GSTIN:</b> {customer.gstin}</p> : null}
          </section>
          {distinctShipping.length ? <section><span>Ship to</span>{distinctShipping.map((line) => <p key={line}>{line}</p>)}</section> : null}
          <section>
            <span>Quotation details</span>
            <p><b>Date:</b> {formatDate(form.quotation_date)}</p>
            <p><b>Valid until:</b> {formatDate(form.valid_until)}</p>
            <p><b>Place of supply:</b> {form.place_of_supply.state || "Not selected"}{form.place_of_supply.state_code ? ` (${form.place_of_supply.state_code})` : ""}</p>
            {form.project_reference ? <p><b>Project:</b> {form.project_reference}</p> : null}
            {form.po_reference ? <p><b>PO:</b> {form.po_reference}</p> : null}
          </section>
        </div>
        <div className="admin-invoice-preview__table-wrap">
          <table className="admin-invoice-preview__table">
            <caption className="admin-visually-hidden">Local quotation line estimate</caption>
            <thead><tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Rate</th><th scope="col">GST</th><th scope="col">Amount</th></tr></thead>
            <tbody>
              {form.lines.map((line, index) => (
                <tr key={line.local_key}>
                  <th scope="row" data-label="Item"><span>{line.name || `Line ${index + 1}`}</span>{line.hsn_sac ? <small>HSN/SAC {line.hsn_sac}</small> : null}</th>
                  <td data-label="Quantity">{line.quantity || "—"} {line.unit}</td>
                  <td data-label="Rate">{line.unit_rate ? `₹${line.unit_rate}` : "—"}</td>
                  <td data-label="GST">{line.gst_rate === "" ? "—" : `${line.gst_rate}%`}</td>
                  <td data-label="Amount">{formatPaise(estimate.lines[index].line_total_paise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="admin-invoice-preview__summary">
          <p><span>Subtotal</span><strong>{formatPaise(estimate.totals.subtotal_paise)}</strong></p>
          {estimate.totals.discount_paise ? <p><span>Discount</span><strong>− {formatPaise(estimate.totals.discount_paise)}</strong></p> : null}
          <p><span>Taxable value</span><strong>{formatPaise(estimate.totals.taxable_paise)}</strong></p>
          {estimate.tax_regime === "intra_state" ? <><p><span>CGST</span><strong>{formatPaise(estimate.totals.cgst_paise)}</strong></p><p><span>SGST</span><strong>{formatPaise(estimate.totals.sgst_paise)}</strong></p></> : null}
          {estimate.tax_regime === "inter_state" ? <p><span>IGST</span><strong>{formatPaise(estimate.totals.igst_paise)}</strong></p> : null}
          {estimate.tax_regime === "pending" ? <p><span>Estimated GST · split pending</span><strong>{formatPaise(estimate.totals.pending_tax_paise)}</strong></p> : null}
          {estimate.totals.adjustment_paise !== 0n || form.post_tax_adjustment_label ? <p><span>{form.post_tax_adjustment_label || "Post-tax adjustment"}</span><strong>{formatPaise(estimate.totals.adjustment_paise)}</strong></p> : null}
          {settings?.round_to_rupee ? <p><span>Round-off</span><strong>{formatPaise(estimate.totals.round_off_paise)}</strong></p> : null}
          <p className="admin-invoice-preview__grand-total"><span>Estimated quoted total</span><strong>{formatPaise(estimate.totals.grand_total_paise)}</strong></p>
          <small>{taxRegimeLabel(estimate)}</small>
        </div>
        {form.notes ? <section className="admin-invoice-preview__copy"><strong>Notes</strong><p>{form.notes}</p></section> : null}
        {form.terms ? <section className="admin-invoice-preview__copy"><strong>Terms</strong><p>{form.terms}</p></section> : null}
      </div>
      <InlineNotice tone="info" title="Estimated — backend authoritative">
        Line amounts use exact local integer arithmetic and half-up paise rounding for guidance. The backend recalculates every saved quotation and remains authoritative.
      </InlineNotice>
    </aside>
  );
}

export default function QuotationEditorPage() {
  const { quotationId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isEdit = Boolean(quotationId);
  const presetCustomerId = isEdit ? "" : asText(searchParams.get("customer")).trim();
  const [form, setForm] = useState(null);
  const [clientErrors, setClientErrors] = useState({});
  const [submitError, setSubmitError] = useState(null);
  const [serverLocked, setServerLocked] = useState(false);
  const [conflictQuotation, setConflictQuotation] = useState(null);
  const [baseRevision, setBaseRevision] = useState(null);
  const [baseQuotationId, setBaseQuotationId] = useState("");
  const initializedFor = useRef("");
  const initialFormFingerprintRef = useRef("");
  const navigationApprovedRef = useRef(false);

  useAdminTitle(isEdit ? "Edit quotation draft" : "New quotation");

  const settingsQuery = useQuery({ queryKey: ["admin", "settings"], queryFn: adminApi.settings.get });
  const metadataQuery = useQuery({
    queryKey: ["admin", "metadata"],
    queryFn: adminApi.metadata,
    refetchOnMount: "always",
  });
  const customersQuery = useQuery({
    queryKey: ["admin", "customers", CUSTOMER_QUERY],
    queryFn: () => adminApi.customers.list(CUSTOMER_QUERY),
  });
  const catalogueQuery = useQuery({
    queryKey: ["admin", "catalogue", CATALOGUE_QUERY],
    queryFn: () => adminApi.catalogue.list(CATALOGUE_QUERY),
  });
  const quotationQuery = useQuery({
    queryKey: ["admin", "quotation", quotationId],
    queryFn: () => adminApi.quotations.get(quotationId),
    enabled: isEdit,
  });
  const presetCustomerQuery = useQuery({
    queryKey: ["admin", "customer", presetCustomerId],
    queryFn: () => adminApi.customers.get(presetCustomerId),
    enabled: Boolean(presetCustomerId),
    retry: false,
  });

  const states = metadataQuery.data?.states || [];
  const customers = customersQuery.data?.items || [];
  const catalogue = catalogueQuery.data?.items || [];

  useEffect(() => {
    const initializationKey = isEdit ? `edit:${quotationId}` : `create:${presetCustomerId || "blank"}`;
    if (initializedFor.current === initializationKey) return;
    if (!settingsQuery.data || !metadataQuery.data) return;
    if (!isEdit && (!metadataQuery.isFetchedAfterMount || metadataQuery.isRefetchError)) return;
    if (isEdit && !quotationQuery.data) return;
    if (presetCustomerId && presetCustomerQuery.isPending) return;
    initializedFor.current = initializationKey;
    const nextForm = isEdit
      ? draftFromQuotation(quotationQuery.data)
      : initialDraft(settingsQuery.data, presetCustomerQuery.data, metadataQuery.data?.business_date);
    initialFormFingerprintRef.current = JSON.stringify(nextForm);
    navigationApprovedRef.current = false;
    setForm(nextForm);
    setBaseRevision(isEdit ? quotationQuery.data?.revision ?? null : null);
    setBaseQuotationId(isEdit ? quotationId : "");
    setClientErrors({});
    setSubmitError(null);
    setServerLocked(false);
    setConflictQuotation(null);
  }, [
    isEdit,
    metadataQuery.data,
    metadataQuery.isFetchedAfterMount,
    metadataQuery.isRefetchError,
    presetCustomerId,
    presetCustomerQuery.data,
    presetCustomerQuery.isPending,
    quotationId,
    quotationQuery.data,
    settingsQuery.data,
  ]);

  useEffect(() => {
    const latestRevision = quotationQuery.data?.revision;
    if (
      !isEdit
      || baseQuotationId !== quotationId
      || baseRevision === null
      || latestRevision === null
      || latestRevision === undefined
      || String(latestRevision) === String(baseRevision)
      || conflictQuotation
    ) return;
    setConflictQuotation(quotationQuery.data);
    setServerLocked(true);
    toast.warning("This quotation changed on the server. Review the latest revision before editing again.");
  }, [baseQuotationId, baseRevision, conflictQuotation, isEdit, quotationId, quotationQuery.data]);

  const estimate = useMemo(
    () => (form && settingsQuery.data ? estimateQuotation(form, settingsQuery.data) : null),
    [form, settingsQuery.data],
  );
  const readinessWarnings = useMemo(
    () => (form && estimate ? sendWarnings(form, settingsQuery.data, estimate) : []),
    [estimate, form, settingsQuery.data],
  );
  const formFingerprint = useMemo(() => (form ? JSON.stringify(form) : ""), [form]);
  const isDirty = Boolean(
    formFingerprint
    && initialFormFingerprintRef.current
    && formFingerprint !== initialFormFingerprintRef.current,
  );

  const shouldBlockNavigation = useCallback(
    ({ currentLocation, nextLocation }) => isDirty
      && !navigationApprovedRef.current
      && (
        currentLocation.pathname !== nextLocation.pathname
        || currentLocation.search !== nextLocation.search
        || currentLocation.hash !== nextLocation.hash
      ),
    [isDirty],
  );
  const blocker = useBlocker(shouldBlockNavigation);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(UNSAVED_QUOTATION_MESSAGE)) {
      blocker.proceed();
    } else {
      blocker.reset();
    }
  }, [blocker]);

  useEffect(() => {
    function handleBeforeUnload(event) {
      if (!isDirty || navigationApprovedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const detail = {
      dirty: isDirty,
      message: "Sign out and discard the unsaved quotation changes?",
      source: "quotation-editor",
    };
    window.dispatchEvent(new CustomEvent("suvi-admin:editor-dirty-state", { detail }));
    return () => {
      if (isDirty) {
        window.dispatchEvent(new CustomEvent("suvi-admin:editor-dirty-state", {
          detail: { ...detail, dirty: false },
        }));
      }
    };
  }, [isDirty]);

  const saveMutation = useMutation({
    mutationFn: ({ payload, expectedRevision }) => (isEdit
      ? adminApi.quotations.update(quotationId, { ...payload, expected_revision: expectedRevision })
      : adminApi.quotations.create(payload)),
    onSuccess: (saved) => {
      navigationApprovedRef.current = true;
      invalidateQuotationQueries(queryClient, saved.id, { quotation: saved });
      toast.success(isEdit ? "Draft quotation updated" : "Draft quotation created");
      navigate(`/admin/quotations/${saved.id}`, { replace: true });
    },
    onError: (error) => {
      const normalized = apiError(error, "The quotation draft could not be saved.");
      const latest = error?.response?.data?.detail?.quotation;
      if (latest?.id === quotationId) {
        invalidateQuotationQueries(queryClient, quotationId, { quotation: latest });
        setConflictQuotation(latest);
        setServerLocked(true);
        setSubmitError(null);
        toast.warning("A newer quotation revision is available. Review it before editing again.");
        return;
      }
      setSubmitError(error);
      if (["quotation_immutable", "quotation_not_draft", "quotation_revision_conflict"].includes(normalized.code)) {
        setServerLocked(true);
      }
      toast.error(normalized.message);
    },
  });

  function clearErrors(...paths) {
    setClientErrors((current) => {
      if (!paths.some((path) => current[path])) return current;
      const next = { ...current };
      paths.forEach((path) => delete next[path]);
      return next;
    });
  }

  function updateTop(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    clearErrors(field);
  }

  function updateCustomer(field, value) {
    setForm((current) => ({ ...current, customer_snapshot: { ...current.customer_snapshot, [field]: value } }));
    clearErrors(`customer_snapshot.${field}`);
  }

  function updateCustomerAddress(kind, field, value) {
    setForm((current) => {
      const existing = current.customer_snapshot[kind] || blankAddress();
      return { ...current, customer_snapshot: { ...current.customer_snapshot, [kind]: { ...existing, [field]: value } } };
    });
    clearErrors(`customer_snapshot.${kind}.${field}`);
  }

  function updateCustomerAddressState(kind, code) {
    setForm((current) => {
      const existing = current.customer_snapshot[kind] || blankAddress();
      return {
        ...current,
        customer_snapshot: {
          ...current.customer_snapshot,
          [kind]: { ...existing, state_code: code, state: stateNameForCode(code, states) },
        },
      };
    });
    clearErrors(`customer_snapshot.${kind}.state`, `customer_snapshot.${kind}.state_code`);
  }

  function selectCustomer(customerId) {
    if (!customerId) {
      updateCustomer("customer_id", null);
      return;
    }
    const customer = customers.find((item) => item.id === customerId)
      || (presetCustomerQuery.data?.id === customerId ? presetCustomerQuery.data : null);
    if (!customer) return;
    setForm((current) => ({ ...current, customer_snapshot: customerSnapshotFrom(customer) }));
    setClientErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([path]) => !path.startsWith("customer_snapshot.")),
    ));
  }

  function toggleShipping(sameAsBilling) {
    setForm((current) => ({
      ...current,
      customer_snapshot: {
        ...current.customer_snapshot,
        shipping_same_as_billing: sameAsBilling,
        shipping_address: current.customer_snapshot.shipping_address || blankAddress(),
      },
    }));
    if (sameAsBilling) {
      setClientErrors((current) => Object.fromEntries(
        Object.entries(current).filter(([path]) => !path.startsWith("customer_snapshot.shipping_address.")),
      ));
    }
  }

  function requestEditorNavigation(destination) {
    navigate(destination);
  }

  function updateLine(index, field, value) {
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index
        ? { ...line, [field]: value, ...(field === "discount_type" && value === "none" ? { discount_value: "0" } : {}) }
        : line)),
    }));
    clearErrors(`lines.${index}.${field}`, ...(field === "discount_type" ? [`lines.${index}.discount_value`] : []));
  }

  function selectCatalogueItem(index, itemId) {
    if (!itemId) {
      updateLine(index, "item_id", null);
      return;
    }
    const item = catalogue.find((candidate) => candidate.id === itemId);
    if (!item) return;
    setForm((current) => ({
      ...current,
      lines: current.lines.map((line, lineIndex) => (lineIndex === index ? catalogueSnapshot(item, line) : line)),
    }));
    setClientErrors((current) => Object.fromEntries(
      Object.entries(current).filter(([path]) => !path.startsWith(`lines.${index}.`)),
    ));
  }

  function addLine() {
    if (form.lines.length >= 200) {
      toast.error("A quotation can contain at most 200 lines.");
      return;
    }
    setForm((current) => ({ ...current, lines: [...current.lines, blankLine()] }));
    clearErrors("lines");
  }

  function duplicateLine(index) {
    if (form.lines.length >= 200) {
      toast.error("A quotation can contain at most 200 lines.");
      return;
    }
    setForm((current) => {
      const duplicate = { ...current.lines[index], local_key: nextLineKey() };
      const lines = [...current.lines];
      lines.splice(index + 1, 0, duplicate);
      return { ...current, lines };
    });
    setClientErrors({});
  }

  function removeLine(index) {
    if (form.lines.length === 1) {
      toast.error("Keep at least one quotation line.");
      return;
    }
    setForm((current) => ({ ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) }));
    setClientErrors({});
  }

  function updatePlaceOfSupply(code) {
    setForm((current) => ({ ...current, place_of_supply: { state_code: code, state: stateNameForCode(code, states) } }));
    clearErrors("place_of_supply.state", "place_of_supply.state_code");
  }

  function submitDraft(event) {
    event.preventDefault();
    if (!form || !estimate || saveMutation.isPending || serverLocked) return;
    const taxConfigurationProblem = businessTaxConfigurationProblem(form, settingsQuery.data, states);
    if (taxConfigurationProblem) {
      toast.error(taxConfigurationProblem);
      return;
    }
    const errors = validateDraft(form, states, estimate);
    setClientErrors(errors);
    setSubmitError(null);
    if (Object.keys(errors).length) {
      toast.error("Review the highlighted fields before saving.");
      window.requestAnimationFrame(() => document.querySelector(".admin-quotation-editor [aria-invalid='true']")?.focus());
      return;
    }
    const payload = buildPayload(form);
    saveMutation.mutate({
      payload,
      expectedRevision: isEdit ? baseRevision : undefined,
    });
  }

  const criticalError = settingsQuery.error || metadataQuery.error || (isEdit ? quotationQuery.error : null);
  const criticalPending = settingsQuery.isPending || metadataQuery.isPending || (isEdit && quotationQuery.isPending)
    || (Boolean(presetCustomerId) && presetCustomerQuery.isPending);

  if (criticalPending || (!criticalError && !form)) {
    return <div className="admin-full-state"><LoadingState label={isEdit ? "Loading quotation draft…" : "Preparing quotation builder…"} /></div>;
  }
  if (criticalError) {
    return (
      <div className="admin-full-state">
        <ErrorState
          error={criticalError}
          title={isEdit ? "We couldn't load this quotation draft" : "We couldn't prepare the quotation builder"}
          onRetry={() => {
            settingsQuery.refetch();
            metadataQuery.refetch();
            if (isEdit) quotationQuery.refetch();
          }}
        />
      </div>
    );
  }

  const existingQuotation = quotationQuery.data;
  const canEdit = !isEdit || existingQuotation?.status === "draft";
  const taxConfigurationProblem = businessTaxConfigurationProblem(form, settingsQuery.data, states);
  const saveDisabled = saveMutation.isPending || !canEdit || serverLocked || Boolean(taxConfigurationProblem);
  const backPath = isEdit ? `/admin/quotations/${quotationId}` : "/admin/quotations";
  const selectedCustomerMissing = form.customer_snapshot.customer_id
    && !customers.some((customer) => customer.id === form.customer_snapshot.customer_id)
    && presetCustomerQuery.data?.id !== form.customer_snapshot.customer_id;

  return (
    <div className="admin-invoice-editor admin-quotation-editor">
      <PageHeader
        eyebrow={isEdit ? "Draft workspace" : "Quotation workspace"}
        title={isEdit ? "Edit quotation draft" : "Create quotation draft"}
        description="Build an editable customer proposal. A quotation number and frozen server calculation are allocated only when it is sent."
        actions={(
          <>
            <button className="admin-button admin-button--ghost" type="button" onClick={() => requestEditorNavigation(backPath)} disabled={saveMutation.isPending}><ArrowLeft aria-hidden="true" /> Back</button>
            <button className="admin-button admin-button--primary" type="submit" form="admin-quotation-editor-form" disabled={saveDisabled}><Save aria-hidden="true" />{saveMutation.isPending ? "Saving…" : "Save draft"}</button>
          </>
        )}
      />

      <InlineNotice tone="info" title="Estimated values — backend authoritative">
        The editor uses exact decimal-string and BigInt arithmetic for guidance. Saving always recalculates and validates the quotation on the backend.
      </InlineNotice>
      {conflictQuotation ? (
        <InlineNotice tone="warning" title="A newer server revision needs review">
          <div className="admin-refresh-warning__content">
            <p>Your open form was not overwritten. Revision {conflictQuotation.revision ?? "—"} is now cached; return to the quotation detail and review it before editing again.</p>
            <button className="admin-button admin-button--outline" type="button" onClick={() => requestEditorNavigation(`/admin/quotations/${quotationId}`)}>Review latest quotation</button>
          </div>
        </InlineNotice>
      ) : null}
      {!canEdit || (serverLocked && !conflictQuotation) ? (
        <InlineNotice tone="warning" title="This quotation is no longer editable">Only draft quotations can be changed. Return to detail to review its current status.</InlineNotice>
      ) : null}
      {taxConfigurationProblem ? (
        <InlineNotice tone="warning" title="Business tax configuration blocks saving">
          <p>{taxConfigurationProblem}</p>
          <button className="admin-button admin-button--outline admin-button--small" type="button" onClick={() => requestEditorNavigation("/admin/settings")}>Open Business settings</button>
        </InlineNotice>
      ) : null}
      {presetCustomerQuery.isError ? <InlineNotice tone="warning" title="Linked customer unavailable">The customer from the URL could not be loaded. You can still choose an active customer or enter a manual snapshot.</InlineNotice> : null}
      {submitError ? <ValidationSummary error={submitError} /> : null}
      {Object.keys(clientErrors).length ? <InlineNotice tone="warning" title="Some fields need attention">Review the highlighted customer, quotation, and line details before saving this draft.</InlineNotice> : null}

      <form id="admin-quotation-editor-form" className="admin-invoice-editor__layout" onSubmit={submitDraft} noValidate>
        <div className="admin-invoice-editor__form">
          <SectionCard title="Customer snapshot" description="Choose a saved customer or type an ad-hoc customer. Selected details are copied now and remain editable on this draft.">
            {customersQuery.isError ? <InlineNotice tone="warning" title="Saved customers unavailable">Manual customer entry remains available while the list is unavailable.</InlineNotice> : null}
            {customersQuery.data?.total > customers.length ? <InlineNotice tone="info" title="Customer list limited">Showing the 200 most recently updated active customers.</InlineNotice> : null}
            <div className="admin-form-grid admin-form-grid--two">
              <Field label="Saved customer" hint="Changing this selection copies a fresh frozen snapshot." className="admin-form-grid__wide">
                <select className="admin-select" value={form.customer_snapshot.customer_id || ""} onChange={(event) => selectCustomer(event.target.value)}>
                  <option value="">Manual / ad-hoc customer</option>
                  {selectedCustomerMissing ? <option value={form.customer_snapshot.customer_id}>{form.customer_snapshot.display_name || "Current quotation customer"} · saved snapshot</option> : null}
                  {presetCustomerQuery.data && !customers.some((customer) => customer.id === presetCustomerQuery.data.id) ? <option value={presetCustomerQuery.data.id}>{presetCustomerQuery.data.display_name} · linked customer</option> : null}
                  {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.display_name}{customer.gstin ? ` · ${customer.gstin}` : ""}</option>)}
                </select>
              </Field>
              <Field label="Customer type" required error={clientErrors["customer_snapshot.customer_type"]}>
                <select className="admin-select" value={form.customer_snapshot.customer_type} onChange={(event) => updateCustomer("customer_type", event.target.value)} aria-invalid={Boolean(clientErrors["customer_snapshot.customer_type"])}>
                  <option value="" disabled>Select customer type</option><option value="business">Business</option><option value="individual">Individual</option>
                </select>
              </Field>
              <Field label="Display name" required error={clientErrors["customer_snapshot.display_name"]}><input className="admin-input" value={form.customer_snapshot.display_name} onChange={(event) => updateCustomer("display_name", event.target.value)} maxLength={200} aria-invalid={Boolean(clientErrors["customer_snapshot.display_name"])} /></Field>
              <Field label="Legal name" error={clientErrors["customer_snapshot.legal_name"]}><input className="admin-input" value={form.customer_snapshot.legal_name} onChange={(event) => updateCustomer("legal_name", event.target.value)} maxLength={200} aria-invalid={Boolean(clientErrors["customer_snapshot.legal_name"])} /></Field>
              <Field label="GSTIN" hint="Optional; state prefix must match billing state." error={clientErrors["customer_snapshot.gstin"]}><input className="admin-input admin-input--uppercase" value={form.customer_snapshot.gstin} onChange={(event) => updateCustomer("gstin", event.target.value.toUpperCase())} maxLength={15} aria-invalid={Boolean(clientErrors["customer_snapshot.gstin"])} autoComplete="off" /></Field>
              <Field label="PAN" error={clientErrors["customer_snapshot.pan"]}><input className="admin-input admin-input--uppercase" value={form.customer_snapshot.pan} onChange={(event) => updateCustomer("pan", event.target.value.toUpperCase())} maxLength={10} aria-invalid={Boolean(clientErrors["customer_snapshot.pan"])} autoComplete="off" /></Field>
              <Field label="Contact person" error={clientErrors["customer_snapshot.contact_person"]}><input className="admin-input" value={form.customer_snapshot.contact_person} onChange={(event) => updateCustomer("contact_person", event.target.value)} maxLength={160} aria-invalid={Boolean(clientErrors["customer_snapshot.contact_person"])} autoComplete="name" /></Field>
              <Field label="Phone" error={clientErrors["customer_snapshot.phone"]}><input className="admin-input" type="tel" value={form.customer_snapshot.phone} onChange={(event) => updateCustomer("phone", event.target.value)} maxLength={30} aria-invalid={Boolean(clientErrors["customer_snapshot.phone"])} autoComplete="tel" /></Field>
              <Field label="Email" error={clientErrors["customer_snapshot.email"]}><input className="admin-input" type="email" value={form.customer_snapshot.email} onChange={(event) => updateCustomer("email", event.target.value)} maxLength={254} aria-invalid={Boolean(clientErrors["customer_snapshot.email"])} autoComplete="email" /></Field>
            </div>
            <AddressFields legend="Billing address" address={form.customer_snapshot.billing_address} path="customer_snapshot.billing_address" states={states} errors={clientErrors} onFieldChange={(field, value) => updateCustomerAddress("billing_address", field, value)} onStateChange={(code) => updateCustomerAddressState("billing_address", code)} />
            <label className="admin-check admin-check--panel">
              <input className="admin-checkbox" type="checkbox" checked={form.customer_snapshot.shipping_same_as_billing} onChange={(event) => toggleShipping(event.target.checked)} />
              <span><strong>Shipping address is the same as billing</strong><small>Turn this off to record a separate delivery address.</small></span>
            </label>
            {!form.customer_snapshot.shipping_same_as_billing ? <AddressFields legend="Shipping address" address={form.customer_snapshot.shipping_address || blankAddress()} path="customer_snapshot.shipping_address" states={states} errors={clientErrors} onFieldChange={(field, value) => updateCustomerAddress("shipping_address", field, value)} onStateChange={(code) => updateCustomerAddressState("shipping_address", code)} /> : null}
          </SectionCard>

          <SectionCard title="Quotation details" description="Choose the validity explicitly; no default duration or payment term is invented.">
            <div className="admin-form-grid admin-form-grid--three">
              <Field label="Quotation date" required error={clientErrors.quotation_date}><input className="admin-input" type="date" value={form.quotation_date} onChange={(event) => updateTop("quotation_date", event.target.value)} aria-invalid={Boolean(clientErrors.quotation_date)} /></Field>
              <Field label="Valid until" required hint="Required — choose the commercial validity date." error={clientErrors.valid_until}><input className="admin-input" type="date" min={form.quotation_date || undefined} value={form.valid_until} onChange={(event) => updateTop("valid_until", event.target.value)} aria-invalid={Boolean(clientErrors.valid_until)} /></Field>
              <Field label="Place of supply" required error={clientErrors["place_of_supply.state_code"]}>
                <select className="admin-select" value={form.place_of_supply.state_code} onChange={(event) => updatePlaceOfSupply(event.target.value)} aria-invalid={Boolean(clientErrors["place_of_supply.state_code"])}><option value="" disabled>Select state</option>{states.map((state) => <option key={state.code} value={state.code}>{state.code} · {state.name}</option>)}</select>
              </Field>
              <Field label="Project reference" error={clientErrors.project_reference}><input className="admin-input" value={form.project_reference} onChange={(event) => updateTop("project_reference", event.target.value)} maxLength={240} aria-invalid={Boolean(clientErrors.project_reference)} /></Field>
              <Field label="Purchase order reference" error={clientErrors.po_reference}><input className="admin-input" value={form.po_reference} onChange={(event) => updateTop("po_reference", event.target.value)} maxLength={240} aria-invalid={Boolean(clientErrors.po_reference)} /></Field>
              <Field label="Tax mode" required error={clientErrors.tax_mode}>
                <select className="admin-select" value={form.tax_mode} onChange={(event) => updateTop("tax_mode", event.target.value)} aria-invalid={Boolean(clientErrors.tax_mode)}><option value="" disabled>Select tax mode</option><option value="auto">Automatic GST treatment</option><option value="no_tax">No tax</option></select>
              </Field>
            </div>
            <label className="admin-check admin-check--panel"><input className="admin-checkbox" type="checkbox" checked={form.reverse_charge} onChange={(event) => updateTop("reverse_charge", event.target.checked)} /><span><strong>Tax payable under reverse charge</strong><small>This disclosure is recorded on the quotation; it does not alter the local arithmetic.</small></span></label>
            <TaxModeNotice mode={settingsQuery.data.gst_registration_mode} taxMode={form.tax_mode} />
          </SectionCard>

          <SectionCard title="Goods and services" description="Amounts stay as decimal strings. Rates, HSN/SAC, and GST are filled only by typing or selecting a catalogue item." action={<span className="admin-count-badge">{form.lines.length} / 200 lines</span>}>
            {catalogueQuery.isError ? <InlineNotice tone="warning" title="Catalogue unavailable">Manual line entry remains available while the catalogue list is unavailable.</InlineNotice> : null}
            {catalogueQuery.data?.total > catalogue.length ? <InlineNotice tone="info" title="Catalogue list limited">Showing the 200 most recently updated active catalogue items.</InlineNotice> : null}
            {clientErrors.lines ? <p className="admin-field__error">{clientErrors.lines}</p> : null}
            <div className="admin-line-list">
              {form.lines.map((line, index) => {
                const missingSelectedItem = line.item_id && !catalogue.some((item) => item.id === line.item_id);
                const base = `lines.${index}`;
                return (
                  <section className="admin-line-item" key={line.local_key} aria-labelledby={`${line.local_key}-heading`}>
                    <div className="admin-line-item__header">
                      <div><p className="admin-eyebrow">Line {index + 1}</p><h3 id={`${line.local_key}-heading`}>{line.name || "Untitled item or service"}</h3></div>
                      <div className="admin-line-item__actions">
                        <button className="admin-button admin-button--ghost admin-button--small" type="button" onClick={() => duplicateLine(index)} disabled={form.lines.length >= 200 || saveMutation.isPending}><Copy aria-hidden="true" /> Duplicate</button>
                        <button className="admin-icon-button admin-icon-button--danger" type="button" onClick={() => removeLine(index)} disabled={form.lines.length === 1 || saveMutation.isPending} aria-label={`Remove line ${index + 1}`}><Trash2 aria-hidden="true" /></button>
                      </div>
                    </div>
                    <div className="admin-form-grid admin-form-grid--two">
                      <Field label="Catalogue item" hint="Selection copies a frozen, editable line snapshot." className="admin-form-grid__wide">
                        <select className="admin-select" value={line.item_id || ""} onChange={(event) => selectCatalogueItem(index, event.target.value)}>
                          <option value="">Manual line</option>
                          {missingSelectedItem ? <option value={line.item_id}>{line.name || "Current line"} · saved snapshot</option> : null}
                          {catalogue.map((item) => <option key={item.id} value={item.id}>{item.name}{item.hsn_sac ? ` · ${item.hsn_sac}` : ""}{item.rate !== undefined ? ` · ₹${item.rate}` : ""}</option>)}
                        </select>
                      </Field>
                      <Field label="Type" required error={clientErrors[`${base}.item_type`]}><select className="admin-select" value={line.item_type} onChange={(event) => updateLine(index, "item_type", event.target.value)} aria-invalid={Boolean(clientErrors[`${base}.item_type`])}><option value="" disabled>Select line type</option><option value="goods">Goods</option><option value="service">Service</option></select></Field>
                      <Field label="Name" required error={clientErrors[`${base}.name`]}><input className="admin-input" value={line.name} onChange={(event) => updateLine(index, "name", event.target.value)} maxLength={240} aria-invalid={Boolean(clientErrors[`${base}.name`])} /></Field>
                      <Field label="Description" error={clientErrors[`${base}.description`]} className="admin-form-grid__wide"><textarea className="admin-textarea" value={line.description} onChange={(event) => updateLine(index, "description", event.target.value)} rows={2} maxLength={3000} aria-invalid={Boolean(clientErrors[`${base}.description`])} /></Field>
                    </div>
                    <div className="admin-form-grid admin-form-grid--five">
                      <Field label="HSN / SAC" hint="Recommended before sending." error={clientErrors[`${base}.hsn_sac`]}><input className="admin-input admin-input--uppercase" value={line.hsn_sac} onChange={(event) => updateLine(index, "hsn_sac", event.target.value.toUpperCase().replace(/\s/g, ""))} maxLength={16} aria-invalid={Boolean(clientErrors[`${base}.hsn_sac`])} /></Field>
                      <Field label="Unit" required error={clientErrors[`${base}.unit`]}><input className="admin-input admin-input--uppercase" value={line.unit} onChange={(event) => updateLine(index, "unit", event.target.value.toUpperCase())} list="admin-quotation-unit-suggestions" maxLength={24} aria-invalid={Boolean(clientErrors[`${base}.unit`])} /></Field>
                      <Field label="Quantity" required error={clientErrors[`${base}.quantity`]}><input className="admin-input" value={line.quantity} onChange={(event) => updateLine(index, "quantity", event.target.value)} inputMode="decimal" placeholder="1" aria-invalid={Boolean(clientErrors[`${base}.quantity`])} /></Field>
                      <Field label="Rate (₹)" required error={clientErrors[`${base}.unit_rate`]}><input className="admin-input" value={line.unit_rate} onChange={(event) => updateLine(index, "unit_rate", event.target.value)} inputMode="decimal" placeholder="0.00" aria-invalid={Boolean(clientErrors[`${base}.unit_rate`])} /></Field>
                      <Field label="GST rate (%)" required error={clientErrors[`${base}.gst_rate`]}><input className="admin-input" value={line.gst_rate} onChange={(event) => updateLine(index, "gst_rate", event.target.value)} inputMode="decimal" list="admin-quotation-gst-rate-suggestions" placeholder="Select or enter" aria-invalid={Boolean(clientErrors[`${base}.gst_rate`])} /></Field>
                      <Field label="Discount type" required error={clientErrors[`${base}.discount_type`]}><select className="admin-select" value={line.discount_type} onChange={(event) => updateLine(index, "discount_type", event.target.value)} aria-invalid={Boolean(clientErrors[`${base}.discount_type`])}><option value="" disabled>Select discount type</option><option value="none">No discount</option><option value="percent">Percentage</option><option value="fixed">Fixed amount</option></select></Field>
                      <Field label={line.discount_type === "percent" ? "Discount (%)" : "Discount (₹)"} required={line.discount_type !== "none"} error={clientErrors[`${base}.discount_value`]}><input className="admin-input" value={line.discount_value} onChange={(event) => updateLine(index, "discount_value", event.target.value)} inputMode="decimal" disabled={line.discount_type === "none"} aria-invalid={Boolean(clientErrors[`${base}.discount_value`])} /></Field>
                    </div>
                    <LineEstimate estimate={estimate.lines[index]} />
                  </section>
                );
              })}
            </div>
            <button className="admin-button admin-button--outline admin-line-add" type="button" onClick={addLine} disabled={form.lines.length >= 200 || saveMutation.isPending}><Plus aria-hidden="true" /> Add another line</button>
          </SectionCard>

          <SectionCard title="Adjustments and document copy" description="Post-tax adjustments can be positive or negative. Notes and terms are copied onto the quotation.">
            <div className="admin-form-grid admin-form-grid--two">
              <Field label="Adjustment label" hint="Required when the adjustment is not zero." error={clientErrors.post_tax_adjustment_label}><input className="admin-input" value={form.post_tax_adjustment_label} onChange={(event) => updateTop("post_tax_adjustment_label", event.target.value)} maxLength={160} placeholder="e.g. Retention" aria-invalid={Boolean(clientErrors.post_tax_adjustment_label)} /></Field>
              <Field label="Post-tax adjustment (₹)" hint="Use a minus sign for a deduction; 2 decimals maximum." error={clientErrors.post_tax_adjustment_amount}><input className="admin-input" value={form.post_tax_adjustment_amount} onChange={(event) => updateTop("post_tax_adjustment_amount", event.target.value)} inputMode="decimal" placeholder="0.00" aria-invalid={Boolean(clientErrors.post_tax_adjustment_amount)} /></Field>
              <Field label="Notes" error={clientErrors.notes} className="admin-form-grid__wide"><textarea className="admin-textarea" value={form.notes} onChange={(event) => updateTop("notes", event.target.value)} rows={4} maxLength={5000} aria-invalid={Boolean(clientErrors.notes)} /></Field>
              <Field label="Terms and conditions" error={clientErrors.terms} className="admin-form-grid__wide"><textarea className="admin-textarea" value={form.terms} onChange={(event) => updateTop("terms", event.target.value)} rows={5} maxLength={5000} aria-invalid={Boolean(clientErrors.terms)} /></Field>
            </div>
          </SectionCard>

          {readinessWarnings.length ? <InlineNotice tone="warning" title="Send-readiness checks"><ul className="admin-notice__list">{readinessWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></InlineNotice> : ["regular", "composition"].includes(settingsQuery.data.gst_registration_mode) ? <InlineNotice tone="success" title="Core send-readiness checks pass">The entered GST identity, addresses, and HSN/SAC fields satisfy the editor's pre-send checks. The backend validates and recalculates again on send.</InlineNotice> : null}

          <div className="admin-invoice-editor__submit-bar">
            <div><FileSignature aria-hidden="true" /><span>Local estimated quoted total<strong>{formatPaise(estimate.totals.grand_total_paise)}</strong></span></div>
            <button className="admin-button admin-button--primary" type="submit" disabled={saveDisabled}><Save aria-hidden="true" />{saveMutation.isPending ? "Saving draft…" : "Save draft"}</button>
          </div>
        </div>
        <QuotationDocumentPreview form={form} settings={settingsQuery.data} estimate={estimate} />
      </form>

      <datalist id="admin-quotation-unit-suggestions">{(metadataQuery.data.units || []).map((unit) => <option key={unit} value={unit} />)}</datalist>
      <datalist id="admin-quotation-gst-rate-suggestions">{(metadataQuery.data.gst_rates || []).map((rate) => <option key={rate} value={rate} />)}</datalist>
    </div>
  );
}
