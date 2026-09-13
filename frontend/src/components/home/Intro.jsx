import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Picture } from "@/components/motion/Picture";
import { introPortrait } from "@/content/images";

const pillars = [
  { title: "Listen", text: "Begin with your routines, needs and sense of home." },
  { title: "Resolve", text: "Bring layout, material and furniture into one clear idea." },
  { title: "Make", text: "Carry that idea through every measured, finished detail." },
];

export const Intro = () => (
  <section className="home-intro" data-testid="intro-section">
    <div className="container-x home-intro-grid">
      <div className="home-intro-copy">
        <div>
          <p className="editorial-label mb-9 text-brass">01 / The Suvi point of view</p>
          <h2 className="editorial-heading home-intro-heading" data-testid="intro-heading">A home should feel unmistakably <em>yours.</em></h2>
          <p className="editorial-lede home-intro-body">Not a showroom. Not a passing trend. A place shaped around how you move, gather, rest and live. We design the space and make the furniture together, so every decision belongs to the same story.</p>
          <Link to="/about" data-testid="intro-about-link" className="home-intro-link">Inside the studio<ArrowUpRight className="h-4 w-4" strokeWidth={1.3} /></Link>
        </div>
        <ol className="home-pillars" data-testid="intro-pillars">{pillars.map((pillar, index) => <li className="home-pillar" key={pillar.title} data-testid={`intro-pillar-${pillar.title.toLowerCase()}`}><p className="home-pillar-index">0{index + 1}</p><div><h3>{pillar.title}</h3><p>{pillar.text}</p></div></li>)}</ol>
      </div>
      <figure className="home-intro-figure" data-testid="intro-image">
        <Picture image={introPortrait} ratio="4 / 5" sizes="(min-width:1024px) 38vw,100vw" />
        <figcaption className="atelier-caption !text-white/60"><span>Material, proportion, everyday life.</span><span>Suvi / Nashik</span></figcaption>
      </figure>
    </div>
  </section>
);
