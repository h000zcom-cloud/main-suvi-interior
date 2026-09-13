import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useLenis } from "lenis/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { imgUrl } from "@/lib/images";

export const Lightbox = ({ items, index, onClose, onChange }) => {
  const lenis = useLenis();
  const dialog = useRef(null);
  const touchX = useRef(null);
  const open = index !== null && index >= 0 && index < items.length;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    const oldOverflow = document.body.style.overflow;
    const background = [...document.querySelectorAll("[data-testid='site-header'], main, [data-testid='site-footer'], [data-testid='mobile-sticky-bar'], [data-testid='whatsapp-float']")].map((node) => ({ node, inert: node.inert, ariaHidden: node.getAttribute("aria-hidden") }));
    document.body.style.overflow = "hidden";
    background.forEach(({ node }) => { node.inert = true; node.setAttribute("aria-hidden", "true"); });
    lenis?.stop();
    dialog.current?.querySelector("button")?.focus();
    return () => {
      document.body.style.overflow = oldOverflow;
      background.forEach(({ node, inert, ariaHidden }) => {
        node.inert = inert;
        if (ariaHidden === null) node.removeAttribute("aria-hidden");
        else node.setAttribute("aria-hidden", ariaHidden);
      });
      lenis?.start();
      previous?.focus?.();
    };
  }, [open, lenis]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "ArrowRight") { event.preventDefault(); onChange((index + 1) % items.length); }
      if (event.key === "ArrowLeft") { event.preventDefault(); onChange((index - 1 + items.length) % items.length); }
      if (event.key === "Tab") {
        const controls = [...dialog.current.querySelectorAll("button")];
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, items.length, onClose, onChange]);

  if (!open) return null;
  const item = items[index];
  const go = (direction) => onChange((index + direction + items.length) % items.length);

  return createPortal(
    <div ref={dialog} role="dialog" aria-modal="true" aria-label="Image viewer" data-testid="lightbox" className="fixed inset-0 z-[100] flex flex-col bg-oxblood-deep text-white" onTouchStart={(event) => { touchX.current = event.touches[0].clientX; }} onTouchEnd={(event) => { if (touchX.current !== null) { const delta = event.changedTouches[0].clientX - touchX.current; if (Math.abs(delta) > 50) go(delta < 0 ? 1 : -1); touchX.current = null; } }}>
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/15 px-5 sm:px-8"><p className="label text-white/65" data-testid="lightbox-counter">{String(index + 1).padStart(2,"0")} / {String(items.length).padStart(2,"0")}</p><button type="button" onClick={onClose} data-testid="lightbox-close" aria-label="Close image viewer" className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20"><X className="h-5 w-5" /></button></div>
      <div className="lightbox-stage"><img src={imgUrl(item,1920)} alt={item.alt || ""} data-testid="lightbox-image" /><button type="button" onClick={() => go(-1)} data-testid="lightbox-prev" aria-label="Previous image" className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 backdrop-blur sm:left-6"><ChevronLeft className="h-5 w-5" /></button><button type="button" onClick={() => go(1)} data-testid="lightbox-next" aria-label="Next image" className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-black/30 backdrop-blur sm:right-6"><ChevronRight className="h-5 w-5" /></button></div>
      <p className="shrink-0 border-t border-white/15 px-6 py-5 text-center text-xs text-white/70" data-testid="lightbox-caption">{item.alt}</p>
    </div>,
    document.body,
  );
};
