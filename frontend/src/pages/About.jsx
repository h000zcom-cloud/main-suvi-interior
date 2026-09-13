import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { PageHero } from "@/components/ui-custom/PageHero";
import { Picture } from "@/components/motion/Picture";
import { CtaBand } from "@/components/ui-custom/CtaBand";
import { about } from "@/content/about";
import { materials } from "@/content/images";

export default function About() {
  const story = about.sections.find((section) => section.key === "story");
  const philosophy = about.sections.find((section) => section.key === "philosophy");
  const craft = about.sections.find((section) => section.key === "craft");

  return (
    <PageWrap testId="about-page">
      <Seo title="The Studio — Suvi Interior, Nashik" description={about.intro} path="/about" crumbs={[{ name: "Home", path: "/" }, { name: "Studio", path: "/about" }]} />
      <PageHero label="03 / The studio" lines={["Drawn with care.", <em>Made with purpose.</em>]} image={about.heroImage} text="Suvi Interior is an interior design and furniture studio rooted in Nashik." />

      <section className="about-story-section" data-testid="about-story">
        <div className="container-x route-section">
          <div className="chapter-top"><p className="editorial-label">Our story / Nashik</p><p>Designers and makers, working as one studio from the beginning.</p></div>
          <div className="about-story-grid"><h2 className="editorial-heading max-w-[9ch] text-oxblood">A studio built <em>on making.</em></h2><div className="about-story-copy"><p className="h-statement text-oxblood" data-testid="about-intro">{about.intro}</p>{story.body.map((paragraph, index) => <p className="route-prose mt-6" key={index}>{paragraph}</p>)}</div></div>
        </div>
      </section>

      <section className="about-philosophy-section" data-testid="about-philosophy">
        <div className="container-x about-philosophy-grid">
          <figure className="about-philosophy-media"><Picture image={philosophy.image} ratio="4 / 5" sizes="(min-width:1024px) 40vw,100vw" /><figcaption className="atelier-caption !text-white/60"><span>Calm material language</span><span>Suvi / Nashik</span></figcaption></figure>
          <div className="about-philosophy-copy"><p className="editorial-label mb-9 text-brass">Our point of view</p><h2 className="editorial-heading">Less noise. <em>More meaning.</em></h2>{philosophy.body.map((paragraph, index) => <p className="editorial-lede mt-7 text-white/72" key={index}>{paragraph}</p>)}<div className="about-beliefs" data-testid="about-believe">{["Function", "Craft", "Personal"].map((belief, index) => <div className="about-belief" key={belief}><p className="text-[10px] font-semibold tracking-[.12em] text-brass">0{index + 1}</p><p className="mt-3 font-display text-3xl">{belief}</p></div>)}</div></div>
        </div>
      </section>

      <section className="about-craft-section" data-testid="about-craft">
        <div className="container-x route-section">
          <div className="chapter-top"><p className="editorial-label">The maker’s perspective</p><p>The quality of an interior is revealed in the details you touch every day.</p></div>
          <div className="about-craft-grid"><div className="about-craft-copy"><h2 className="editorial-heading text-oxblood">The hand. The eye. <em>The finished piece.</em></h2>{craft.body.map((paragraph, index) => <p className="editorial-lede mt-7 text-taupe" key={index}>{paragraph}</p>)}<Link to="/process" data-testid="about-process-link" className="btn-text mt-8">See how it comes together<ArrowUpRight className="h-4 w-4" /></Link></div><div className="about-material-collage"><Picture image={materials[0]} ratio="3 / 4" /><Picture image={materials[4]} ratio="3 / 4" /><p className="col-span-2 mt-2 text-xs leading-relaxed text-taupe">Grain, joinery and the small decisions that make a room feel complete.</p></div></div>
        </div>
      </section>

      <div className="container-x"><Link to="/process" className="about-approach-link" data-testid="about-approach-link"><span><span className="label text-taupe">Our process</span><span className="mt-2 block font-display text-[clamp(1.8rem,4vw,3.5rem)] leading-none">Five steps. One conversation.</span></span><ArrowUpRight className="h-7 w-7 shrink-0" strokeWidth={1.2} /></Link></div>
      {about.founder && <section className="container-x route-section" data-testid="about-founder"><h2 className="editorial-heading text-oxblood">{about.founder.name}</h2><p className="editorial-lede mt-5">{about.founder.bio}</p></section>}
      <CtaBand />
    </PageWrap>
  );
}
