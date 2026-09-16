import { useRef } from "react";
import { Link, NavLink } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, BookOpen, Phone, X } from "lucide-react";
import { Wordmark } from "@/components/ui-custom/Wordmark";
import { WhatsAppIcon } from "@/components/ui-custom/WhatsAppIcon";
import { mobileNav, site } from "@/content/site";
import { telLink, waLink } from "@/lib/contact";
import { useMenuDialog } from "@/hooks/useMenuDialog";
import { EASE } from "@/lib/motion";

const panelVariants = {
  hidden: { y: "-100%" },
  visible: { y: 0, transition: { duration: .62, ease: EASE } },
  exit: { y: "-100%", transition: { duration: .5, ease: EASE } },
};

const contentVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: .38, ease: EASE, delayChildren: .12, staggerChildren: .035 },
  },
  exit: {
    opacity: 0,
    y: -8,
    transition: { duration: .16, ease: EASE, staggerChildren: .012, staggerDirection: -1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: { duration: .42, ease: EASE } },
  exit: { opacity: 0, y: -5, transition: { duration: .12 } },
};

export const MobileMenu = ({ onClose }) => {
  const dialog = useRef(null);
  const reduce = useReducedMotion();
  useMenuDialog(dialog, onClose);

  const panelMotion = reduce
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { variants: panelVariants, initial: "hidden", animate: "visible", exit: "exit" };

  return (
    <motion.div
      ref={dialog}
      id="mobile-menu"
      data-testid="mobile-menu"
      role="dialog"
      aria-modal="true"
      aria-label="Site navigation"
      className="site-menu"
      data-lenis-prevent
      {...panelMotion}
    >
      <div className="site-menu-top container-x">
        <Link to="/" onClick={onClose} data-testid="mobile-menu-logo" aria-label="Suvi Interior — Home"><Wordmark data-testid="mobile-menu-wordmark" /></Link>
        <button type="button" onClick={onClose} data-testid="mobile-menu-close" aria-label="Close navigation" className="site-menu-close">
          <span>Close</span><span className="site-menu-close-icon" aria-hidden="true"><X className="h-5 w-5" strokeWidth={1.3} /></span>
        </button>
      </div>

      <motion.div
        className="container-x site-menu-content"
        variants={reduce ? undefined : contentVariants}
        initial={reduce ? false : undefined}
      >
        <div className="site-menu-heading">
          <p className="editorial-label text-brass" data-testid="mobile-menu-label">The studio index</p>
          <p className="site-menu-intro">Interiors and furniture shaped around the way you live.</p>
        </div>
        <nav aria-label="Mobile" data-testid="mobile-menu-nav">
          {mobileNav.map((item, index) => (
            <motion.div key={item.to} variants={reduce ? undefined : itemVariants}>
              <NavLink to={item.to} onClick={onClose} data-testid={`mobile-nav-link-${item.label.toLowerCase()}`} className={({ isActive }) => `site-menu-link ${isActive ? "is-current" : ""}`}>
                <span className="site-menu-index" aria-hidden="true">0{index + 1}</span><span>{item.label}</span><ArrowUpRight className="ml-auto h-5 w-5" strokeWidth={1.2} />
              </NavLink>
            </motion.div>
          ))}
        </nav>
        <motion.div className="site-menu-secondary" variants={reduce ? undefined : itemVariants}>
          <Link to="/contact" onClick={onClose} data-testid="mobile-menu-cta" className="site-menu-project">Plan your project<ArrowUpRight className="h-4 w-4" /></Link>
          <div className="site-menu-contacts">
            <a href={telLink()} onClick={onClose} data-testid="mobile-menu-call"><Phone className="h-4 w-4" strokeWidth={1.4} />Call</a>
            {site.whatsapp.enabled ? (
              <a href={waLink()} onClick={onClose} target="_blank" rel="noopener noreferrer" data-testid="mobile-menu-whatsapp"><WhatsAppIcon className="h-4 w-4" />WhatsApp</a>
            ) : null}
            <Link to="/brochure" onClick={onClose} data-testid="mobile-menu-brochure"><BookOpen className="h-4 w-4" strokeWidth={1.4} />Brochure</Link>
          </div>
          <p className="site-menu-location" data-testid="mobile-menu-location">Studio in {site.address.short}</p>
        </motion.div>
      </motion.div>
    </motion.div>
  );
};
