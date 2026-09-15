UNSPLASH = "https://images.unsplash.com/photo-{id}?auto=format&fit=crop&q=80&w=1400"
GEN = "https://static.prod-images.emergentagent.com/jobs/f269e9d1-749a-45df-9bb4-b97d233efcd1/images/"


def u(id_):
    return UNSPLASH.format(id=id_)


CONTENT = {
    "site": {
        "name": "Suvi Interior",
        "descriptor": "Interior Design & Furniture Manufacturing",
        "positioning": "A premium interior and furniture studio creating thoughtfully designed spaces with precision, functionality and timeless aesthetics.",
        "city": "Nashik",
        "region": "Maharashtra",
        "address": [
            "Shop No. G2, Pandhari Mala",
            "273, Shree Kulswamini Business Centre",
            "10, Ambad–Uttam Nagar Road, Opp. Rajat Park",
            "Nashik, Maharashtra 422010, India",
        ],
        "phone": "+91 97020 39381",
        "whatsapp_url": "https://wa.me/919702039381?text=Hi%20Suvi%20Interior%2C%20I%20saw%20your%20brochure%20and%20would%20like%20to%20discuss%20an%20interior%20project.",
        # Printed brand identity must never inherit a temporary preview hostname.
        "website": "https://suviinterior.com",
    },
    "images": {
        "cover": f"{GEN}cbd42da2d5aeab75d8c03160dffa60bc7caccaef27cadd63015168b228dfde6a.jpeg",
        "studio": f"{GEN}19c0df4a41d6ad56444b65ea529ae007d813094cc8708f8008531f1d9df780a4.jpeg",
        "detail": f"{GEN}0aa9d8d850232cc7a071aad5ed960d6ceb7e271f4d9fbf37183b4ecd8a5ad958.jpeg",
        "process": u("1622372738946-62e02505feb3"),
        "contact": u("1600585152915-d208bec867a1"),
    },
    "studio": {
        "body": [
            "Suvi Interior is an interior design and furniture studio in Nashik. We design homes and make the furniture that goes into them — modular kitchens, wardrobes, TV units, cabinets and complete interiors.",
            "Because design and making happen under one roof, what is drawn is what gets built — to the millimetre, in the finish you chose. Every home is used differently, so we begin with how a family actually lives and design outward from there.",
            "Good interiors are not about adding more. They are about resolving a space until nothing feels missing and nothing feels extra.",
        ],
    },
    "principles": [
        {"n": "01", "title": "Function", "text": "Every element should have a purpose."},
        {"n": "02", "title": "Craft", "text": "Furniture and interiors are designed with attention to material, proportion and finish."},
        {"n": "03", "title": "Personal", "text": "Every home should reflect the people who live in it."},
    ],
    "services": [
        {
            "number": "01",
            "title": "Modular Kitchens",
            "description": "A kitchen is used more than any other room. We plan each one around how you cook, store and move — then resolve it into calm, well-proportioned cabinetry with finishes chosen to last.",
            "features": ["Layout & storage planning", "Tall units, drawers and pull-outs", "Countertop & finish selection", "Hardware and lighting coordination"],
            "ideal_for": ["New homes", "Kitchen renovations", "Compact apartments"],
            "image": u("1564540586988-aa4e53c3d799"),
        },
        {
            "number": "02",
            "title": "Living Spaces",
            "description": "The living room carries the character of a home. We work with proportion, light and material to create spaces that feel composed when guests arrive and easy when they leave.",
            "features": ["Space planning and furniture layout", "Feature walls and panelling", "Seating, storage and display", "Lighting direction"],
            "ideal_for": ["Family homes", "Apartments", "Bungalows"],
            "image": u("1600210492486-724fe5c67fb0"),
        },
        {
            "number": "03",
            "title": "Bedroom Interiors",
            "description": "Bedrooms should be quiet — visually and practically. We coordinate wardrobes, headboards, side tables and lighting so that storage disappears and the room settles.",
            "features": ["Wardrobes and dressing units", "Headboard walls", "Bedside and study furniture", "Soft lighting"],
            "ideal_for": ["Master bedrooms", "Children's rooms", "Guest rooms"],
            "image": u("1710224002849-a76ea1068b0d"),
        },
        {
            "number": "04",
            "title": "TV & Wall Systems",
            "description": "From a single floating unit to a full entertainment wall, we design TV units, TV stands and cabinets that hold everything — cables included — and still read as one clean composition.",
            "features": ["TV units and TV stands", "Entertainment walls", "Cabinets and concealed storage", "Feature wall finishes"],
            "ideal_for": ["Living rooms", "Bedrooms", "Media rooms"],
            "image": u("1663811397219-c572550dffc5"),
        },
        {
            "number": "05",
            "title": "Custom Furniture",
            "description": "When a standard piece will not fit the room or the way you live, we design and manufacture it — sized to the millimetre, finished to match the rest of the home.",
            "features": ["Made-to-measure cabinets", "Wardrobes and storage", "Tables, consoles and units", "Material and finish matching"],
            "ideal_for": ["Awkward spaces", "Matching existing interiors", "One-off pieces"],
            "image": u("1595428774223-ef52624120d2"),
        },
        {
            "number": "06",
            "title": "Complete Interiors",
            "description": "One studio, one point of contact — from the first conversation and concept through furniture manufacturing, installation and handover of a finished home.",
            "features": ["Concept and space planning", "Furniture design and manufacturing", "Installation and finishing", "Single point of coordination"],
            "ideal_for": ["New homes", "Complete renovations", "Villas and bungalows"],
            "image": u("1600607687939-ce8a6c25118c"),
        },
    ],
    "process_intro": "Our process moves from discovery through design, detail, craft and finally living in the finished space. At every step you speak to the same people, and every decision is made with the finished room in mind.",
    "process": [
        {"n": "01", "title": "Discover", "text": "Understand the way you live, your priorities and your space."},
        {"n": "02", "title": "Design", "text": "Turn those inputs into a clear visual direction."},
        {"n": "03", "title": "Detail", "text": "Refine materials, finishes, proportions and functionality."},
        {"n": "04", "title": "Craft", "text": "Bring the design into physical form with precision."},
        {"n": "05", "title": "Live", "text": "A space that feels naturally yours."},
    ],
    "materials_intro": "Wood, stone, metal and fabric are chosen for how they feel in the hand and how they age in a home. Grain is matched across doors, edges are finished cleanly and every handle sits exactly where the hand expects it.",
    "materials": [
        {"title": "Wood", "note": "Veneers & solid timber", "image": f"{GEN}dce492bd8e6fbe45681b1b3082876eb8c3e5a4d7f34576d6bbcbf0140d605529.jpeg"},
        {"title": "Stone", "note": "Countertops & surfaces", "image": f"{GEN}e86d6f000202a0b88cd073eece9e66a70692156e65cdd370c23eec05bbc7de69.jpeg"},
        {"title": "Metal", "note": "Handles & hardware", "image": f"{GEN}d297a911539be3cca385e4bc0187fffd4404c6a8433bf3525a69a7522bbefa71.jpeg"},
        {"title": "Fabrics", "note": "Upholstery & soft finishes", "image": u("1616627561950-9f746e330187")},
        {"title": "Joinery", "note": "Edges, corners & fit", "image": f"{GEN}0aa9d8d850232cc7a071aad5ed960d6ceb7e271f4d9fbf37183b4ecd8a5ad958.jpeg"},
        {"title": "Marble", "note": "Vanities & feature surfaces", "image": u("1600607688066-890987f18a86")},
    ],
    "imagery_notice": "Imagery in this brochure is representative while the Suvi Interior project archive is being prepared. Service descriptions are directional and confirmed with the studio before quotation.",
}
