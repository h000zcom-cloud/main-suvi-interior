import { useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useInView, useReducedMotion } from "framer-motion";
import { useLenis } from "lenis/react";
import { ArrowUpRight, ArrowUp } from "lucide-react";
import { Wordmark } from "@/components/ui-custom/Wordmark";
import { DownloadButton } from "@/components/brochure/DownloadButton";
import { site, mobileNav } from "@/content/site";
import { directionsLink, telLink, waLink } from "@/lib/contact";
import { EASE } from "@/lib/motion";

export const Footer = () => {
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, amount: .08 });
  const reduce = useReducedMotion();
  const lenis = useLenis();
  const reveal = (delay) => ({
    initial: reduce ? false : { opacity: 0, y: 18 },
    animate: { opacity: seen || reduce ? 1 : 0, y: seen || reduce ? 0 : 18 },
    transition: { duration: reduce ? 0 : .9, ease: EASE, delay: reduce ? 0 : delay },
  });

  const backToTop = () => {
    if (lenis) lenis.scrollTo(0, { duration: 1.2, immediate: !!reduce, force: true });
    else window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    document.querySelector("[data-testid='header-logo']")?.focus({ preventScroll: true });
  };

  return (
    <footer id="site-footer" ref={ref} className="atelier-footer" aria-label="Suvi Interior footer" data-testid="site-footer">
      <div className="container-x">
        <div className="footer-overline">
          <p data-testid="footer-overline">Thoughtfully designed. Precisely made.</p>
          <p>{site.city} · {site.region} · India</p>
        </div>

        <div className="footer-grid">
          <motion.section {...reveal(0)} className="footer-studio" aria-label="About Suvi Interior">
            <Link to="/" data-testid="footer-logo" aria-label="Suvi Interior — Home">
              <Wordmark variant="footer" data-testid="footer-wordmark" />
            </Link>
            <p className="footer-description" data-testid="footer-description">Let’s shape what home feels like.</p>
            <p className="footer-note">Interior design and custom furniture,<br />considered together by one studio.</p>
            <Link to="/contact" data-testid="footer-cta" className="footer-inquiry">
              Tell us about your space<ArrowUpRight className="h-4 w-4" strokeWidth={1.4} />
            </Link>
          </motion.section>

          <motion.div {...reveal(.07)} className="footer-directory">
            <p id="footer-explore-heading" className="footer-heading" data-testid="footer-explore-heading">Explore</p>
            <nav aria-labelledby="footer-explore-heading" data-testid="footer-nav">
              {mobileNav.map((item) => (
                <Link key={item.to} to={item.to} className="footer-link" data-testid={`footer-nav-${item.label.toLowerCase()}`}>
                  {item.label}
                </Link>
              ))}
            </nav>
          </motion.div>

          <motion.section {...reveal(.14)} className="footer-visit" aria-labelledby="footer-visit-heading">
            <p id="footer-visit-heading" className="footer-heading" data-testid="footer-visit-heading">Visit the studio</p>
            <address data-testid="footer-address">{site.address.lines.map((line) => <span key={line}>{line}</span>)}</address>
            <a href={directionsLink()} target="_blank" rel="noopener noreferrer" className="footer-direction" data-testid="footer-location">
              Get directions<ArrowUpRight className="h-3.5 w-3.5" />
            </a>
            <div className="footer-contact-links">
              <a href={telLink()} className="footer-phone" data-testid="footer-phone">{site.phone.display}</a>
              {site.whatsapp.enabled ? (
                <a href={waLink()} target="_blank" rel="noopener noreferrer" className="footer-link" data-testid="footer-whatsapp">Message us on WhatsApp ↗</a>
              ) : null}
            </div>
          </motion.section>

          <motion.section {...reveal(.21)} className="footer-publication" aria-labelledby="footer-publication-heading">
            <p id="footer-publication-heading" className="footer-heading" data-testid="footer-publication-heading">The studio edition</p>
            <Link to="/brochure" className="footer-publication-preview" data-testid="footer-brochure-preview" aria-label="Preview the studio brochure">
              <img src="/brochures/previews/page-1.jpg" alt="Suvi Interior studio brochure cover" loading="lazy" width="210" height="297" />
              <span>Seven pages of<br />the Suvi approach.<ArrowUpRight className="mt-3 h-4 w-4" strokeWidth={1.2} /></span>
            </Link>
            <DownloadButton className="footer-download" testId="footer-brochure-download" />
            <p className="footer-file-meta" data-testid="footer-brochure-info">PDF · 7 pages · 3 MB</p>
          </motion.section>
        </div>

        <motion.div {...reveal(.12)} className="footer-signature" aria-hidden="true" data-testid="footer-signature">
          <Wordmark variant="signature" />
        </motion.div>

        <div className="footer-bottom">
          <small className="footer-copyright" data-testid="footer-copyright">© {new Date().getFullYear()} Suvi Interior. All rights reserved.</small>
          <nav aria-label="Legal" className="footer-legal">
            <Link to="/privacy" data-testid="footer-privacy">Privacy</Link>
            <Link to="/terms" data-testid="footer-terms">Terms</Link>
          </nav>
          <button type="button" onClick={backToTop} className="footer-back-top" aria-label="Back to top of page" data-testid="footer-back-to-top">
            <span>Back to top</span><ArrowUp className="h-4 w-4" strokeWidth={1.3} />
          </button>
        </div>
      </div>
    </footer>
  );
};
