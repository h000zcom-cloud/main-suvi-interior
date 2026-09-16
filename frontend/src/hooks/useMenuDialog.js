import { useLayoutEffect } from "react";
import { useLenis } from "lenis/react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export const useMenuDialog = (ref, onClose) => {
  const lenis = useLenis();

  // The component remains mounted through its Framer Motion exit. Cleanup therefore
  // restores scroll and focus only after the closing panel has actually left screen.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;

    const html = document.documentElement;
    const body = document.body;
    const previousFocus = document.activeElement;
    const scrollY = window.scrollY;
    const previousStyles = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyWidth: body.style.width,
    };
    const openedAt = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const background = document.querySelector("[data-testid='public-app-background']");
    const previousState = background
      ? { inert: background.inert, ariaHidden: background.getAttribute("aria-hidden") }
      : null;
    const shouldRestartLenis = Boolean(lenis && !lenis.isStopped);

    if (background) {
      background.inert = true;
      background.setAttribute("aria-hidden", "true");
    }
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";
    if (shouldRestartLenis) lenis.stop();

    const focusFrame = window.requestAnimationFrame(() => {
      dialog.querySelector("[data-testid='mobile-menu-close']")?.focus();
    });

    const getControls = () => [...dialog.querySelectorAll(FOCUSABLE)]
      .filter((node) => node.getClientRects().length > 0 && !node.hasAttribute("inert"));

    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const controls = getControls();
      if (!controls.length) {
        event.preventDefault();
        return;
      }
      const first = controls[0];
      const last = controls[controls.length - 1];
      const focusOutside = !dialog.contains(document.activeElement);

      if (focusOutside || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKey, true);
      if (background && previousState) {
        background.inert = previousState.inert;
        if (previousState.ariaHidden === null) background.removeAttribute("aria-hidden");
        else background.setAttribute("aria-hidden", previousState.ariaHidden);
      }
      html.style.overflow = previousStyles.htmlOverflow;
      body.style.overflow = previousStyles.bodyOverflow;
      body.style.position = previousStyles.bodyPosition;
      body.style.top = previousStyles.bodyTop;
      body.style.width = previousStyles.bodyWidth;

      // PageWrap owns scroll-to-top after navigation. Replaying the old route's
      // captured offset after the 500ms exit would overwrite that destination state.
      const closedAt = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (closedAt === openedAt) {
        window.scrollTo({ top: scrollY, left: 0, behavior: "auto" });
      }
      if (shouldRestartLenis) lenis.start();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [ref, onClose, lenis]);
};
