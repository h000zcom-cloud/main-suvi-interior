const KEY = "suvi-intro-seen-v2";

let seen = true;
try {
  seen = window.sessionStorage.getItem(KEY) === "1";
} catch {
  // Storage restrictions must never prevent the site from rendering.
}

export const showIntro = !seen;

// Mark the flourish complete only after its exit finishes. If a first visit is
// interrupted halfway through, the next load can still present the full sequence.
export const markIntroSeen = () => {
  try {
    window.sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage restrictions are non-fatal; the loader remains a visual enhancement.
  }
};

// Hero motion starts immediately behind the opaque curtain and is settled by the
// time the curtain lifts, avoiding a second, serial animation delay.
export const introDelay = 0;
