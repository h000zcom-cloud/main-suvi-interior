// Central business configuration. Update these values — the interface adapts automatically.
// Fields set to null are intentionally unpublished until verified by Suvi Interior.

export const site = {
  name: "Suvi Interior",
  wordmark: ["Suvi", "Interior"],

  // Canonical production origin. Every canonical URL, sitemap entry and JSON-LD @id
  // is built from this, so search engines never index a preview or *.vercel.app copy.
  url: "https://suviinterior.com",

  // Sharing image used for Open Graph, Twitter cards and LocalBusiness.image.
  // TODO(Suvi Interior): replace with a self-hosted 1200x630 brand image once studio
  // photography is available; this currently points at an external generated asset.
  ogImage:
    "https://static.prod-images.emergentagent.com/jobs/f269e9d1-749a-45df-9bb4-b97d233efcd1/images/cbd42da2d5aeab75d8c03160dffa60bc7caccaef27cadd63015168b228dfde6a.jpeg",
  ogImageAlt:
    "Warm contemporary living room interior designed and manufactured by Suvi Interior, Nashik",
  tagline: "Interior design, custom furniture and execution — Nashik",
  descriptor: "Interior Design & Furniture · Nashik",
  positioning:
    "A premium interior and furniture studio creating thoughtfully designed spaces with precision, functionality and timeless aesthetics.",
  description:
    "Suvi Interior — interior designers in Nashik. Modular kitchens, custom furniture, TV units, bedroom interiors and complete home interior design, designed and made by one studio.",

  city: "Nashik",
  region: "Maharashtra",
  country: "IN",
  postalCode: "422010",

  address: {
    lines: [
      "Shop No. G2, Pandhari Mala",
      "273, Shree Kulswamini Business Centre",
      "10, Ambad–Uttam Nagar Road, Opp. Rajat Park",
      "Nashik, Maharashtra 422010, India",
    ],
    short: "Pandhari Mala, Ambad–Uttam Nagar Road, Nashik",
    streetAddress:
      "Shop No. G2, Pandhari Mala, 273, Shree Kulswamini Business Centre, 10, Ambad–Uttam Nagar Road, Opp. Rajat Park",
  },

  phone: { display: "+91 97020 39381", tel: "+919702039381" },

  // Localities within Nashik city. Safe to publish: the studio states it works with
  // homeowners across the city and the surrounding region (see content/about.js).
  serviceAreas: [
    "Nashik",
    "Ambad",
    "Pandhari Mala",
    "Uttam Nagar",
    "Satpur",
    "Indira Nagar",
    "Panchavati",
    "Gangapur Road",
    "College Road",
    "Nashik Road",
    "Cidco",
    "Adgaon",
    "Pathardi Phata",
    "Deolali",
  ],

  // Towns and cities near Nashik. Intentionally NOT published in structured data or
  // page copy until Suvi Interior confirms it actually takes projects in each one —
  // claiming unserved locations is a local-SEO and trust risk.
  nearbyAreasPendingConfirmation: [
    "Sinnar",
    "Ozar",
    "Pimpalgaon Baswant",
    "Niphad",
    "Dindori",
    "Igatpuri",
    "Trimbakeshwar",
  ],

  // Exact rooftop coordinates for the LocalBusiness "geo" property and Google Business
  // Profile URL. Both stay null until verified — a wrong pin actively harms map ranking.
  geo: { latitude: null, longitude: null },
  googleBusinessProfile: null,

  whatsapp: {
    enabled: true,
    number: "919702039381",
    defaultMessage:
      "Hi Suvi Interior, I found your website and would like to discuss an interior project.",
  },

  email: null,

  social: {
    instagram: null,
    facebook: null,
    google: null,
  },

  // e.g. [{ days: "Monday – Saturday", time: "10:00 – 20:00" }]
  hours: [],

  // Publish only after verification. When enabled is false the block is hidden.
  googleReviews: { enabled: false, rating: null, count: null, url: null },

  mapsQuery:
    "Suvi Interior, Shop No. G2, Pandhari Mala, Shree Kulswamini Business Centre, Ambad-Uttam Nagar Road, Nashik 422010",

  // Imagery on this site is representative until Suvi Interior's own project photography is supplied.
  imageryNotice:
    "Imagery shown is representative while our project archive is being prepared.",
};

export const nav = [
  { label: "Projects", to: "/projects" },
  { label: "Services", to: "/services" },
  { label: "Studio", to: "/about" },
  { label: "Process", to: "/process" },
  { label: "Gallery", to: "/gallery" },
  { label: "Brochure", to: "/brochure" },
];

export const mobileNav = [
  { label: "Projects", to: "/projects" },
  { label: "Services", to: "/services" },
  { label: "Studio", to: "/about" },
  { label: "Process", to: "/process" },
  { label: "Gallery", to: "/gallery" },
  { label: "Brochure", to: "/brochure" },
  { label: "Contact", to: "/contact" },
];

export const projectTypes = [
  "Full Home Interior",
  "Modular Kitchen",
  "Living Room",
  "Bedroom",
  "Furniture",
  "TV Unit",
  "Other",
];
