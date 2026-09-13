import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { site } from "@/content/site";
import { telLink, waLink } from "@/lib/contact";

export const CtaBand = ({
  lines = ["Good spaces begin", <em>with a conversation.</em>],
  text = "Tell us about the home you have in mind. We'll take it from there.",
  primaryLabel = "Start a project",
  whatsappMessage,
  testId = "final-cta",
}) => (
  <section className="brand-cta" data-testid={testId}>
    <div className="container-x relative py-[clamp(5rem,10vw,10rem)]">
      <div className="brand-cta-rule mb-8" aria-hidden="true" />
      <p className="editorial-label mb-10 text-brass">A place for your next chapter</p>
      <div className="grid gap-12 lg:grid-cols-12 lg:items-end">
        <h2 className="editorial-heading lg:col-span-8" data-testid={`${testId}-heading`}>
          {lines.map((line, index) => <span className="block" key={index}>{line}</span>)}
        </h2>
        <div className="relative lg:col-span-3 lg:col-start-10">
          <p className="editorial-lede mb-8">{text}</p>
          <Link to="/contact" className="btn-light" data-testid={`${testId}-start`}>
            {primaryLabel}<ArrowUpRight className="h-4 w-4" strokeWidth={1.4} />
          </Link>
          <div className="mt-7 flex flex-wrap gap-x-7 gap-y-4 text-xs text-white/75">
            <a href={telLink()} data-testid={`${testId}-call`} className="link-underline">{site.phone.display}</a>
            <a href={waLink(whatsappMessage)} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-whatsapp`} className="link-underline">WhatsApp ↗</a>
          </div>
        </div>
      </div>
      <div className="brand-cta-rule mt-14" aria-hidden="true" />
      <div className="mt-5 flex flex-wrap justify-between gap-3 text-[10px] uppercase tracking-[.14em] text-white/45" aria-hidden="true">
        <span>Interior design</span><span>Custom furniture</span><span>Complete execution</span>
      </div>
    </div>
  </section>
);
