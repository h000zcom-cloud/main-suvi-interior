import { useState } from "react";
import { ChevronLeft, ChevronRight, Expand } from "lucide-react";
import { Lightbox } from "@/components/ui-custom/Lightbox";

const titles = ["The studio", "Our approach", "Living & kitchens", "Furniture & interiors", "The process", "Materials & craft", "A conversation"];
export const brochurePages = titles.map((title, index) => ({ src: `/brochures/previews/page-${index + 1}.jpg`, alt: `Suvi Interior brochure — ${title}, page ${index + 1}` }));

export const PublicationViewer = () => {
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(null);
  const previous = () => setActive((current) => (current + brochurePages.length - 1) % brochurePages.length);
  const next = () => setActive((current) => (current + 1) % brochurePages.length);

  return (
    <section className="container-x route-section" data-testid="brochure-cover">
      <div className="brochure-viewer-head"><div><p className="editorial-label text-oxblood">Inside the brochure</p><p className="mt-3 hidden text-xs text-taupe sm:block">Select a page, or open the spread for a closer look.</p></div><div className="brochure-controls"><button type="button" onClick={previous} aria-label="Previous brochure page" className="brochure-control" data-testid="brochure-preview-prev"><ChevronLeft className="h-4 w-4" /></button><p className="min-w-12 text-center text-xs text-oxblood" data-testid="brochure-preview-counter" aria-live="polite">{active + 1} / {brochurePages.length}</p><button type="button" onClick={next} aria-label="Next brochure page" className="brochure-control" data-testid="brochure-preview-next"><ChevronRight className="h-4 w-4" /></button></div></div>
      <div className="brochure-spread" data-testid="brochure-preview-spread">{[active, (active + 1) % brochurePages.length].map((pageIndex, index) => <button key={`${pageIndex}-${index}`} type="button" onClick={() => setExpanded(pageIndex)} className={`group relative text-left ${index === 1 ? "hidden md:block" : ""}`} data-testid={`brochure-preview-page-${index}`} aria-label={`Enlarge brochure page ${pageIndex + 1}`}><div className="publication-sheet"><img src={brochurePages[pageIndex].src} alt={brochurePages[pageIndex].alt} /></div><span className="absolute bottom-4 right-4 flex h-11 w-11 items-center justify-center rounded-full bg-oxblood text-white shadow-float transition-transform group-hover:scale-110"><Expand className="h-4 w-4" /></span></button>)}</div>
      <div className="publication-thumbs mt-10 grid grid-cols-4 gap-2 sm:grid-cols-7 sm:gap-3" role="group" aria-label="Brochure pages">{brochurePages.map((page, index) => <button key={page.src} type="button" aria-pressed={active === index} onClick={() => setActive(index)} className="publication-thumb text-left" data-testid={`brochure-preview-select-${index}`} aria-label={`Show brochure page ${index + 1}`}><img src={page.src} alt="" loading="lazy" className="aspect-[210/297] w-full object-contain" /><span className="mt-2 block text-[10px] font-semibold tracking-[.1em] text-oxblood">0{index + 1}<span className="ml-2 hidden lg:inline">{titles[index]}</span></span></button>)}</div>
      <Lightbox items={brochurePages} index={expanded} onClose={() => setExpanded(null)} onChange={setExpanded} />
    </section>
  );
};
