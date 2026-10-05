import React, { useEffect, useRef, useState, type ReactNode } from "react";
import { getAddress } from "viem";
const btn = "nom-btn nom-btn--outline nom-btn--default";
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    close = useRef(onClose),
    origin = useRef(document.activeElement as HTMLElement | null);
  close.current = onClose;
  const titleId = React.useId();
  useEffect(() => {
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      if (origin.current?.isConnected)
        origin.current.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={wide ? "item-dialog" : "site-dialog"}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
    >
      <div className="dialog-bar">
        <h2 id={titleId}>{title}</h2>
        <button
          className={btn}
          onClick={() => close.current()}
          aria-label="Close dialog"
          autoFocus
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ThemeControl() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("zft-theme");
      return saved && ["light", "dark"].includes(saved) ? saved : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle(
        "dark",
        theme === "dark" || (theme === "system" && media.matches),
      );
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem("zft-theme", theme);
    } catch {}
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return (
    <label className="theme-control">
      <span className="sr-only">Color theme</span>
      <select value={theme} onChange={(e) => setTheme(e.target.value)}>
        <option value="system">◐ System</option>
        <option value="light">☀ Light</option>
        <option value="dark">☾ Dark</option>
      </select>
    </label>
  );
}
export function profileLocation(input: string, origin: string) {
  let address = input.trim();
  if (address.startsWith("https://") || address.startsWith("http://")) {
    const url = new URL(address);
    if (
      ![origin, "https://zft.foo", "https://devnet.zft.foo"].includes(
        url.origin,
      ) ||
      url.username ||
      url.password ||
      url.hash ||
      !/^\/p\/0x[\da-fA-F]{40}\/?$/.test(url.pathname)
    )
      throw new Error("Use a ZFT profile address or profile link.");
    address = url.pathname.split("/")[2];
  }
  try {
    return `/p/${getAddress(address).toLowerCase()}`;
  } catch {
    throw new Error("Enter a valid ZVM profile address or ZFT profile link.");
  }
}
export function ProfileLookup({ nav }: { nav: (s: string) => void }) {
  const [open, setOpen] = useState(false),
    [value, setValue] = useState(""),
    [error, setError] = useState("");
  return (
    <>
      <button
        className="text-button"
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        Open by public identity
      </button>
      {open && (
        <Modal title="Find a profile" onClose={() => setOpen(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const path = profileLocation(value, location.origin);
                setOpen(false);
                nav(path);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label>
              Profile address or link
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0x… or https://devnet.zft.foo/p/…"
                required
              />
            </label>
            {error && <p role="alert">{error}</p>}
            <button className={btn} type="submit">
              Open profile
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
