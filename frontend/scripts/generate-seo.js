#!/usr/bin/env node
/**
 * Build-time SEO generator.
 *
 * The public site is a client-rendered Create React App bundle, so every tag the
 * <Seo> component writes (title, description, canonical, Open Graph, JSON-LD) only
 * exists after JavaScript executes. Googlebot usually renders JavaScript, but Bingbot
 * and most AI/answer-engine crawlers do not. Those crawlers would otherwise receive a
 * single shell document with no canonical, no per-page description and no structured
 * data.
 *
 * This script runs after `craco build` and, for every public route, writes a real HTML
 * file containing that route's metadata and JSON-LD. React still hydrates normally and
 * simply rewrites the same tags (matching ids/selectors), so there is no duplication.
 *
 * It also emits sitemap.xml and llms.txt from the same route list, so the three can
 * never drift apart.
 *
 * Business facts are read directly out of src/content/site.js, which stays the single
 * source of truth. No dependencies beyond Node core.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const FRONTEND_DIR = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(FRONTEND_DIR, "build");
const ROUTES_FILE = path.join(FRONTEND_DIR, "seo", "routes.json");
const SITE_FILE = path.join(FRONTEND_DIR, "src", "content", "site.js");
const PROJECTS_FILE = path.join(FRONTEND_DIR, "src", "content", "projects.js");
const SERVICES_FILE = path.join(FRONTEND_DIR, "src", "content", "services.js");
const IMAGES_FILE = path.join(FRONTEND_DIR, "src", "content", "images.js");

/* ------------------------------------------------------------------ helpers */

const escapeHtml = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const escapeXml = (value) =>
  String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");

/**
 * Finds the balanced closing bracket for the literal opening at `openIndex`,
 * skipping over string contents and comments so braces inside them do not count.
 */
function matchBracket(source, openIndex) {
  const open = source[openIndex];
  const close = open === "{" ? "}" : "]";
  let depth = 0;

  for (let i = openIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];

    if (char === "/" && next === "/") {
      i = source.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (char === "/" && next === "*") {
      i = source.indexOf("*/", i + 2) + 1;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      i += 1;
      while (i < source.length && source[i] !== char) {
        if (source[i] === "\\") i += 1;
        i += 1;
      }
      continue;
    }
    if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error("Unbalanced brackets while reading a configuration literal");
}

/**
 * Reads `export const <name> = { ... }` from a module that contains only literal
 * values, and evaluates just that literal. Used for src/content/site.js.
 */
function readLiteralExport(file, name) {
  const source = fs.readFileSync(file, "utf8");
  const marker = `export const ${name} =`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) throw new Error(`Could not find "${marker}" in ${file}`);

  const openIndex = source.indexOf("{", markerIndex);
  if (openIndex === -1) throw new Error(`Could not find the object literal for "${name}" in ${file}`);

  const literal = source.slice(openIndex, matchBracket(source, openIndex) + 1);
  try {
    // eslint-disable-next-line no-new-func
    return new Function(`"use strict"; return (${literal});`)();
  } catch (error) {
    throw new Error(
      `Failed to evaluate "${name}" from ${file}. It must contain only literal values ` +
        `(strings, numbers, booleans, null, arrays, objects). Original error: ${error.message}`,
    );
  }
}

/**
 * Extracts service routes from content/services.js. Like projects.js it imports image
 * objects, so only the plain string fields are read out.
 */
function readServices() {
  const source = fs.readFileSync(SERVICES_FILE, "utf8");
  const services = [];

  for (const match of source.matchAll(/slug:\s*"([a-z0-9-]+)"/g)) {
    const window = source.slice(match.index, match.index + 3000);
    const field = (key) => {
      const found = window.match(new RegExp(`${key}:\\s*\\n?\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      return found ? found[1].replace(/\\"/g, '"') : null;
    };

    const faqs = [];
    const faqBlock = (window.match(/faqs:\s*\[([\s\S]*?)\n\s{4}\]/) || [])[1];
    if (faqBlock) {
      const questions = [...faqBlock.matchAll(/q:\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
      const answers = [...faqBlock.matchAll(/a:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
      questions.forEach((q, index) => {
        if (answers[index]) faqs.push({ q: q.replace(/\\"/g, '"'), a: answers[index].replace(/\\"/g, '"') });
      });
    }

    services.push({
      slug: match[1],
      title: field("title"),
      seoTitle: field("seoTitle"),
      seoDescription: field("seoDescription"),
      description: field("description"),
      shortText: field("short"),
      faqs,
    });
  }

  if (!services.length) {
    throw new Error(`No service slugs found in ${SERVICES_FILE}; service pages would not be prerendered`);
  }
  return services;
}

/** Maps image keys defined as `key: u("<unsplash-id>", "alt")` in content/images.js. */
function readUnsplashImageIds() {
  if (!fs.existsSync(IMAGES_FILE)) return {};
  const source = fs.readFileSync(IMAGES_FILE, "utf8");
  const ids = {};
  for (const match of source.matchAll(/(\w+):\s*u\(\s*"([^"]+)"/g)) {
    ids[match[1]] = match[2];
  }
  return ids;
}

/**
 * Extracts project routes from content/projects.js. That module imports image objects,
 * so it cannot be evaluated as a literal; the fields needed here are plain strings.
 */
function readProjects() {
  const source = fs.readFileSync(PROJECTS_FILE, "utf8");
  const imageIds = readUnsplashImageIds();
  const projects = [];

  for (const match of source.matchAll(/slug:\s*"([a-z0-9-]+)"/g)) {
    const window = source.slice(match.index, match.index + 2000);
    const field = (key) => {
      const found = window.match(new RegExp(`${key}:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
      return found ? found[1].replace(/\\"/g, '"') : null;
    };
    const heroKey = (window.match(/hero:\s*img\.(\w+)/) || [])[1];

    projects.push({
      slug: match[1],
      title: field("title"),
      type: field("type"),
      summary: field("summary"),
      heroId: heroKey ? imageIds[heroKey] || null : null,
    });
  }

  if (!projects.length) {
    throw new Error(`No project slugs found in ${PROJECTS_FILE}; the sitemap would be incomplete`);
  }
  return projects;
}

/* ------------------------------------------------------------- configuration */

const config = JSON.parse(fs.readFileSync(ROUTES_FILE, "utf8"));
const site = readLiteralExport(SITE_FILE, "site");
const ORIGIN = String(config.siteUrl || site.url || "").replace(/\/+$/, "");

if (!/^https:\/\/[^/]+$/.test(ORIGIN)) {
  throw new Error(`siteUrl must be an absolute https origin without a path, received "${ORIGIN}"`);
}

const absolute = (value) => {
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `${ORIGIN}${value.startsWith("/") ? "" : "/"}${value}`;
};

const unsplashUrl = (id, width) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&q=75&w=${width}`;

// Appends the brand suffix unless the page title already names the studio, so titles
// never read "… Suvi Interior | Suvi Interior".
const titleFor = (route) => {
  if (!route.title) return config.defaultTitle;
  if (site.name && route.title.includes(site.name)) return route.title;
  return `${route.title}${config.titleSuffix || ""}`;
};

/* -------------------------------------------------------------- route models */

const projects = readProjects();
const servicesList = readServices();

const staticRoutes = config.routes.map((route) => ({
  ...route,
  fullTitle: titleFor(route),
  image: absolute(site.ogImage),
  type: "website",
}));

const projectRoutes = projects.map((project) => ({
  path: `${config.projectRoute.pathPrefix}${project.slug}`,
  title: project.type ? `${project.title} — ${project.type}` : project.title,
  fullTitle: `${project.type ? `${project.title} — ${project.type}` : project.title}${config.titleSuffix || ""}`,
  description: project.summary || site.description,
  priority: config.projectRoute.priority,
  changefreq: config.projectRoute.changefreq,
  llmsSection: config.projectRoute.llmsSection,
  llmsNote: project.summary || null,
  image: project.heroId ? unsplashUrl(project.heroId, 1200) : absolute(site.ogImage),
  type: "article",
}));

const serviceRoutes = servicesList.map((service) => ({
  path: `/services/${service.slug}`,
  title: service.seoTitle || service.title,
  fullTitle: `${service.seoTitle || service.title}${config.titleSuffix || ""}`,
  description: service.seoDescription || service.shortText || site.description,
  priority: "0.8",
  changefreq: "monthly",
  llmsSection: "Services",
  llmsNote: service.shortText || null,
  image: absolute(site.ogImage),
  type: "website",
  service,
}));

const allRoutes = [...staticRoutes, ...serviceRoutes, ...projectRoutes];

/* ------------------------------------------------------------------ JSON-LD */

const postalAddress = {
  "@type": "PostalAddress",
  streetAddress: site.address.streetAddress,
  addressLocality: site.city,
  addressRegion: site.region,
  postalCode: site.postalCode,
  addressCountry: site.country,
};

const socialLinks = Object.values(site.social || {}).filter(Boolean);
const sameAs = [...socialLinks, site.googleBusinessProfile].filter(Boolean);

const organization = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${ORIGIN}/#organization`,
  name: site.name,
  url: `${ORIGIN}/`,
  description: site.description,
  logo: { "@type": "ImageObject", url: absolute(site.ogImage) },
  image: absolute(site.ogImage),
  telephone: site.phone.tel,
  address: postalAddress,
  ...(site.email ? { email: site.email } : {}),
  ...(socialLinks.length ? { sameAs: socialLinks } : {}),
};

const localBusiness = {
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
  address: postalAddress,
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
  ...(site.hours && site.hours.length
    ? { openingHours: site.hours.map((h) => `${h.days} ${h.time}`) }
    : {}),
  ...(sameAs.length ? { sameAs } : {}),
};

const website = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${ORIGIN}/#website`,
  url: `${ORIGIN}/`,
  name: site.name,
  description: site.description,
  inLanguage: "en-IN",
  publisher: { "@id": `${ORIGIN}/#organization` },
};

const breadcrumbNames = {
  "/about": "Studio",
  "/services": "Services",
  "/projects": "Projects",
  "/gallery": "Gallery",
  "/contact": "Contact",
  "/process": "Process",
  "/brochure": "Brochure",
  "/privacy": "Privacy Policy",
  "/terms": "Terms of Use",
};

function breadcrumbsFor(route) {
  if (route.path === "/") return null;
  const items = [{ name: "Home", path: "/" }];

  if (route.path.startsWith(config.projectRoute.pathPrefix)) {
    items.push({ name: "Projects", path: "/projects" });
    items.push({ name: route.title, path: route.path });
  } else if (route.service) {
    items.push({ name: "Services", path: "/services" });
    items.push({ name: route.service.title, path: route.path });
  } else {
    items.push({ name: breadcrumbNames[route.path] || route.title, path: route.path });
  }

  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: `${ORIGIN}${item.path}`,
    })),
  };
}

function graphFor(route) {
  const url = `${ORIGIN}${route.path}`;
  const webPage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "@id": `${url}#webpage`,
    url,
    name: route.fullTitle,
    description: route.description,
    inLanguage: "en-IN",
    isPartOf: { "@id": `${ORIGIN}/#website` },
    about: { "@id": `${ORIGIN}/#business` },
    ...(route.image ? { primaryImageOfPage: { "@type": "ImageObject", url: route.image } } : {}),
  };

  const crumbs = breadcrumbsFor(route);
  const extra = [];

  if (route.service) {
    extra.push({
      "@context": "https://schema.org",
      "@type": "Service",
      "@id": `${url}#service`,
      name: route.service.title,
      serviceType: route.service.title,
      description: route.service.description || route.description,
      url,
      provider: { "@id": `${ORIGIN}/#business` },
      areaServed: (site.serviceAreas || [site.city]).map((name) => ({ "@type": "City", name })),
    });

    if (route.service.faqs && route.service.faqs.length) {
      extra.push({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        mainEntity: route.service.faqs.map((faq) => ({
          "@type": "Question",
          name: faq.q,
          acceptedAnswer: { "@type": "Answer", text: faq.a },
        })),
      });
    }
  }

  if (route.path === "/services") {
    extra.push({
      "@context": "https://schema.org",
      "@type": "ItemList",
      "@id": `${url}#servicelist`,
      name: "Interior design and furniture services in Nashik",
      itemListElement: servicesList.map((service, index) => ({
        "@type": "ListItem",
        position: index + 1,
        name: service.title,
        url: `${ORIGIN}/services/${service.slug}`,
      })),
    });
  }

  return [organization, localBusiness, website, webPage, ...(crumbs ? [crumbs] : []), ...extra];
}

/* --------------------------------------------------------------- prerenderer */

// Tags the generator owns. They are stripped from the template before the
// authoritative block is injected, so nothing is emitted twice.
const MANAGED_META = [
  ["name", "description"],
  ["name", "robots"],
  ["name", "twitter:card"],
  ["name", "twitter:title"],
  ["name", "twitter:description"],
  ["name", "twitter:image"],
  ["name", "geo.region"],
  ["name", "geo.placename"],
  ["property", "og:site_name"],
  ["property", "og:type"],
  ["property", "og:locale"],
  ["property", "og:title"],
  ["property", "og:description"],
  ["property", "og:url"],
  ["property", "og:image"],
  ["property", "og:image:alt"],
];

function stripManagedTags(html) {
  let output = html;
  for (const [attr, key] of MANAGED_META) {
    const pattern = new RegExp(`\\s*<meta[^>]*${attr}="${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`, "gi");
    output = output.replace(pattern, "");
  }
  output = output.replace(/\s*<link[^>]*rel="canonical"[^>]*>/gi, "");
  output = output.replace(/\s*<link[^>]*rel="alternate"[^>]*hreflang="[^"]*"[^>]*>/gi, "");
  output = output.replace(/\s*<script[^>]*id="seo-jsonld"[^>]*>[\s\S]*?<\/script>/gi, "");
  return output;
}

function headBlockFor(route) {
  const url = `${ORIGIN}${route.path}`;
  const tags = [
    `<meta name="description" content="${escapeHtml(route.description)}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />`,
    `<link rel="canonical" href="${escapeHtml(url)}" />`,
    `<link rel="alternate" hreflang="en-IN" href="${escapeHtml(url)}" />`,
    `<meta property="og:site_name" content="${escapeHtml(site.name)}" />`,
    `<meta property="og:locale" content="en_IN" />`,
    `<meta property="og:type" content="${escapeHtml(route.type)}" />`,
    `<meta property="og:title" content="${escapeHtml(route.fullTitle)}" />`,
    `<meta property="og:description" content="${escapeHtml(route.description)}" />`,
    `<meta property="og:url" content="${escapeHtml(url)}" />`,
    `<meta property="og:image" content="${escapeHtml(route.image)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(site.ogImageAlt || site.name)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(route.fullTitle)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(route.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(route.image)}" />`,
    `<meta name="geo.region" content="IN-MH" />`,
    `<meta name="geo.placename" content="${escapeHtml(site.city)}" />`,
    `<script id="seo-jsonld" type="application/ld+json">${JSON.stringify(graphFor(route)).replace(
      /</g,
      "\\u003c",
    )}</script>`,
  ];
  return tags.map((tag) => `        ${tag}`).join("\n");
}

/**
 * Builds the <noscript> body fallback.
 *
 * React renders the visible page after hydration, so a crawler that does not execute
 * JavaScript sees an empty <div id="root">. This writes a faithful text version of the
 * same page — heading, summary, the real on-page lists and the real internal links — so
 * non-rendering crawlers and LLM agents receive the actual content rather than a shell.
 *
 * It deliberately mirrors what the React page renders; it must never contain claims or
 * keywords that are absent from the live page.
 */
function bodyFallbackFor(route) {
  const parts = [];
  const heading = route.service ? route.service.title : route.title || site.name;

  parts.push(`<h1>${escapeHtml(heading)}</h1>`);
  parts.push(`<p>${escapeHtml(route.description)}</p>`);

  if (route.service) {
    if (route.service.description) parts.push(`<p>${escapeHtml(route.service.description)}</p>`);
    if (route.service.faqs && route.service.faqs.length) {
      parts.push("<h2>Common questions</h2>");
      parts.push("<dl>");
      for (const faq of route.service.faqs) {
        parts.push(`<dt>${escapeHtml(faq.q)}</dt><dd>${escapeHtml(faq.a)}</dd>`);
      }
      parts.push("</dl>");
    }
  }

  parts.push(
    `<p>${escapeHtml(site.name)}, ${escapeHtml((site.address.lines || []).join(", "))}. ` +
      `Telephone <a href="tel:${escapeHtml(site.phone.tel)}">${escapeHtml(site.phone.display)}</a>.</p>`,
  );

  const links = [
    ...servicesList.map((service) => ({
      href: `/services/${service.slug}`,
      label: `${service.title} in ${site.city}`,
    })),
    { href: "/projects", label: "Projects" },
    { href: "/process", label: "Our process" },
    { href: "/about", label: "About the studio" },
    { href: "/contact", label: "Contact" },
  ].filter((link) => link.href !== route.path);

  parts.push("<h2>Explore</h2><ul>");
  for (const link of links) {
    parts.push(`<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`);
  }
  parts.push("</ul>");
  parts.push("<p>Enable JavaScript for the full interactive site.</p>");

  return `<noscript>${parts.join("")}</noscript>`;
}

function renderRoute(template, route) {
  let html = stripManagedTags(template);

  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(route.fullTitle)}</title>`);
  if (!/<title>/i.test(html)) {
    html = html.replace(/<\/head>/i, `        <title>${escapeHtml(route.fullTitle)}</title>\n    </head>`);
  }

  html = html.replace(/<\/head>/i, `${headBlockFor(route)}\n    </head>`);

  const fallback = bodyFallbackFor(route);
  if (/<noscript>[\s\S]*?<\/noscript>/i.test(html)) {
    return html.replace(/<noscript>[\s\S]*?<\/noscript>/i, fallback);
  }
  return html.replace(/<div id="root">/i, `${fallback}<div id="root">`);
}

function writeRouteFile(route, html) {
  const target =
    route.path === "/"
      ? path.join(BUILD_DIR, "index.html")
      : path.join(BUILD_DIR, route.path.replace(/^\/+/, ""), "index.html");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, "utf8");
  return path.relative(BUILD_DIR, target).replace(/\\/g, "/");
}

/* ------------------------------------------------------------------- outputs */

function buildSitemap(lastmod) {
  const entries = allRoutes
    .map(
      (route) =>
        `  <url>\n` +
        `    <loc>${escapeXml(`${ORIGIN}${route.path}`)}</loc>\n` +
        `    <lastmod>${lastmod}</lastmod>\n` +
        `    <changefreq>${route.changefreq}</changefreq>\n` +
        `    <priority>${route.priority}</priority>\n` +
        `  </url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.w3.org/1999/sitemap/0.9">\n${entries}\n</urlset>\n`.replace(
    "http://www.w3.org/1999/sitemap/0.9",
    "http://www.sitemaps.org/schemas/sitemap/0.9",
  );
}

function buildLlmsTxt() {
  const addressLine = (site.address.lines || []).join(", ");
  const lines = [
    `# ${site.name}`,
    "",
    `> ${site.description}`,
    "",
    `${site.name} is an interior design and furniture studio in ${site.city}, ${site.region}, India. The studio designs, manufactures and installs interiors in house, covering modular kitchens, wardrobes and storage, TV and wall systems, bedroom and living room interiors, custom furniture, and complete residential interiors.`,
    "",
    "## Business details",
    "",
    `- Name: ${site.name}`,
    `- Type: Interior design and furniture manufacturing studio`,
    `- Address: ${addressLine}`,
    `- Service area: ${(site.serviceAreas || []).join(", ")}`,
    `- Phone: ${site.phone.display}`,
    site.email ? `- Email: ${site.email}` : null,
    `- Website: ${ORIGIN}/`,
    "",
  ].filter((line) => line !== null);

  const sections = new Map();
  for (const route of allRoutes) {
    const section = route.llmsSection || "Pages";
    if (!sections.has(section)) sections.set(section, []);
    const label = route.title || site.name;
    const note = route.llmsNote ? `: ${route.llmsNote}` : "";
    sections.get(section).push(`- [${label}](${ORIGIN}${route.path})${note}`);
  }

  for (const [section, items] of sections) {
    lines.push(`## ${section}`, "", ...items, "");
  }

  lines.push(
    "## Notes for AI systems",
    "",
    "- Imagery on the website is representative while the studio's own project photography is prepared, so project pages illustrate design directions rather than named completed jobs.",
    "- Pricing, project timelines and business hours are not published; please direct people to contact the studio for those.",
    "- /admin is a private area and is excluded from indexing.",
    "",
  );

  return `${lines.join("\n")}`;
}

/* ---------------------------------------------------------------------- main */

function main() {
  if (!fs.existsSync(BUILD_DIR)) {
    throw new Error(`Build directory not found at ${BUILD_DIR}. Run the production build first.`);
  }
  const templatePath = path.join(BUILD_DIR, "index.html");
  if (!fs.existsSync(templatePath)) {
    throw new Error(`Missing ${templatePath}. Run the production build first.`);
  }

  const template = fs.readFileSync(templatePath, "utf8");
  const lastmod = new Date().toISOString().slice(0, 10);

  const written = allRoutes.map((route) => writeRouteFile(route, renderRoute(template, route)));

  fs.writeFileSync(path.join(BUILD_DIR, "sitemap.xml"), buildSitemap(lastmod), "utf8");
  fs.writeFileSync(path.join(BUILD_DIR, "llms.txt"), buildLlmsTxt(), "utf8");

  console.log(`[seo] origin              ${ORIGIN}`);
  console.log(
    `[seo] prerendered pages   ${written.length} ` +
      `(${servicesList.length} service pages, ${projects.length} project pages)`,
  );
  console.log(`[seo] sitemap.xml         ${allRoutes.length} urls, lastmod ${lastmod}`);
  console.log(`[seo] llms.txt            written`);
  if (!site.geo || site.geo.latitude == null) {
    console.log("[seo] note: site.geo is unset, so LocalBusiness omits map coordinates");
  }
  if (!site.hours || !site.hours.length) {
    console.log("[seo] note: site.hours is empty, so LocalBusiness omits opening hours");
  }
}

try {
  main();
} catch (error) {
  console.error(`[seo] generation failed: ${error.message}`);
  process.exit(1);
}
