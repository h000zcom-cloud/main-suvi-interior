// Long-form homepage copy for search and AI answer engines.
//
// Every claim here is derived from verified fields in content/site.js and
// content/services.js. Do NOT add ratings, awards, years in business, project
// counts or prices until Suvi Interior supplies them — unverifiable claims are a
// trust and local-SEO risk, and site.js deliberately leaves reviews, hours and
// coordinates unpublished for the same reason.
//
// The FAQ answers are also emitted as FAQPage structured data (Home.jsx) and into
// the static crawler fallback (scripts/generate-seo.js), so the visible text and
// the markup must stay identical.

export const homeGuide = {
  eyebrow: "Interior design in Nashik",
  heading: ["Interior designers in Nashik,", "from first drawing", "to final fitting."],
  lede:
    "Suvi Interior is an interior design and furniture studio based on Ambad–Uttam Nagar Road in Nashik. We design homes and manufacture the furniture that goes into them, so one studio stays answerable for the drawing, the finish and the fit.",
  paragraphs: [
    "Suvi Interior works at the meeting point of interior design and furniture manufacturing. The studio designs, makes and installs, which keeps layouts, joinery drawings, material selection and the finished fit under one roof. Every piece is made to the measurements of the room it belongs to, rather than treated as a standard unit that has to be made to fit later.",
    "That covers full home interiors as well as individual rooms. A modular kitchen planned around how you cook and store, a bedroom resolved around wardrobe depth and light, a living room where panelling, seating and storage are considered together. Every home is used differently, so the process begins with how you live, your priorities and the space itself before moving through design, detail and craft.",
  ],
  capabilitiesHeading: "What we design and make",
  capabilities: [
    { to: "/services/modular-kitchens", title: "Modular kitchens", line: "Layout and storage planning, tall units, drawers and pull-outs, countertops and finishes." },
    { to: "/services/bedroom-interiors", title: "Bedroom interiors", line: "Wardrobes, storage and material coordination for calm, functional rooms." },
    { to: "/services/living-spaces", title: "Living spaces", line: "Furniture layouts, feature walls and panelling, seating, storage and lighting direction." },
    { to: "/services/tv-units-wall-systems", title: "TV and wall systems", line: "Custom entertainment walls, storage systems and feature walls built to the room." },
    { to: "/services/custom-furniture", title: "Custom furniture", line: "Made-to-measure pieces designed and manufactured for your space." },
    { to: "/services/complete-interior-solutions", title: "Complete interiors", line: "End-to-end interior execution for residential spaces, coordinated by one studio." },
  ],
  areasHeading: "Where we work",
  areasLede:
    "The studio is in Ambad and we take on homes across Nashik city and the surrounding region. If your locality is not listed, it is still worth asking.",
};

export const homeFaqs = [
  {
    q: "Which areas of Nashik do you work in?",
    a: "The studio is on Ambad–Uttam Nagar Road, and we take on homes across Nashik city — including Ambad, Satpur, Indira Nagar, Panchavati, Gangapur Road, College Road, Nashik Road, Cidco, Adgaon, Pathardi Phata and Deolali — as well as the surrounding region. If your locality is not on that list, ask us anyway.",
  },
  {
    q: "How much does a modular kitchen or full home interior cost in Nashik?",
    a: "There is no single useful figure for every home, because the scope changes with the size of the space, the amount of cabinetry, the materials and finishes, and the hardware selected. Tell us which rooms you are considering and what those rooms need to do, and we can discuss a scope that is relevant to your home instead of relying on a generic package price.",
  },
  {
    q: "Do you manufacture the furniture yourselves, or outsource it?",
    a: "We manufacture in house. Design, manufacturing and installation sit with the same studio, so material, finish and fit decisions are not handed to a third party and the piece that arrives matches the drawing it came from.",
  },
  {
    q: "Can you do just one room instead of a whole home?",
    a: "Yes. A single modular kitchen, one bedroom, a TV and wall system, or a set of custom furniture pieces are all normal projects for us, alongside complete home interiors.",
  },
  {
    q: "How long does an interior project take?",
    a: "Timing depends on the scope, the materials and finishes selected, and the decisions required along the way. The project process follows five stages — Discover, Design, Detail, Craft and Live — so the work moves from understanding the space through to its finished form in a clear sequence.",
  },
  {
    q: "Do you handle execution on site as well as the design?",
    a: "Yes. Complete interiors are offered as end-to-end execution for residential spaces, with the studio coordinating the work rather than leaving you to manage separate parties. Where a project only needs specific pieces designed and made, we can scope it that way instead.",
  },
  {
    q: "We are taking possession of a new flat. When should we talk to you?",
    a: "You can speak to us while planning a new home or after handover. Starting the conversation early gives the design process more context about the rooms, storage and furniture you are considering before the work moves into design and detail.",
  },
  {
    q: "How do we start, and what happens at the first conversation?",
    a: "Call or message the studio and tell us about the space, how you use it and what you would like to change. The first stage is Discover — understanding the way you live, your priorities and your space — followed by Design, Detail, Craft and the finished room.",
  },
];
