import { ArrowRight, Phone, MapPin } from "lucide-react";
import { Reveal, SplitLines } from "@/components/motion/Reveal";
import { WhatsAppIcon } from "@/components/ui-custom/WhatsAppIcon";
import { site } from "@/content/site";
import { directionsLink, mapEmbedUrl, telLink, waLink } from "@/lib/contact";

export const Studio = ({ index = "07" }) => (
  <section id="studio" data-testid="studio-section" className="home-studio scroll-mt-24 border-t border-line">
    <div className="container-x section">
      <div className="chapter-top"><p className="editorial-label">{index} / The Nashik studio</p><p>The best projects begin with a useful conversation—about your home, your routines and what should feel different.</p></div>
      <div className="home-studio-grid">
        <div className="home-studio-copy">
          <SplitLines as="h2" lines={["A conversation.", <em>A visit. A beginning.</em>]} className="editorial-heading max-w-[10ch] text-oxblood" data-testid="studio-heading" />
          <Reveal delay={.15} className="home-studio-card mt-10">
            <p className="label text-taupe">Visit or call the studio</p>
            <address className="mt-5 text-sm not-italic leading-[1.85]" data-testid="studio-address"><span className="mb-1 block font-semibold text-charcoal">{site.name}</span>{site.address.lines.map((line) => <span key={line} className="block text-taupe">{line}</span>)}</address>
            <a href={telLink()} data-testid="studio-phone" className="link-underline mt-7 inline-block font-display text-[clamp(1.8rem,3vw,2.8rem)] leading-none text-oxblood">{site.phone.display}</a>
            <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-line pt-5"><a href={directionsLink()} target="_blank" rel="noopener noreferrer" data-testid="studio-directions" className="btn-text">Get directions<ArrowRight className="h-4 w-4" /></a><a href={telLink()} data-testid="studio-call" className="arrow-link text-charcoal"><Phone className="h-3.5 w-3.5" />Call</a>{site.whatsapp.enabled && <a href={waLink()} target="_blank" rel="noopener noreferrer" data-testid="studio-whatsapp" className="arrow-link text-charcoal"><WhatsAppIcon className="h-3.5 w-3.5" />WhatsApp</a>}</div>
          </Reveal>
          {site.googleReviews.enabled && <Reveal delay={.25} className="mt-10 border-t border-line pt-6" data-testid="google-reviews"><p className="font-display text-5xl leading-none">{site.googleReviews.rating} <span className="text-2xl text-taupe">/ 5</span></p><p className="label mt-3 text-taupe">Google Reviews{site.googleReviews.count ? ` · ${site.googleReviews.count} reviews` : ""}</p>{site.googleReviews.url && <a href={site.googleReviews.url} target="_blank" rel="noopener noreferrer" className="link-underline mt-3 inline-block text-sm">Read reviews on Google</a>}</Reveal>}
        </div>
        <Reveal delay={.15} className="home-studio-visual">
          <div className="home-studio-map"><iframe title="Suvi Interior location map" src={mapEmbedUrl()} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="map-frame absolute inset-0 h-full w-full border-0" data-testid="studio-map" /><div className="pointer-events-none absolute inset-0 border-[10px] border-ivory sm:border-[16px]" aria-hidden="true" /></div>
          <div className="mt-4 flex items-start justify-between gap-4 text-xs leading-relaxed text-taupe"><p className="flex items-start gap-2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-burgundy" strokeWidth={1.5} />Opp. Rajat Park, Ambad–Uttam Nagar Road, Nashik 422010</p><span className="hidden text-oxblood sm:block">20.0° N / 73.8° E</span></div>
        </Reveal>
      </div>
    </div>
  </section>
);
