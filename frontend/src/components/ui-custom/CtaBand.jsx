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
}) => {
  const headingId = `${testId}-heading`;

  return (
    <section className="brand-cta" aria-labelledby={headingId} data-testid={testId}>
      <div className="container-x brand-cta-inner">
        <div className="brand-cta-rule" aria-hidden="true" />
        <p className="editorial-label brand-cta-eyebrow">A place for your next chapter</p>
        <div className="brand-cta-layout">
          <h2 id={headingId} className="editorial-heading" data-testid={`${testId}-heading`}>
            {lines.map((line, index) => <span className="block" key={index}>{line}</span>)}
          </h2>
          <div className="brand-cta-copy">
            <p className="editorial-lede">{text}</p>
            <Link to="/contact" className="btn-light brand-cta-primary" data-testid={`${testId}-start`}>
              {primaryLabel}<ArrowUpRight className="h-4 w-4" strokeWidth={1.4} />
            </Link>
            <address className="brand-cta-contacts">
              <a href={telLink()} data-testid={`${testId}-call`} className="brand-cta-contact">
                <span>Call the studio</span><strong>{site.phone.display}</strong>
              </a>
              <a href={waLink(whatsappMessage)} target="_blank" rel="noopener noreferrer" data-testid={`${testId}-whatsapp`} className="brand-cta-contact">
                <span>Message directly</span><strong>WhatsApp ↗</strong>
              </a>
            </address>
          </div>
        </div>
        <div className="brand-cta-rule brand-cta-rule--closing" aria-hidden="true" />
        <ul className="brand-cta-meta" aria-label="Suvi Interior services">
          <li><span aria-hidden="true">01</span>Interior design</li>
          <li><span aria-hidden="true">02</span>Custom furniture</li>
          <li><span aria-hidden="true">03</span>Complete execution</li>
        </ul>
      </div>
    </section>
  );
};
