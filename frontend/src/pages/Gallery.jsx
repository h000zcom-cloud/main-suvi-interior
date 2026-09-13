import { useMemo, useState } from "react";
import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { PageHero } from "@/components/ui-custom/PageHero";
import { Picture } from "@/components/motion/Picture";
import { Lightbox } from "@/components/ui-custom/Lightbox";
import { CtaBand } from "@/components/ui-custom/CtaBand";
import { galleryCategories, galleryItems } from "@/content/gallery";
import { site } from "@/content/site";

export default function Gallery() {
  const [filter, setFilter] = useState("all");
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const items = useMemo(() => filter === "all" ? galleryItems : galleryItems.filter((item) => item.category === filter), [filter]);

  return (
    <PageWrap testId="gallery-page" className="gallery-canvas">
      <Seo title="The Detail Edit — Interior Gallery" description="A visual library of interiors, furniture, materials and considered details from Suvi Interior, Nashik." path="/gallery" crumbs={[{ name: "Home", path: "/" }, { name: "Gallery", path: "/gallery" }]} />
      <PageHero label="05 / A visual notebook" lines={["The detail", <em>edit.</em>]} text="The sweep of a room. The grain of a cabinet. Sometimes the smallest things say the most." />
      <section className="container-x route-section">
        <div className="chapter-top !border-white/20 !text-brass"><p className="editorial-label">A room, a surface, a moment</p><p className="!text-white/58">Move through the complete visual notebook or narrow the edit by subject.</p></div>
        <div className="archive-filters" role="group" aria-label="Filter gallery" data-testid="gallery-filters">{galleryCategories.map((category) => <button key={category.key} type="button" aria-pressed={filter === category.key} onClick={() => setFilter(category.key)} data-testid={`gallery-filter-${category.key}`} className="archive-filter">{category.label}</button>)}<span className="ml-auto shrink-0 text-[10px] font-semibold uppercase tracking-[.12em] text-white/60" data-testid="gallery-result-count" aria-live="polite">{items.length} images</span></div>
        <div className="premium-gallery-grid" data-testid="gallery-grid">{items.map((item, index) => <button key={`${item.id || item.src}-${index}`} type="button" onClick={() => setLightboxIndex(galleryItems.indexOf(item))} className="premium-gallery-item editorial-image group" data-testid={`gallery-item-${index}`} aria-label={`View ${item.alt}`}><Picture image={item} ratio={item.ratio} sizes="(min-width:768px) 55vw,100vw" /><span className="gallery-item-meta"><span>{galleryCategories.find((category) => category.key === item.category)?.label}</span><span>0{index + 1} ↗</span></span></button>)}</div>
        <p className="gallery-note mt-10 border-t border-white/20 pt-5 text-xs" data-testid="imagery-notice">{site.imageryNotice}</p>
      </section>
      <CtaBand lines={["Something caught", <em>your eye?</em>]} text="We'd love to hear what you have in mind for your own space." />
      <Lightbox items={galleryItems} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onChange={setLightboxIndex} />
    </PageWrap>
  );
}
