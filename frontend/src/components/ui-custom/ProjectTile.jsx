import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Picture } from "@/components/motion/Picture";

export const ProjectTile = ({ project, index, className, ratio = "4 / 3", sizes = "50vw", imgClassName }) => (
  <article className={className}>
    <Link to={`/projects/${project.slug}`} className="group block" data-testid={`project-tile-${project.slug}`}>
      <div className="editorial-image project-tile-image">
        <Picture image={project.hero} ratio={ratio} sizes={sizes} imgClassName={imgClassName} />
        {project.isPlaceholder && (
          <span className="project-study-badge" data-testid={`project-study-${project.slug}`}>Design study</span>
        )}
        {index && <span className="project-tile-index" aria-hidden="true">{index}</span>}
      </div>
      <div className="project-tile-body">
        <div className="min-w-0">
          <p className="project-tile-meta">{project.location} <span aria-hidden="true">·</span> {project.type}</p>
          <h3 className="project-tile-title mt-2">{project.title}</h3>
        </div>
        <span className="project-tile-arrow" aria-hidden="true"><ArrowUpRight className="h-5 w-5" strokeWidth={1.25} /></span>
      </div>
    </Link>
  </article>
);
