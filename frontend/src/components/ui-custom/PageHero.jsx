import { Picture } from "@/components/motion/Picture";
import { cn } from "@/lib/utils";

const HeroTitle = ({ lines }) => (
  <h1 className="editorial-heading masthead-title" data-testid="page-heading">
    {lines.map((line, index) => (
      <span className="masthead-title-line" key={index}>
        {line}
      </span>
    ))}
  </h1>
);

export const PageHero = ({ label, lines, image, text, className, imgClassName, children }) => {
  if (image) {
    return (
      <section className={cn("photo-masthead", className)} data-testid="page-hero">
        <Picture image={image} priority className="absolute inset-0" imgClassName={cn("photo-masthead-image", imgClassName)} />
        <div className="container-x photo-masthead-copy">
          <p className="editorial-label mb-7 text-white/80" data-testid="page-hero-label">{label}</p>
          <HeroTitle lines={lines} />
          <div className="mt-7 grid max-w-4xl gap-5 border-t border-white/25 pt-5 sm:grid-cols-[1fr_auto] sm:items-start">
            {text && <p className="editorial-lede text-white/80" data-testid="page-hero-description">{text}</p>}
            <p className="label hidden text-right text-white/55 sm:block" aria-hidden="true">Nashik · India<br />Design &amp; make</p>
          </div>
          {children}
        </div>
      </section>
    );
  }

  return (
    <section className={cn("masthead", className)} data-testid="page-hero">
      <div className="container-x masthead-inner">
        <div>
          <p className="editorial-label" data-testid="page-hero-label">{label}</p>
          <HeroTitle lines={lines} />
        </div>
        <div className="masthead-note">
          {text && <p data-testid="page-hero-description">{text}</p>}
          {children}
        </div>
      </div>
    </section>
  );
};
