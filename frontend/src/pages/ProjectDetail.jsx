import { useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import { PageWrap } from "@/components/layout/PageWrap";
import { Seo } from "@/components/layout/Seo";
import { Reveal, SplitLines } from "@/components/motion/Reveal";
import { ParallaxImage, Picture } from "@/components/motion/Picture";
import { Lightbox } from "@/components/ui-custom/Lightbox";
import { CtaBand } from "@/components/ui-custom/CtaBand";
import { getProject, projects } from "@/content/projects";
import { site } from "@/content/site";
import { imgUrl } from "@/lib/images";

export default function ProjectDetail() {
  const { slug } = useParams();
  const project = getProject(slug);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  if (!project) return <Navigate to="/projects" replace />;

  const projectIndex = projects.findIndex((item) => item.slug === slug);
  const next = projects[(projectIndex + 1) % projects.length];
  const images = [project.hero, ...project.gallery];
  const crumbs = [{ name: "Home", path: "/" }, { name: "Projects", path: "/projects" }, { name: project.title, path: `/projects/${project.slug}` }];

  return (
    <PageWrap theme="dark" testId="project-detail-page">
      <Seo title={`${project.title} — ${project.type}`} description={project.summary} path={`/projects/${project.slug}`} image={imgUrl(project.hero,1200)} type="article" crumbs={crumbs} />
      <section className="project-detail-hero" data-project-index={String(projectIndex + 1).padStart(2,"0")}><div className="container-x">
        <Reveal><Link to="/projects" data-testid="project-back" className="inline-flex min-h-11 items-center gap-4 text-xs text-white/70 transition-colors hover:text-white"><ArrowLeft className="h-4 w-4" />The collection</Link></Reveal>
        <div className="project-detail-heading-grid"><div><p className="editorial-label mb-8 text-brass">{project.type} / {project.location}</p><SplitLines as="h1" lines={[project.title]} className="editorial-heading project-detail-title" data-testid="project-title" /></div><Reveal delay={.2}><dl className="project-detail-meta" data-testid="project-meta"><div><dt className="label text-white/50">Category</dt><dd className="mt-2 text-sm">{project.type}</dd></div><div><dt className="label text-white/50">Collection</dt><dd className="mt-2 text-sm">{project.isPlaceholder ? "Design study" : project.location}</dd></div>{project.year && <div><dt className="label text-white/50">Year</dt><dd className="mt-2 text-sm">{project.year}</dd></div>}</dl><p className="mt-7 text-sm leading-[1.85] text-white/72" data-testid="project-summary">{project.summary}</p></Reveal></div>
      </div></section>

      <section className="container-x project-hero-wrap"><Reveal><button type="button" onClick={() => setLightboxIndex(0)} className="img-zoom block w-full text-left" data-testid="project-hero-image" aria-label="Open hero image"><ParallaxImage image={project.hero} ratio="16 / 9" priority sizes="100vw" strength={6} /></button></Reveal>{project.isPlaceholder && <p className="mt-4 text-xs text-taupe">{site.imageryNotice}</p>}</section>

      <section className="container-x project-story-grid text-oxblood"><div className="project-story-lead"><Reveal><p className="editorial-label text-taupe">Design concept</p><p className="h-statement mt-7" data-testid="project-concept">{project.concept}</p></Reveal></div><div className="project-story-details"><Reveal delay={.1}><p className="label text-taupe">Materials &amp; finishes</p><ul className="service-feature-list" data-testid="project-materials">{project.materials.map((material) => <li key={material}>{material}</li>)}</ul></Reveal><Reveal delay={.15}><p className="label text-taupe">Key features</p><ul className="service-feature-list" data-testid="project-features">{project.features.map((feature) => <li key={feature}>{feature}</li>)}</ul></Reveal></div></section>

      <section className="container-x pb-[var(--section-y)]"><div className="chapter-top"><p className="editorial-label">The image edit</p><p>Material, proportion and the relationship between one room and the next.</p></div><div className="project-gallery-grid" data-testid="project-gallery">{project.gallery.map((image, index) => <Reveal key={index} delay={(index % 2) * .08}><button type="button" onClick={() => setLightboxIndex(index + 1)} className="img-zoom block w-full" data-testid={`project-gallery-${index}`} aria-label={`Open image ${index + 1}`}><Picture image={image} ratio={index % 2 === 0 ? "4 / 3" : "4 / 5"} sizes="(min-width:768px) 55vw,100vw" /></button></Reveal>)}</div></section>

      <section className="border-t border-line"><Link to={`/projects/${next.slug}`} data-testid="project-next" className="project-next-link group container-x flex items-center justify-between gap-6 py-10 md:py-16"><div><p className="label text-taupe">Continue through the collection</p><p className="h-section mt-3 text-oxblood">{next.title}</p></div><span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-oxblood/25 text-oxblood transition-[background-color,color,transform] duration-500 group-hover:rotate-45 group-hover:bg-oxblood group-hover:text-white"><ArrowUpRight className="h-5 w-5" /></span></Link></section>
      <CtaBand lines={["Imagine a space", <em>of your own.</em>]} text="Tell us about your home and we'll begin with a conversation about how you live." whatsappMessage={`Hi Suvi Interior, I saw the "${project.title}" project on your website and would like to discuss something similar for my home.`} testId="project-cta" />
      <Lightbox items={images} index={lightboxIndex} onClose={() => setLightboxIndex(null)} onChange={setLightboxIndex} />
    </PageWrap>
  );
}
