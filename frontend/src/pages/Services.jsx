import { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { useLenis } from "lenis/react";
import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { PageHero } from "@/components/ui-custom/PageHero";
import { Reveal, SplitLines } from "@/components/motion/Reveal";
import { Picture } from "@/components/motion/Picture";
import { CtaBand } from "@/components/ui-custom/CtaBand";
import { WhatsAppIcon } from "@/components/ui-custom/WhatsAppIcon";
import { services } from "@/content/services";
import { site } from "@/content/site";
import { waLink } from "@/lib/contact";
import { cn } from "@/lib/utils";

const CRUMBS = [{ name: "Home", path: "/" }, { name: "Services", path: "/services" }];

const ORIGIN = String(site.url || "").replace(/\/+$/, "");

// Declares the service set as one list so crawlers can see the hub-and-spoke
// relationship between /services and each /services/<slug> page.
const SERVICES_JSONLD = [
  {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "@id": `${ORIGIN}/services#servicelist`,
    name: "Interior design and furniture services in Nashik",
    itemListElement: services.map((service, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: service.title,
      url: `${ORIGIN}/services/${service.slug}`,
    })),
  },
];

const ServiceSection = ({ service, index }) => {
  const flipped = index % 2 === 1;
  return (
    <section id={service.slug} data-testid={`service-section-${service.slug}`} className="scroll-mt-24 border-t border-line">
      <div className={cn("container-x service-section-inner", flipped && "is-flipped")}>
        <figure className="service-media"><Reveal><Picture image={service.image} ratio="4 / 5" sizes="(min-width:1024px) 50vw,100vw" className="service-photo" /></Reveal><figcaption className="atelier-caption"><span>Suvi / {service.title}</span><span>Design &amp; make</span></figcaption></figure>
        <div className="service-copy">
          <Reveal><p className="editorial-label text-oxblood">{service.number} / Tailored to your home</p></Reveal>
          <SplitLines as="h2" lines={[service.title]} className="editorial-heading mt-7" data-testid={`service-heading-${service.slug}`} />
          <Reveal delay={.15} className="mt-7"><p className="lede">{service.description}</p></Reveal>
          <Reveal delay={.2} className="service-detail-grid"><div><p className="label text-taupe">Key features</p><ul className="service-feature-list">{service.features.map((feature) => <li key={feature}>{feature}</li>)}</ul></div><div><p className="label text-taupe">Ideal for</p><ul className="service-ideal-list">{service.idealFor.map((item) => <li key={item}>{item}</li>)}</ul></div></Reveal>
          <Reveal delay={.25} className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4 border-t border-line pt-6"><Link to={`/services/${service.slug}`} data-testid={`service-more-${service.slug}`} className="btn-brand">{service.title} in Nashik<ArrowRight className="h-4 w-4" /></Link><Link to={`/contact?type=${encodeURIComponent(service.projectType)}`} data-testid={`service-cta-${service.slug}`} className="arrow-link text-charcoal">Discuss this service</Link>{site.whatsapp.enabled && <a href={waLink(`Hi Suvi Interior, I'm interested in ${service.title.toLowerCase()} for my home and would like to discuss.`)} target="_blank" rel="noopener noreferrer" data-testid={`service-whatsapp-${service.slug}`} className="arrow-link text-charcoal"><WhatsAppIcon className="h-3.5 w-3.5" />WhatsApp</a>}</Reveal>
        </div>
      </div>
    </section>
  );
};

export default function Services() {
  const { hash } = useLocation();
  const lenis = useLenis();

  useEffect(() => {
    if (!hash) return;
    let id;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const element = document.getElementById(id);
    if (!element) return;
    const frame = requestAnimationFrame(() => {
      const offset = parseFloat(getComputedStyle(element).scrollMarginTop) || 0;
      if (lenis) { lenis.resize(); const top = element.getBoundingClientRect().top + window.scrollY - offset; lenis.scrollTo(top, { immediate: true, force: true }); }
      else element.scrollIntoView({ block: "start", behavior: "auto" });
    });
    return () => cancelAnimationFrame(frame);
  }, [hash, lenis]);

  return (
    <PageWrap theme="light" testId="services-page">
      <Seo title="Interior Design & Modular Furniture Services in Nashik" description="Modular kitchens, living spaces, bedroom interiors, TV & wall systems, custom furniture and complete home interiors — designed and manufactured by Suvi Interior in Nashik." path="/services" crumbs={CRUMBS} jsonLd={SERVICES_JSONLD} />
      <PageHero label="02 / Design & make" lines={["Made for", <em>real living.</em>]} text="From one beautifully resolved piece to a home that works as a whole. Six considered ways to work with Suvi." />
      <section className="services-index"><div className="container-x route-section"><div className="chapter-top"><p className="editorial-label">The service collection</p><p>Begin with a room, a piece, or the complete home. The same design discipline carries through.</p></div><ol className="services-index-grid">{services.map((service) => <li key={service.slug}><Link to={`/services/${service.slug}`} data-testid={`service-index-${service.slug}`} className="services-index-card group"><Picture image={service.image} ratio="4 / 3" sizes="(min-width:1024px) 30vw,(min-width:560px) 50vw,120px" className="editorial-image" /><span className="service-index-link"><span className="flex items-center gap-3"><span className="text-[10px] text-oxblood/55">{service.number}</span>{service.title}</span><ArrowRight className="h-4 w-4 shrink-0" /></span></Link></li>)}</ol></div></section>
      <div className="service-catalogue">{services.map((service, index) => <ServiceSection key={service.slug} service={service} index={index} />)}</div>
      <CtaBand lines={["Not sure where", <em>to begin?</em>]} text="Tell us what you have in mind and we'll help you find the right starting point." />
    </PageWrap>
  );
}
