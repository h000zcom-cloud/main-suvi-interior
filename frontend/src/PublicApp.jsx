import { useCallback, useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
import { ReactLenis } from "lenis/react";
import { useReducedMotion } from "framer-motion";
import "lenis/dist/lenis.css";
import "@/App.css";
import "@/atelier.css";
import "@/brand-chrome.css";
import "@/routes-premium.css";
import { HeaderThemeProvider } from "@/components/layout/HeaderTheme";
import { Preloader } from "@/components/layout/Preloader";
import { Header } from "@/components/layout/Header";
import { MobileMenu } from "@/components/layout/MobileMenu";
import { Footer } from "@/components/layout/Footer";
import { WhatsAppFloat } from "@/components/layout/WhatsAppFloat";
import Home from "@/pages/Home";
import About from "@/pages/About";
import Services from "@/pages/Services";
import Projects from "@/pages/Projects";
import ProjectDetail from "@/pages/ProjectDetail";
import Gallery from "@/pages/Gallery";
import Contact from "@/pages/Contact";
import Process from "@/pages/Process";
import Brochure from "@/pages/Brochure";
import { Privacy, Terms, NotFound } from "@/pages/Legal";

function PublicShell() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    document.documentElement.classList.remove("admin-route");
    document.body.classList.remove("admin-route");
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setAnnouncement(document.title));
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);

  return (
    <HeaderThemeProvider>
      <a href="#main" className="skip-link" data-testid="skip-to-content">Skip to content</a>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      <Preloader />
      <Header menuOpen={menuOpen} onToggle={() => setMenuOpen((open) => !open)} />
      <MobileMenu open={menuOpen} onClose={closeMenu} />
      <Routes key={location.pathname}>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/services" element={<Services />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:slug" element={<ProjectDetail />} />
        <Route path="/gallery" element={<Gallery />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/process" element={<Process />} />
        <Route path="/brochure" element={<Brochure />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <Footer />
      <WhatsAppFloat hidden={menuOpen} />
    </HeaderThemeProvider>
  );
}

export default function PublicApp() {
  const reduceMotion = useReducedMotion();
  return (
    <ReactLenis root options={{ lerp: 0.085, smoothWheel: !reduceMotion, wheelMultiplier: 0.95 }}>
      <PublicShell />
    </ReactLenis>
  );
}
