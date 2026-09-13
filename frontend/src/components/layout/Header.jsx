import { Link, NavLink } from "react-router-dom";
import { ArrowUpRight, Phone } from "lucide-react";
import { nav, site } from "@/content/site";
import { telLink } from "@/lib/contact";
import { useHeaderSurface } from "@/hooks/useHeaderSurface";
import { Wordmark } from "@/components/ui-custom/Wordmark";

export const Header = ({ menuOpen, onToggle }) => {
  const surface = useHeaderSurface(menuOpen);
  return (
    <header className="atelier-header" data-surface={surface} data-testid="site-header">
      <div className="container-x header-inner">
        <Link to="/" data-testid="header-logo" aria-label="Suvi Interior — Home" className="header-brand">
          <Wordmark data-testid="header-wordmark" />
        </Link>
        <nav aria-label="Primary" className="header-navigation" data-testid="header-nav">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to} data-testid={`nav-link-${item.label.toLowerCase()}`} className={({ isActive }) => `atelier-nav ${isActive ? "is-current" : ""}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="header-actions">
          <a href={telLink()} className="header-call" aria-label={`Call Suvi Interior: ${site.phone.display}`} title={site.phone.display} data-testid="header-phone">
            <Phone className="h-4 w-4" strokeWidth={1.4} />
          </a>
          <Link to="/contact" data-testid="header-cta" className="header-project-link">
            <span>Plan your project</span><ArrowUpRight className="h-4 w-4" strokeWidth={1.4} />
          </Link>
          <button type="button" onClick={onToggle} data-testid="mobile-menu-button" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="mobile-menu" className="header-menu-toggle">
            <span>Menu</span><span className="menu-glyph" aria-hidden="true"><span /><span /></span>
          </button>
        </div>
      </div>
    </header>
  );
};
