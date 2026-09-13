import { useState } from "react";
import axios from "axios";
import { ArrowUpRight } from "lucide-react";
import { projectTypes, site } from "@/content/site";
import { cn } from "@/lib/utils";

const API = `${(process.env.REACT_APP_BACKEND_URL || "").trim().replace(/\/+$/, "")}/api`;
const initial = (type) => ({ name: "", phone: "", email: "", project_type: type && projectTypes.includes(type) ? type : "", budget: "", message: "" });

export const EnquiryForm = ({ presetType }) => {
  const [form, setForm] = useState(() => initial(presetType));
  const [errors, setErrors] = useState({});
  const [status, setStatus] = useState("idle");
  const [serverError, setServerError] = useState("");

  const set = (key) => (event) => { setForm((current) => ({ ...current, [key]: event.target.value })); setErrors((current) => ({ ...current, [key]: undefined })); };
  const validate = () => {
    const next = {};
    if (form.name.trim().length < 2) next.name = "Please enter your name.";
    const digits = form.phone.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) next.phone = "Please enter a valid phone number.";
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) next.email = "Please enter a valid email address.";
    if (!form.project_type) next.project_type = "Please choose a project type.";
    return next;
  };
  const submit = async (event) => {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setStatus("loading");
    setServerError("");
    try {
      await axios.post(`${API}/enquiries`, { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim() || null, project_type: form.project_type, budget: form.budget.trim() || null, message: form.message.trim() || null, source_page: window.location.pathname });
      setStatus("success");
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setServerError(Array.isArray(detail) ? detail.map((item) => item.msg?.replace("Value error, ", "")).join(" ") : "Something went wrong. Please try again or call us directly.");
      setStatus("error");
    }
  };

  if (status === "success") return <div className="enquiry-success" data-testid="contact-success" role="status"><p className="editorial-label text-oxblood">Enquiry received</p><p className="h-section mt-7 text-oxblood">Thank <span className="italic">you.</span></p><p className="lede mt-6 max-w-md">Your enquiry has been received. The {site.name} team will get in touch with you shortly.</p></div>;

  return (
    <form onSubmit={submit} noValidate className="enquiry-grid" data-testid="contact-form">
      <Field label="Name" error={errors.name}><input id="name" data-testid="contact-name-input" className="field" value={form.name} onChange={set("name")} autoComplete="name" placeholder="Your name" required aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? "error-name" : undefined} /></Field>
      <Field label="Phone number" error={errors.phone}><input id="phone" data-testid="contact-phone-input" className="field" type="tel" value={form.phone} onChange={set("phone")} autoComplete="tel" placeholder="+91" required aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? "error-phone" : undefined} /></Field>
      <Field label="Email" hint="Optional" error={errors.email}><input id="email" data-testid="contact-email-input" className="field" type="email" value={form.email} onChange={set("email")} autoComplete="email" placeholder="you@example.com" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "error-email" : undefined} /></Field>
      <Field label="Project type" error={errors.project_type}><select id="project_type" data-testid="contact-project-type-select" className={cn("field appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%27http://www.w3.org/2000/svg%27 width=%2712%27 height=%2712%27 viewBox=%270 0 24 24%27 fill=%27none%27 stroke=%27%236B6257%27 stroke-width=%271.5%27><path d=%27M6 9l6 6 6-6%27/></svg>')] bg-[length:12px] bg-[right_0_center] bg-no-repeat pr-6", !form.project_type && "text-taupe/70")} value={form.project_type} onChange={set("project_type")} required aria-invalid={Boolean(errors.project_type)} aria-describedby={errors.project_type ? "error-project_type" : undefined}><option value="" disabled>Select a project type</option>{projectTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></Field>
      <Field label="Approximate budget" hint="Optional" className="enquiry-field--wide"><input id="budget" data-testid="contact-budget-input" className="field" value={form.budget} onChange={set("budget")} placeholder="A rough range is enough" /></Field>
      <Field label="Tell us about the space" hint="Optional" className="enquiry-field--wide"><textarea id="message" data-testid="contact-message-input" className="field min-h-[130px] resize-y" value={form.message} onChange={set("message")} placeholder="Your space, timeline and what you would love to change." rows={4} /></Field>
      <div className="enquiry-submit-row"><button type="submit" disabled={status === "loading"} data-testid="contact-submit-button" className="btn-solid disabled:cursor-wait disabled:opacity-60">{status === "loading" ? "Sending…" : "Request a consultation"}<ArrowUpRight className="h-4 w-4" /></button><p className="max-w-xs text-xs leading-relaxed text-taupe">We’ll only use these details to respond to your enquiry.</p></div>
      {status === "error" && <p className="enquiry-error text-sm text-burgundy" role="alert" data-testid="contact-error">{serverError}</p>}
    </form>
  );
};

const Field = ({ label, hint, error, children, className }) => (
  <div className={cn("enquiry-field", className)}><label htmlFor={children.props.id} className="field-label flex items-baseline justify-between"><span>{label}</span>{hint && <span className="normal-case tracking-normal text-taupe/70">{hint}</span>}</label>{children}{error && <p id={`error-${children.props.id}`} className="mt-2 text-xs text-burgundy" role="alert" data-testid={`error-${children.props.id}`}>{error}</p>}</div>
);
