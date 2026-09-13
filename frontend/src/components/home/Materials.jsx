import { Picture } from "@/components/motion/Picture";
import { materials } from "@/content/images";

export const Materials = ({ index = "05" }) => (
  <section className="home-materials border-t border-line" data-testid="materials-section">
    <div className="container-x section">
      <div className="chapter-top"><p className="editorial-label">{index} / The material library</p><p>Surfaces chosen not only for how they photograph, but for how they age, feel and live with you.</p></div>
      <h2 className="editorial-heading mb-12 max-w-[10ch] text-oxblood md:mb-16" data-testid="materials-heading">Beauty you can <em>feel.</em></h2>
      <div className="material-grid">{materials.map((material, index) => <figure key={material.title} data-testid={`material-${index}`}><Picture image={material} ratio="4 / 3" sizes="(min-width:768px) 30vw,100vw" className="editorial-image" /><figcaption className="mt-4 border-t border-line pt-4"><div className="flex items-baseline justify-between gap-3"><h3>{material.title}</h3><span className="text-[10px] font-semibold tracking-[.12em] text-oxblood">0{index + 1}</span></div><p className="mt-2 text-xs leading-relaxed text-taupe">{material.note}</p></figcaption></figure>)}</div>
    </div>
  </section>
);
