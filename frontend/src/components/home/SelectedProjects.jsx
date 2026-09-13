import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { ProjectTile } from "@/components/ui-custom/ProjectTile";
import { selectedProjects } from "@/content/projects";
import { site } from "@/content/site";

export const SelectedProjects = () => (
  <section className="home-projects" data-testid="selected-projects">
    <div className="container-x section">
      <div className="chapter-top"><p className="editorial-label">02 / Selected work</p><p>Rooms are never isolated. Each is part of the rhythm, material language and everyday life of a home.</p></div>
      <div className="mb-12 flex flex-wrap items-end justify-between gap-7 md:mb-16"><h2 className="editorial-heading home-section-title text-oxblood" data-testid="selected-projects-heading">Spaces with a sense of <em>belonging.</em></h2><Link to="/projects" data-testid="projects-all-link" className="btn-text">View the collection<ArrowUpRight className="h-4 w-4" /></Link></div>
      <div className="home-project-grid">{selectedProjects.map((project, index) => <ProjectTile key={project.slug} project={project} index={`0${index + 1}`} ratio={index === 0 ? "4 / 3" : index === 1 ? "4 / 5" : "16 / 8"} sizes="(min-width:768px) 65vw,100vw" />)}</div>
      <p className="mt-8 border-t border-line pt-5 text-xs leading-relaxed text-taupe" data-testid="imagery-notice">{site.imageryNotice}</p>
    </div>
  </section>
);
