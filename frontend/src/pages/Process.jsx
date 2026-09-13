import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { PageHero } from "@/components/ui-custom/PageHero";
import { Reveal } from "@/components/motion/Reveal";
import { ParallaxImage } from "@/components/motion/Picture";
import { CtaBand } from "@/components/ui-custom/CtaBand";
import { processSteps } from "@/content/process";
import { img } from "@/content/images";

const CRUMBS = [{ name: "Home", path: "/" }, { name: "Process", path: "/process" }];
const stepImages = [img.livingGarden, img.openPlan, img.kitchenTap, img.woodGrain, img.livingLounge];
const deliverables = ["Your space, needs and priorities understood.", "A shared direction for layout and material.", "Finishes, fittings and details resolved together.", "Furniture made, fitted and finished for your home.", "A finished space, ready for everyday life."];
const details = ["We start in your home or at the studio—measuring, listening and understanding how the space is really used.", "Layouts, references, materials and a clear visual direction are discussed together until the idea is right.", "Finishes, hardware, proportions, storage and lighting are resolved before anything is made.", "Furniture and interior elements are manufactured to the drawing, then installed and finished on site.", "Handover of a complete space—and the same people to call if anything needs attention."];

export default function Process() {
  return (
    <PageWrap theme="dark" testId="process-page">
      <Seo title="Our Process — Interior Design in Nashik" description="How Suvi Interior works: Discover, Design, Detail, Craft, Live. A clear five-step interior design and furniture process for homes in Nashik." path="/process" crumbs={CRUMBS} />
      <PageHero label="04 / A considered process" lines={["From a thought", <em>to a home.</em>]} text="No disconnected handovers. Five clear steps, with the same studio from the first sketch to the final detail." />
      <section className="container-x route-section"><div className="chapter-top"><p className="editorial-label">The journey</p><p>A clear shared process makes space for better decisions and a calmer experience.</p></div><ol className="process-timeline">{processSteps.map((step, index) => <li key={step.n} id={step.title.toLowerCase()} className="process-row" data-testid={`process-step-${step.n}`}><Reveal className="process-number"><span>{step.n}</span></Reveal><Reveal delay={.08} className="process-copy"><p className="label mb-5 text-taupe">Stage {step.n}</p><h2 className="h-section text-oxblood">{step.title}</h2><p className="mt-6 text-lg leading-relaxed text-charcoal">{step.text}</p><p className="mt-4 text-[15px] leading-[1.85] text-taupe">{details[index]}</p><p className="process-deliverable" data-testid={`process-outcome-${step.n}`}>{deliverables[index]}</p></Reveal><Reveal delay={.15} className="process-image"><ParallaxImage image={stepImages[index]} ratio={index % 2 === 0 ? "4 / 3" : "4 / 5"} sizes="(min-width:1024px) 32vw,100vw" strength={5} /></Reveal></li>)}</ol></section>
      <CtaBand lines={["Ready to", <em>begin?</em>]} text="Tell us about your space and we'll take the first step together." primaryLabel="Begin a conversation" />
    </PageWrap>
  );
}
