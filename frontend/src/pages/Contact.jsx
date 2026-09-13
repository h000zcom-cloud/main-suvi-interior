import { useSearchParams } from "react-router-dom";
import { ArrowUpRight, Phone, MapPin } from "lucide-react";
import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { PageHero } from "@/components/ui-custom/PageHero";
import { EnquiryForm } from "@/components/contact/EnquiryForm";
import { site } from "@/content/site";
import { directionsLink, mapEmbedUrl, telLink, waLink } from "@/lib/contact";

export default function Contact() {
  const [params] = useSearchParams();
  return (
    <PageWrap testId="contact-page">
      <Seo title="Let's Begin — Contact Suvi Interior" description={`Start your interior project with Suvi Interior, Nashik. Call ${site.phone.display}, WhatsApp us or request a consultation.`} path="/contact" crumbs={[{ name: "Home", path: "/" }, { name: "Contact", path: "/contact" }]} />
      <PageHero label="07 / Begin a conversation" lines={["Your home.", <em>Our next conversation.</em>]} text="A new home, a room to rethink, or a piece you cannot quite find. Tell us where you are and we’ll begin there." />
      <section className="container-x contact-layout">
        <aside className="contact-sidebar"><p className="contact-intro">Every considered space starts with listening.</p><div className="contact-detail-card"><p className="editorial-label mb-5 text-oxblood">Speak with the studio</p><a href={telLink()} className="font-display text-[clamp(1.9rem,3vw,2.8rem)] leading-none text-oxblood" data-testid="contact-phone">{site.phone.display}</a><div className="mt-6 flex flex-wrap gap-x-6 gap-y-2"><a href={telLink()} className="btn-text" data-testid="contact-call-button"><Phone className="h-4 w-4" />Call</a><a href={waLink()} target="_blank" rel="noopener noreferrer" className="btn-text" data-testid="contact-whatsapp-button">WhatsApp<ArrowUpRight className="h-4 w-4" /></a></div></div><div className="contact-detail-card"><p className="editorial-label mb-5 text-oxblood">Visit the studio</p><address className="text-sm not-italic leading-[1.85] text-taupe" data-testid="contact-address">{site.address.lines.map((line) => <span key={line} className="block">{line}</span>)}</address><a href={directionsLink()} target="_blank" rel="noopener noreferrer" data-testid="contact-directions-button" className="btn-text mt-5">Get directions<MapPin className="h-4 w-4" /></a></div></aside>
        <div className="contact-form-panel consultation-form"><div className="mb-10"><p className="editorial-label text-oxblood">Your project</p><h2 className="mt-5 max-w-[12ch] font-display text-[clamp(2.2rem,4vw,4rem)] leading-[.98] text-oxblood" data-testid="consultation-heading">Let’s get to know your space.</h2><p className="mt-5 max-w-lg text-sm leading-relaxed text-taupe">Share as much or as little as you know. The first conversation is simply a place to understand what you need.</p></div><EnquiryForm key={params.get("type")} presetType={params.get("type")} /></div>
      </section>
      <section className="contact-map-section"><div className="container-x route-section"><div className="mb-7 flex flex-wrap items-end justify-between gap-5"><div><p className="editorial-label text-oxblood">Suvi Interior / Nashik</p><h2 className="mt-4 font-display text-4xl text-oxblood">Come by the studio.</h2></div><a href={directionsLink()} target="_blank" rel="noopener noreferrer" data-testid="map-directions" className="btn-text">Open in Google Maps<ArrowUpRight className="h-4 w-4" /></a></div><div className="contact-map-shell"><iframe title="Suvi Interior on Google Maps" src={mapEmbedUrl()} loading="lazy" referrerPolicy="no-referrer-when-downgrade" className="map-frame h-[340px] w-full border-0 md:h-[480px]" data-testid="contact-map" /></div></div></section>
    </PageWrap>
  );
}
