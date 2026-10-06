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
          type="button"
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
function ThemeIcon({ theme }: { theme: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {theme === "light" ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path
            d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"
            strokeLinecap="round"
          />
        </>
      ) : theme === "dark" ? (
        <path
          d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path
            d="M12 3.5a8.5 8.5 0 0 1 0 17Z"
            fill="currentColor"
            stroke="none"
          />
        </>
      )}
    </svg>
  );
}
export function ThemeControl() {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null);
  const optionsId = React.useId();
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem("zft-theme");
      return saved && ["light", "dark"].includes(saved) ? saved : "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    if (!open) return;
    const dismiss = (e: PointerEvent) => {
      if (!container.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
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
    <div className="theme-control" ref={container}>
      <button
        ref={trigger}
        type="button"
        className="theme-toggle"
        aria-label={`Color theme: ${theme}`}
        title="Change color theme"
        aria-expanded={open}
        aria-controls={optionsId}
        onClick={() => setOpen(!open)}
      >
        <ThemeIcon theme={theme} />
      </button>
      {open && (
        <div
          className="theme-options"
          id={optionsId}
          role="group"
          aria-label="Color theme"
        >
          {(["system", "light", "dark"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="theme-option"
              aria-pressed={theme === value}
              onClick={() => {
                setTheme(value);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <ThemeIcon theme={value} />
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      )}
    </div>
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
