import { useMemo, useState } from "react";
import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { PageHero } from "@/components/ui-custom/PageHero";
import { ProjectTile } from "@/components/ui-custom/ProjectTile";
import { CtaBand } from "@/components/ui-custom/CtaBand";
import { projectCategories, projects } from "@/content/projects";
import { site } from "@/content/site";

export default function Projects() {
  const [filter, setFilter] = useState("all");
  const list = useMemo(() => filter === "all" ? projects : projects.filter((project) => project.category === filter), [filter]);

  return (
    <PageWrap testId="projects-page">
      <Seo title="Spaces & Stories — Interior Design in Nashik" description="Explore Suvi Interior's design directions for homes, modular kitchens, living rooms, bedrooms and custom furniture." path="/projects" crumbs={[{ name: "Home", path: "/" }, { name: "Projects", path: "/projects" }]} />
      <PageHero label="01 / The collection" lines={["Spaces &", <em>stories.</em>]} text="A study in how we live—interiors and furniture viewed through material, light and the rhythm of everyday life." />
      <section className="project-archive"><div className="container-x route-section">
        <div className="chapter-top"><p className="editorial-label">Browse the collection</p><p>Filter by the part of home you are imagining, or move through the complete archive.</p></div>
        <div className="archive-filters" role="group" aria-label="Filter projects" data-testid="project-filters">{projectCategories.map((category) => <button key={category.key} type="button" aria-pressed={filter === category.key} onClick={() => setFilter(category.key)} className="archive-filter" data-testid={`project-filter-${category.key}`}>{category.label}</button>)}<span className="ml-auto shrink-0 pr-2 text-[10px] font-semibold uppercase tracking-[.12em] text-taupe" data-testid="project-result-count" aria-live="polite">{String(list.length).padStart(2,"0")} studies</span></div>
        <div className="project-archive-grid mt-10" data-testid="project-grid">{list.map((project, index) => <ProjectTile key={project.slug} project={project} index={String(index + 1).padStart(2,"0")} ratio={index % 4 === 1 ? "4 / 5" : "4 / 3"} sizes="(min-width:768px) 55vw,100vw" />)}{!list.length && <p className="py-12 text-taupe" data-testid="project-empty">More design studies are being prepared.</p>}</div>
        <p className="mt-12 border-t border-line pt-5 text-xs leading-relaxed text-taupe" data-testid="imagery-notice">{site.imageryNotice}</p>
      </div></section>
      <CtaBand lines={["Your space.", <em>Your own story.</em>]} text="Seen a direction you connect with? Let's explore what it could become in your home." />
    </PageWrap>
  );
}
