import axios from "axios";

const configuredBackend = (process.env.REACT_APP_BACKEND_URL || "").trim().replace(/\/+$/, "");
const baseURL = `${configuredBackend}/api/v1/admin`;
let csrfToken = "";

export const adminHttp = axios.create({
  baseURL,
  withCredentials: true,
  timeout: 30000,
  headers: { Accept: "application/json" },
});

export function setCsrfToken(token) {
  csrfToken = token || "";
}

function isMutation(method = "get") {
  return !["get", "head", "options"].includes(method.toLowerCase());
}

adminHttp.interceptors.request.use((config) => {
  if (csrfToken && isMutation(config.method) && !String(config.url || "").endsWith("/auth/login")) {
    config.headers.set("X-CSRF-Token", csrfToken);
  }
  return config;
});

adminHttp.interceptors.response.use(
  (response) => response,
  async (error) => {
    const path = String(error.config?.url || "");
    if (error.response?.status === 401 && !path.endsWith("/auth/login")) {
      setCsrfToken("");
      window.dispatchEvent(new CustomEvent("suvi-admin:unauthorized"));
    }

    const responseData = error.response?.data;
    const contentType = String(
      error.response?.headers?.["content-type"] || responseData?.type || "",
    ).toLowerCase();
    if (
      typeof Blob !== "undefined"
      && responseData instanceof Blob
      && contentType.includes("json")
    ) {
      try {
        error.response.data = JSON.parse(await responseData.text());
      } catch {
        // Keep the original Blob so the existing fallback handles malformed error bodies.
      }
    }

    return Promise.reject(error);
  },
);

function params(values = {}) {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== "" && value !== null && value !== undefined),
  );
}

async function json(request) {
  const response = await request;
  return response.data;
}

export function apiError(error, fallback = "Something went wrong. Please try again.") {
  const detail = error?.response?.data?.detail;
  if (detail && typeof detail === "object") {
    return {
      status: error.response.status,
      code: detail.code || "request_failed",
      message: detail.message || fallback,
      errors: Array.isArray(detail.errors) ? detail.errors : [],
    };
  }
  return {
    status: error?.response?.status || 0,
    code: error?.code || "network_error",
    message: error?.response ? fallback : "Unable to reach the document service. Check the backend URL and connection.",
    errors: [],
  };
}

export const adminApi = {
  auth: {
    login: (payload) => json(adminHttp.post("/auth/login", payload)),
    me: () => json(adminHttp.get("/auth/me")),
    logout: () => json(adminHttp.post("/auth/logout")),
  },
  settings: {
    get: () => json(adminHttp.get("/business-settings")),
    update: (payload) => json(adminHttp.put("/business-settings", payload)),
  },
  customers: {
    list: (query) => json(adminHttp.get("/customers", { params: params(query) })),
    get: (id) => json(adminHttp.get(`/customers/${id}`)),
    create: (payload) => json(adminHttp.post("/customers", payload)),
    update: (id, payload) => json(adminHttp.put(`/customers/${id}`, payload)),
    deactivate: (id) => json(adminHttp.delete(`/customers/${id}`)),
  },
  catalogue: {
    list: (query) => json(adminHttp.get("/catalogue-items", { params: params(query) })),
    get: (id) => json(adminHttp.get(`/catalogue-items/${id}`)),
    create: (payload) => json(adminHttp.post("/catalogue-items", payload)),
    update: (id, payload) => json(adminHttp.put(`/catalogue-items/${id}`, payload)),
    deactivate: (id) => json(adminHttp.delete(`/catalogue-items/${id}`)),
  },
  invoices: {
    list: (query) => json(adminHttp.get("/invoices", { params: params(query) })),
    get: (id) => json(adminHttp.get(`/invoices/${id}`)),
    create: (payload) => json(adminHttp.post("/invoices", payload)),
    update: (id, payload) => json(adminHttp.put(`/invoices/${id}`, payload)),
    issue: (id, payload) => json(adminHttp.post(`/invoices/${id}/issue`, payload)),
    duplicate: (id, payload = {}) => json(adminHttp.post(`/invoices/${id}/duplicate`, payload)),
    cancel: (id, payload) => json(adminHttp.post(`/invoices/${id}/cancel`, payload)),
    updateEInvoice: (id, payload) => json(adminHttp.put(`/invoices/${id}/e-invoice`, payload)),
    addPayment: (id, payload) => json(adminHttp.post(`/invoices/${id}/payments`, payload)),
    deletePayment: (id, paymentId) => json(adminHttp.delete(`/invoices/${id}/payments/${paymentId}`)),
    pdf: async (id, inline = false) => {
      const response = await adminHttp.get(`/invoices/${id}/pdf`, {
        params: { inline },
        responseType: "blob",
      });
      return { blob: response.data, disposition: response.headers["content-disposition"] || "" };
    },
  },
  quotations: {
    list: (query) => json(adminHttp.get("/quotations", { params: params(query) })),
    get: (id) => json(adminHttp.get(`/quotations/${id}`)),
    create: (payload) => json(adminHttp.post("/quotations", payload)),
    update: (id, payload) => json(adminHttp.put(`/quotations/${id}`, payload)),
    delete: (id, expectedRevision) => json(adminHttp.delete(`/quotations/${id}`, {
      params: { expected_revision: expectedRevision },
    })),
    send: (id, payload) => json(adminHttp.post(`/quotations/${id}/send`, payload)),
    status: (id, payload) => json(adminHttp.post(`/quotations/${id}/status`, payload)),
    duplicate: (id, payload) => json(adminHttp.post(`/quotations/${id}/duplicate`, payload)),
    convert: (id, payload) => json(adminHttp.post(`/quotations/${id}/convert`, payload)),
    pdf: async (id, inline = false, expectedRevision = undefined) => {
      const response = await adminHttp.get(`/quotations/${id}/pdf`, {
        params: { inline, expected_revision: expectedRevision },
        responseType: "blob",
      });
      const revisionHeader = response.headers["x-quotation-revision"];
      const renderedRevision = revisionHeader === undefined || revisionHeader === ""
        ? null
        : Number(revisionHeader);
      return {
        blob: response.data,
        disposition: response.headers["content-disposition"] || "",
        renderedRevision: Number.isSafeInteger(renderedRevision) ? renderedRevision : null,
      };
    },
  },
  dashboard: () => json(adminHttp.get("/dashboard")),
  quotationDashboard: () => json(adminHttp.get("/quotation-dashboard")),
  activity: (query) => json(adminHttp.get("/activity", { params: params(query) })),
  metadata: () => json(adminHttp.get("/metadata")),
};

export function invalidateInvoiceQueries(queryClient, invoiceId) {
  queryClient.invalidateQueries({ queryKey: ["admin", "invoices"] });
  if (invoiceId) queryClient.invalidateQueries({ queryKey: ["admin", "invoice", invoiceId] });
  queryClient.invalidateQueries({ queryKey: ["admin", "dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["admin", "activity"] });
}

export function invalidateQuotationQueries(
  queryClient,
  quotationId,
  { quotation = null, convertedInvoice = null } = {},
) {
  queryClient.invalidateQueries({ queryKey: ["admin", "quotations"] });
  queryClient.invalidateQueries({ queryKey: ["admin", "quotation-dashboard"] });
  queryClient.invalidateQueries({ queryKey: ["admin", "activity"] });

  if (quotationId && !quotation) {
    queryClient.invalidateQueries({ queryKey: ["admin", "quotation", quotationId] });
  }
  if (quotation?.id) {
    queryClient.setQueryData(["admin", "quotation", quotation.id], quotation);
  }
  if (convertedInvoice?.id) {
    invalidateInvoiceQueries(queryClient, convertedInvoice.id);
    queryClient.setQueryData(["admin", "invoice", convertedInvoice.id], convertedInvoice);
  }
}
