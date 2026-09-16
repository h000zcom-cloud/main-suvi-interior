import { useEffect } from "react";
import { site } from "@/content/site";
import { imgUrl } from "@/lib/images";

// NOTE: keep the per-route title/description strings here in sync with
// frontend/seo/routes.json, which the build-time generator uses to write the same
// values into static HTML for crawlers that do not execute JavaScript.

const DEFAULT_TITLE = "Suvi Interior | Interior Designers in Nashik — Kitchens, Custom Furniture & Home Interiors";

// Canonical origin is fixed to the production domain so preview and *.vercel.app
// deployments never emit competing canonicals for the same content.
const ORIGIN = String(site.url || "").replace(/\/+$/, "");

const absolute = (pathOrUrl) => {
  if (!pathOrUrl) return "";
  // Coerce defensively: a non-string here used to throw and take down the whole route.
  const value = typeof pathOrUrl === "string" ? pathOrUrl : String(pathOrUrl);
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${ORIGIN}${value.startsWith("/") ? "" : "/"}${value}`;
};

// The `image` prop may be a URL string or a content image object ({ src } or { id }),
// because content modules describe images as objects for the <Picture> pipeline.
const imageSource = (image) => {
  if (!image) return "";
  if (typeof image === "string") return image;
  if (typeof image !== "object") return "";
  const resolved = imgUrl(image, 1200);
  return typeof resolved === "string" ? resolved : "";
};

const setMeta = (attr, key, content) => {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`);
  if (!content) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

const setLink = (rel, href, hreflang) => {
  const selector = hreflang ? `link[rel="${rel}"][hreflang="${hreflang}"]` : `link[rel="${rel}"]`;
  let el = document.head.querySelector(selector);
  if (!href) {
    if (el) el.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    if (hreflang) el.setAttribute("hreflang", hreflang);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

const postalAddress = () => ({
  "@type": "PostalAddress",
  streetAddress: site.address.streetAddress,
  addressLocality: site.city,
  addressRegion: site.region,
  postalCode: site.postalCode,
  addressCountry: site.country,
});

const organization = () => ({
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${ORIGIN}/#organization`,
  name: site.name,
  url: `${ORIGIN}/`,
  description: site.description,
  logo: { "@type": "ImageObject", url: absolute(site.ogImage) },
  image: absolute(site.ogImage),
  telephone: site.phone.tel,
  address: postalAddress(),
  ...(site.email ? { email: site.email } : {}),
  ...(Object.values(site.social || {}).some(Boolean)
    ? { sameAs: Object.values(site.social).filter(Boolean) }
    : {}),
});

// LocalBusiness drives the map/local pack. additionalType points at the Wikidata entity
// for interior design because schema.org has no dedicated interior-design business type.
const localBusiness = () => ({
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "HomeAndConstructionBusiness"],
  "@id": `${ORIGIN}/#business`,
  additionalType: "https://www.wikidata.org/wiki/Q1474884",
  name: site.name,
  description: site.description,
  url: `${ORIGIN}/`,
  telephone: site.phone.tel,
  image: absolute(site.ogImage),
  parentOrganization: { "@id": `${ORIGIN}/#organization` },
  address: postalAddress(),
  areaServed: (site.serviceAreas || [site.city]).map((name) => ({ "@type": "City", name })),
  knowsAbout: [
    "Interior Design",
    "Modular Kitchens",
    "Custom Furniture",
    "TV Units and Wall Systems",
    "Bedroom Interiors",
    "Furniture Manufacturing",
  ],
  ...(site.geo && site.geo.latitude != null && site.geo.longitude != null
    ? { geo: { "@type": "GeoCoordinates", latitude: site.geo.latitude, longitude: site.geo.longitude } }
    : {}),
  ...(site.mapsQuery
    ? { hasMap: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(site.mapsQuery)}` }
    : {}),
  ...(site.hours && site.hours.length ? { openingHours: site.hours.map((h) => `${h.days} ${h.time}`) } : {}),
  ...(site.googleReviews && site.googleReviews.enabled && site.googleReviews.rating && site.googleReviews.count
    ? {
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: site.googleReviews.rating,
          reviewCount: site.googleReviews.count,
        },
      }
    : {}),
  ...(Object.values(site.social || {}).some(Boolean) || site.googleBusinessProfile
    ? {
        sameAs: [...Object.values(site.social || {}), site.googleBusinessProfile].filter(Boolean),
      }
    : {}),
});

const website = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${ORIGIN}/#website`,
  url: `${ORIGIN}/`,
  name: site.name,
  description: site.description,
  inLanguage: "en-IN",
  publisher: { "@id": `${ORIGIN}/#organization` },
});

// `imageUrl` arrives already resolved and absolute.
const webPage = (url, title, description, imageUrl) => ({
  "@context": "https://schema.org",
  "@type": "WebPage",
  "@id": `${url}#webpage`,
  url,
  name: title,
  description,
  inLanguage: "en-IN",
  isPartOf: { "@id": `${ORIGIN}/#website` },
  about: { "@id": `${ORIGIN}/#business` },
  ...(imageUrl ? { primaryImageOfPage: { "@type": "ImageObject", url: imageUrl } } : {}),
});

export const breadcrumbs = (origin, items) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: items.map((it, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: it.name,
    item: `${origin}${it.path}`,
  })),
});

const EMPTY = [];

export const Seo = ({
  title,
  description = site.description,
  path = "/",
  image = site.ogImage,
  type = "website",
  crumbs,
  jsonLd = EMPTY,
  noindex = false,
}) => {
  useEffect(() => {
    // Skip the brand suffix when the page title already names the studio.
    const fullTitle = title ? (title.includes(site.name) ? title : `${title} | ${site.name}`) : DEFAULT_TITLE;
    const url = absolute(path);
    const imageUrl = absolute(imageSource(image));

    document.title = fullTitle;
    setMeta("name", "description", description);
    setMeta(
      "name",
      "robots",
      noindex ? "noindex, follow" : "index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1",
    );
    setMeta("property", "og:title", fullTitle);
    setMeta("property", "og:description", description);
    setMeta("property", "og:type", type);
    setMeta("property", "og:url", url);
    setMeta("property", "og:image", imageUrl);
    setMeta("property", "og:image:alt", site.ogImageAlt);
    setMeta("property", "og:site_name", site.name);
    setMeta("property", "og:locale", "en_IN");
    setMeta("name", "twitter:card", "summary_large_image");
    setMeta("name", "twitter:title", fullTitle);
    setMeta("name", "twitter:description", description);
    setMeta("name", "twitter:image", imageUrl);
    setMeta("name", "geo.region", "IN-MH");
    setMeta("name", "geo.placename", site.city);

    // A canonical is emitted even for noindex pages so duplicate soft-404 URLs
    // consolidate instead of competing.
    setLink("canonical", url);
    setLink("alternate", url, "en-IN");

    const graph = [
      organization(),
      localBusiness(),
      website(),
      webPage(url, fullTitle, description, imageUrl),
      ...(crumbs ? [breadcrumbs(ORIGIN, crumbs)] : []),
      ...jsonLd,
    ];
    let script = document.getElementById("seo-jsonld");
    if (!script) {
      script = document.createElement("script");
      script.id = "seo-jsonld";
      script.type = "application/ld+json";
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(graph);
  }, [title, description, path, image, type, crumbs, jsonLd, noindex]);

  return null;
};
