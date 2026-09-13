import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Plus, Minus } from "lucide-react";
import { Picture } from "@/components/motion/Picture";
import { services } from "@/content/services";

export const ServicesList = () => {
  const [active, setActive] = useState(0);
  const preview = services[Math.max(active, 0)];

  return (
    <section className="home-services" data-testid="services-section">
      <div className="container-x section">
        <div className="chapter-top"><p className="editorial-label">03 / The complete offering</p><Link to="/services" data-testid="services-all-link" className="btn-text">Explore all services<ArrowUpRight className="h-4 w-4" /></Link></div>
        <div className="home-services-grid">
          <div className="home-services-heading">
            <h2 className="editorial-heading text-oxblood" data-testid="services-heading">One vision. Every room <em>resolved.</em></h2>
            <p className="home-services-intro">From a singular piece of furniture to an entire residence, design and making stay connected from the first conversation onward.</p>
            <div className="home-services-preview hidden lg:block" data-testid="services-preview"><Picture image={preview.image} ratio="4 / 3" sizes="42vw" /><p className="mt-5 max-w-md text-sm leading-relaxed text-taupe" data-testid="services-preview-description">{preview.short}</p></div>
          </div>
          <div className="home-services-list" data-testid="services-accordion">{services.map((service, index) => <div key={service.slug} className="home-service-row">
            <Link to={`/services#${service.slug}`} onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)} data-testid={`service-row-${service.slug}`} className="home-service-desktop group"><span className="w-8 text-[10px] text-oxblood/55">{service.number}</span><span className="font-display text-[clamp(2rem,3vw,3.2rem)] leading-none transition-transform duration-300 group-hover:translate-x-2">{service.title}</span><ArrowUpRight className="ml-auto h-5 w-5 shrink-0" strokeWidth={1.3} /></Link>
            <button type="button" onClick={() => setActive(active === index ? -1 : index)} aria-expanded={active === index} aria-controls={`service-panel-${service.slug}`} data-testid={`service-toggle-${service.slug}`} className="home-service-mobile"><span className="text-[10px] opacity-60">{service.number}</span><span className="font-display text-2xl leading-none">{service.title}</span>{active === index ? <Minus className="ml-auto h-4 w-4" /> : <Plus className="ml-auto h-4 w-4" />}</button>
            {active === index && <div id={`service-panel-${service.slug}`} className="home-service-panel lg:hidden" data-testid={`service-panel-${service.slug}`}><Picture image={service.image} ratio="4 / 3" /><p className="mt-4 text-sm leading-relaxed text-taupe">{service.short}</p><Link to={`/services#${service.slug}`} data-testid={`service-mobile-link-${service.slug}`} className="btn-brand mobile-service-link mt-5">Explore service<ArrowUpRight className="h-4 w-4" /></Link></div>}
          </div>)}</div>
        </div>
      </div>
    </section>
  );
};
