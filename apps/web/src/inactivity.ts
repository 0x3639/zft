export function inactivityLock(
  target: EventTarget,
  lock: () => void,
  blocked: () => boolean,
  timeout = 15 * 60_000,
) {
  let lastActivity = Date.now();
  const touch = () => {
    lastActivity = Date.now();
  };
  const events = ["pointerdown", "keydown", "touchstart"];
  events.forEach((event) =>
    target.addEventListener(event, touch, { passive: true }),
  );
  const timer = setInterval(
    () => {
      if (!blocked() && Date.now() - lastActivity >= timeout) lock();
    },
    Math.min(timeout, 15_000),
  );
  return () => {
    clearInterval(timer);
    events.forEach((event) => target.removeEventListener(event, touch));
  };
}
