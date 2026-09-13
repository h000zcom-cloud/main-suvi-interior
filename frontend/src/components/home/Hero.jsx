import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { SplitLines } from "@/components/motion/Reveal";
import { heroImage, introPortrait, img } from "@/content/images";
import { site } from "@/content/site";
import { imgUrl, srcSetFor } from "@/lib/images";
import { introDelay } from "@/lib/intro";
import { EASE } from "@/lib/motion";
import { cn } from "@/lib/utils";

const SLIDES = [
  { image: heroImage, title: "Living Spaces", caption: "Walnut media wall · linen & brass", pos: "object-[78%_center] sm:object-[60%_center] lg:object-center" },
  { image: img.kitchenWoodDark, title: "Modular Kitchens", caption: "Oak cabinetry · stone worktop", pos: "object-center" },
  { image: introPortrait, title: "Bedroom Interiors", caption: "Slatted headboard wall · soft light", pos: "object-[center_35%]" },
];
const INTERVAL = 6800;
const facets = ["Design", "Manufacture", "Install"];

export const Hero = () => {
  const ref = useRef(null);
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [started, setStarted] = useState(false);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const imageY = useTransform(scrollYProgress, [0, 1], ["0%", "10%"]);
  const copyY = useTransform(scrollYProgress, [0, 1], ["0%", "16%"]);

  useEffect(() => {
    const timer = setTimeout(() => setStarted(true), introDelay * 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!started || reduce) return;
    const timer = setInterval(() => setActive((current) => (current + 1) % SLIDES.length), INTERVAL);
    return () => clearInterval(timer);
  }, [started, reduce, active]);

  const enter = (delay) => ({
    initial: reduce ? false : { opacity: 0, y: 18 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: .9, ease: EASE, delay: introDelay + delay },
  });

  return (
    <section ref={ref} data-testid="hero" className="home-hero hero-shell relative min-h-[680px] overflow-hidden bg-night text-ivory">
      <motion.div className="absolute -inset-y-[10%] inset-x-0" style={reduce ? undefined : { y: imageY }}>
        {SLIDES.map((slide, index) => (
          <motion.div key={slide.title} className="absolute inset-0" initial={false} animate={{ opacity: active === index ? 1 : 0 }} transition={{ duration: 1.6, ease: EASE }} aria-hidden={active !== index}>
            <motion.img src={imgUrl(slide.image, 1920)} srcSet={srcSetFor(slide.image)} sizes="100vw" alt={slide.image.alt} fetchPriority={index === 0 ? "high" : undefined} loading={index === 0 ? "eager" : "lazy"} decoding="async" initial={false} animate={{ scale: active === index && started && !reduce ? 1.07 : 1 }} transition={{ duration: active === index ? (INTERVAL + 1600) / 1000 : 1.5, ease: "linear" }} className={cn("h-full w-full object-cover will-change-transform", slide.pos)} />
          </motion.div>
        ))}
        <div className="hero-ambient" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 h-[72%] bg-gradient-to-t from-night/90 via-night/35 to-transparent" aria-hidden="true" />
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.3, delay: introDelay + .5 }} className="frame-inset hidden sm:block" aria-hidden="true" />

      <motion.div style={reduce ? undefined : { y: copyY }} className="container-x hero-content relative z-10 flex flex-col justify-end pb-[calc(env(safe-area-inset-bottom)+6.5rem)] sm:pb-16 lg:pb-14">
        <motion.div {...enter(.1)} className="hero-topline">
          <p className="label flex items-center gap-3 text-ivory/75" data-testid="hero-meta"><span className="h-px w-8 bg-brass" aria-hidden="true" />{site.city} · {site.region}</p>
          <p className="hero-service-note">Interior design · Custom furniture</p>
        </motion.div>

        <SplitLines as="h1" data-testid="hero-heading" delay={introDelay} lines={["Interiors that", "feel like", <span className="italic text-brass">home.</span>]} className="editorial-heading hero-title" />

        <div className="hero-copy-grid">
          <motion.p {...enter(.42)} className="hero-description">A design and furniture studio in Nashik. We draw the home, then make every piece in it—so one clear idea carries from the first line to the final detail.</motion.p>
          <motion.div {...enter(.54)} className="hero-actions">
            <Link to="/contact" data-testid="hero-secondary-cta" className="btn-light">Plan your project<ArrowRight className="h-4 w-4" strokeWidth={1.4} /></Link>
            <Link to="/projects" data-testid="hero-primary-cta" className="btn-text-light">Explore our work<ArrowRight className="h-4 w-4" strokeWidth={1.4} /></Link>
          </motion.div>
        </div>

        <motion.div {...enter(.7)} className="hero-slide-deck" data-testid="hero-slides">
          <ul className="hero-facets" aria-label="What we do">{facets.map((facet, index) => <li key={facet} className="label flex items-center gap-5 text-ivory/52">{index > 0 && <span className="h-1 w-1 rotate-45 bg-brass/70" aria-hidden="true" />}{facet}</li>)}</ul>
          <div className="hero-slide-control">
            <AnimatePresence mode="wait"><motion.p key={active} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: .45, ease: EASE }} className="label text-ivory/72" data-testid="hero-slide-caption"><span className="text-brass">0{active + 1}</span><span className="mx-2 text-ivory/30">/</span>{SLIDES[active].title}<span className="hidden text-ivory/45 md:inline"> · {SLIDES[active].caption}</span></motion.p></AnimatePresence>
            <div className="hero-slide-lines" role="group" aria-label="Hero slides">{SLIDES.map((slide, index) => <button key={slide.title} type="button" aria-pressed={active === index} aria-label={`Show ${slide.title}`} data-testid={`hero-slide-${index}`} onClick={() => setActive(index)} className="hero-slide-button group"><span className={cn("relative block h-px overflow-hidden bg-ivory/25 transition-[width] duration-500", active === index ? "w-12" : "w-7 group-hover:bg-ivory/50")}>{active === index && started && <span key={`${index}-${active}`} className={cn("absolute inset-0 origin-left bg-brass", !reduce && "animate-fillbar")} style={{ animationDuration: `${INTERVAL}ms` }} />}</span></button>)}</div>
          </div>
        </motion.div>
      </motion.div>

      <div className="hero-edition" aria-hidden="true">Suvi Interior · Est. Nashik</div>
    </section>
  );
};
