import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useLenis } from "lenis/react";
import { markIntroSeen, showIntro } from "@/lib/intro";
import { EASE } from "@/lib/motion";
import { Wordmark } from "@/components/ui-custom/Wordmark";

const HOLD_MS = 520;

const IntroSurface = () => {
  const lenis = useLenis();

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    const shouldRestartLenis = Boolean(lenis && !lenis.isStopped);
    const background = document.querySelector("[data-testid='public-app-background']");
    const previousInert = background?.inert;
    const previousAriaHidden = background?.getAttribute("aria-hidden") ?? null;

    if (background) {
      background.inert = true;
      background.setAttribute("aria-hidden", "true");
    }
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    if (shouldRestartLenis) lenis.stop();

    return () => {
      if (background) {
        background.inert = previousInert;
        if (previousAriaHidden === null) background.removeAttribute("aria-hidden");
        else background.setAttribute("aria-hidden", previousAriaHidden);
      }
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
      if (shouldRestartLenis) lenis.start();
    };
  }, [lenis]);

  return (
    <motion.div
      className="studio-intro"
      data-testid="preloader"
      aria-hidden="true"
      initial={{ y: 0 }}
      animate={{ y: 0 }}
      exit={{ y: "-100%" }}
      transition={{ duration: .5, ease: EASE }}
    >
      <div className="studio-intro-orbit" aria-hidden="true" />
      <motion.div
        className="studio-intro-frame"
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: .42, ease: EASE }}
      >
        <div className="studio-intro-meta"><span>Nashik</span><span>Design · Make · Install</span></div>
        <Wordmark className="studio-intro-wordmark" />
        <div className="studio-intro-progress">
          <motion.span
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: .48, ease: EASE, delay: .04 }}
          />
        </div>
        <div className="studio-intro-footer"><span>Interior design</span><span>Furniture studio</span></div>
      </motion.div>
    </motion.div>
  );
};

export const Preloader = () => {
  const reduce = useReducedMotion();
  const [visible, setVisible] = useState(showIntro);

  useEffect(() => {
    if (!visible) return undefined;
    if (reduce) {
      markIntroSeen();
      setVisible(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setVisible(false), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [visible, reduce]);

  return (
    <AnimatePresence onExitComplete={markIntroSeen}>
      {visible && !reduce ? <IntroSurface key="studio-intro" /> : null}
    </AnimatePresence>
  );
};
