import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { site } from "@/content/site";
import { homeGuide, homeFaqs } from "@/content/homeContent";

// Indexable long-form homepage content. The FAQ text here is mirrored by the
// FAQPage JSON-LD in Home.jsx and by the crawler fallback in scripts/generate-seo.js,
// so edits must be made in content/homeContent.js and will flow to all three.
export const LocalGuide = ({ index = "08", id = "nashik-interior-design" }) => (
  <section id={id} className="home-guide scroll-mt-24" aria-labelledby="home-guide-heading" data-testid="home-guide">
    <div className="container-x section">
      <div className="chapter-top">
        <p className="editorial-label">{index} / {homeGuide.eyebrow}</p>
        <p>Design and manufacturing under one roof, in Nashik.</p>
      </div>

      <div className="home-guide-grid">
        <div className="home-guide-copy">
          <h2 id="home-guide-heading" className="editorial-heading text-oxblood" data-testid="home-guide-heading">
            {homeGuide.heading.map((line, i) => (
              <span className="block" key={i}>{i === homeGuide.heading.length - 1 ? <em>{line}</em> : line}</span>
            ))}
          </h2>
          <p className="home-guide-lede" data-testid="home-guide-lede">{homeGuide.lede}</p>
          {homeGuide.paragraphs.map((text, i) => <p className="home-guide-body" key={i}>{text}</p>)}
          <Link to="/contact" className="btn-text mt-8" data-testid="home-guide-cta">
            Tell us about your space<ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>

        <aside className="home-guide-aside" aria-label="Interior design services and service areas">
          <h3 className="home-guide-subheading">{homeGuide.capabilitiesHeading}</h3>
          <ul className="home-guide-capabilities">
            {homeGuide.capabilities.map((item) => (
              <li key={item.to}>
                <Link to={item.to} data-testid={`home-guide-link-${item.to.split("/").pop()}`}>
                  <span className="home-guide-capability-title">{item.title}<ArrowUpRight className="h-3.5 w-3.5" strokeWidth={1.4} /></span>
                  <span className="home-guide-capability-line">{item.line}</span>
                </Link>
              </li>
            ))}
          </ul>

          <h3 className="home-guide-subheading mt-10">{homeGuide.areasHeading}</h3>
          <p className="home-guide-areas-lede">{homeGuide.areasLede}</p>
          <ul className="home-guide-areas" data-testid="home-guide-areas">
            {site.serviceAreas.map((area) => <li key={area}>{area}</li>)}
          </ul>
        </aside>
      </div>

      <section className="home-guide-faq" aria-labelledby="home-guide-faq-heading">
        <div className="home-guide-faq-intro">
          <p className="editorial-label">Before we begin</p>
          <h3 id="home-guide-faq-heading" className="home-guide-faq-heading" data-testid="home-guide-faq-heading">Common questions</h3>
          <p>Clear answers to the practical questions homeowners ask before an interior project begins.</p>
        </div>
        <div className="home-guide-faq-list">
          {homeFaqs.map((faq, faqIndex) => (
            <details className="home-guide-faq-item" open={faqIndex === 0} key={faq.q}>
              <summary>
                <span>{faq.q}</span>
                <span className="home-guide-faq-icon" aria-hidden="true" />
              </summary>
              <p>{faq.a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  </section>
);
