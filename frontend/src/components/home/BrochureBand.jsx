import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { DownloadButton } from "@/components/brochure/DownloadButton";

export const BrochureBand = () => (
  <section className="home-brochure" data-testid="home-brochure-band">
    <div className="container-x home-brochure-grid">
      <div className="home-brochure-copy"><p className="editorial-label mb-8 text-brass">06 / The studio edition</p><h2 className="editorial-heading" data-testid="home-brochure-heading">A little Suvi, <em>to take with you.</em></h2></div>
      <div className="home-brochure-actions"><p className="mb-7 text-sm leading-relaxed text-white/72">Seven considered pages about our approach, material language and the kind of homes we imagine.</p><div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center"><DownloadButton className="btn-light" testId="home-brochure-download" /><Link to="/brochure" data-testid="home-brochure-preview" className="btn-text-light">Look inside<ArrowUpRight className="h-4 w-4" /></Link></div></div>
      <Link to="/brochure" className="home-brochure-cover" aria-label="Preview the Suvi Interior studio brochure"><img src="/brochures/previews/page-1.jpg" alt="Suvi Interior studio brochure cover" loading="lazy" width="210" height="297" /></Link>
    </div>
  </section>
);
