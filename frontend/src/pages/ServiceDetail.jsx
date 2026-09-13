import { useMemo } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { PageHero } from "@/components/ui-custom/PageHero";
import { Reveal, SplitLines } from "@/components/motion/Reveal";
import { Picture } from "@/components/motion/Picture";
import { CtaBand } from "@/components/ui-custom/CtaBand";
import { WhatsAppIcon } from "@/components/ui-custom/WhatsAppIcon";
import { services, getService } from "@/content/services";
import { projects } from "@/content/projects";
import { site } from "@/content/site";
import { waLink } from "@/lib/contact";

const ORIGIN = String(site.url || "").replace(/\/+$/, "");

export default function ServiceDetail() {
  const { slug = "" } = useParams();
  const service = getService(slug);

  const jsonLd = useMemo(() => {
    if (!service) return [];
    const url = `${ORIGIN}/services/${service.slug}`;
    const graph = [
      {
        "@context": "https://schema.org",
        "@type": "Service",
        "@id": `${url}#service`,
        name: service.title,
        serviceType: service.title,
        description: service.description,
        url,
        provider: { "@id": `${ORIGIN}/#business` },
        areaServed: (site.serviceAreas || [site.city]).map((name) => ({ "@type": "City", name })),
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: `${service.title} — what is included`,
          itemListElement: service.features.map((feature) => ({
            "@type": "Offer",
            itemOffered: { "@type": "Service", name: feature },
          })),
        },
      },
    ];

    if (service.faqs && service.faqs.length) {
      graph.push({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: service.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: { "@type": "Answer", text: faq.a },
        })),
      });
    }

    return graph;
  }, [service]);

  if (!service) return <Navigate to="/services" replace />;

  const related = projects.filter((project) => project.category === service.relatedCategory).slice(0, 3);
  const others = services.filter((item) => item.slug !== service.slug);
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Services", path: "/services" },
    { name: service.title, path: `/services/${service.slug}` },
  ];

  return (
    <PageWrap theme="light" testId={`service-detail-${service.slug}`}>
      <Seo
        title={service.seoTitle}
        description={service.seoDescription}
        path={`/services/${service.slug}`}
        image={service.image}
        crumbs={crumbs}
        jsonLd={jsonLd}
      />
      <PageHero
        label={`${service.number} / Service`}
        lines={service.h1}
        image={service.image}
        text={service.intro}
      />

      <section className="route-section">
        <div className="container-x">
          <Link to="/services" className="btn-text mb-10" data-testid="service-detail-back">
            <ArrowLeft className="h-4 w-4" />All services
          </Link>
          <div className="chapter-top">
            <p className="editorial-label">What this covers</p>
            <p>{service.description}</p>
          </div>
          <div className="service-detail-grid">
            <div>
              <p className="label text-taupe">Key features</p>
              <ul className="service-feature-list">
                {service.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="label text-taupe">Ideal for</p>
              <ul className="service-ideal-list">
                {service.idealFor.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4 border-t border-line pt-6">
            <Link
              to={`/contact?type=${encodeURIComponent(service.projectType)}`}
              className="btn-brand"
              data-testid="service-detail-cta"
            >
              Discuss this service<ArrowRight className="h-4 w-4" />
            </Link>
            {site.whatsapp.enabled && (
              <a
                href={waLink(`Hi Suvi Interior, I'm interested in ${service.title.toLowerCase()} for my home in Nashik and would like to discuss.`)}
                target="_blank"
                rel="noopener noreferrer"
                className="arrow-link text-charcoal"
                data-testid="service-detail-whatsapp"
              >
                <WhatsAppIcon className="h-3.5 w-3.5" />WhatsApp
              </a>
            )}
            <a href={`tel:${site.phone.tel}`} className="arrow-link text-charcoal" data-testid="service-detail-call">
              Call {site.phone.display}
            </a>
          </div>
        </div>
      </section>

      <section className="border-t border-line">
        <div className="container-x route-section">
          <figure>
            <Reveal>
              <Picture image={service.secondary} ratio="16 / 9" sizes="100vw" className="editorial-image" />
            </Reveal>
            <figcaption className="atelier-caption">
              <span>Suvi / {service.title}</span>
              <span>{site.city} · Design &amp; make</span>
            </figcaption>
          </figure>
        </div>
      </section>

      {service.faqs && service.faqs.length > 0 && (
        <section className="border-t border-line" data-testid="service-detail-faq">
          <div className="container-x route-section">
            <div className="chapter-top">
              <p className="editorial-label">Common questions</p>
              <p>Answers to what homeowners in {site.city} ask us most about this service.</p>
            </div>
            <dl className="legal-prose mt-9">
              {service.faqs.map((faq) => (
                <div key={faq.q} className="border-t border-line py-7">
                  <dt>
                    <SplitLines as="h2" lines={[faq.q]} className="editorial-heading text-[1.35rem]" />
                  </dt>
                  <dd className="mt-4 max-w-2xl">{faq.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {related.length > 0 && (
        <section className="border-t border-line">
          <div className="container-x route-section">
            <div className="chapter-top">
              <p className="editorial-label">Related work</p>
              <p>{site.imageryNotice}</p>
            </div>
            <ol className="services-index-grid">
              {related.map((project) => (
                <li key={project.slug}>
                  <Link
                    to={`/projects/${project.slug}`}
                    className="services-index-card group"
                    data-testid={`service-related-${project.slug}`}
                  >
                    <Picture
                      image={project.hero}
                      ratio="4 / 3"
                      sizes="(min-width:1024px) 30vw,(min-width:560px) 50vw,120px"
                      className="editorial-image"
                    />
                    <span className="service-index-link">
                      <span>{project.title}</span>
                      <ArrowRight className="h-4 w-4 shrink-0" />
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </div>
        </section>
      )}

      <section className="border-t border-line">
        <div className="container-x route-section">
          <div className="chapter-top">
            <p className="editorial-label">Other services</p>
            <p>The same design and manufacturing discipline, applied to the rest of the home.</p>
          </div>
          <ol className="services-index-grid">
            {others.map((item) => (
              <li key={item.slug}>
                <Link
                  to={`/services/${item.slug}`}
                  className="services-index-card group"
                  data-testid={`service-other-${item.slug}`}
                >
                  <Picture
                    image={item.image}
                    ratio="4 / 3"
                    sizes="(min-width:1024px) 30vw,(min-width:560px) 50vw,120px"
                    className="editorial-image"
                  />
                  <span className="service-index-link">
                    <span className="flex items-center gap-3">
                      <span className="text-[10px] text-oxblood/55">{item.number}</span>
                      {item.title}
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <CtaBand
        lines={[`Planning ${service.title.toLowerCase()}`, <em key="cta">in Nashik?</em>]}
        text="Tell us about your space and we'll suggest the right starting point."
      />
    </PageWrap>
  );
}
