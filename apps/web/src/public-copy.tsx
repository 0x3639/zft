import React, { useRef, useState } from "react";
import { Modal } from "./site-controls";

/** Use only for public identifiers and canonical page links, never bearer keys. */
export async function writePublicText(value: string) {
  await navigator.clipboard.writeText(value);
}

export function CopyPublic({
  value,
  label,
  children,
  className = "nom-btn nom-btn--outline nom-btn--default",
}: {
  value: string;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [busy, setBusy] = useState(false),
    [copied, setCopied] = useState<string>(),
    [fallback, setFallback] = useState<string>();
  const input = useRef<HTMLTextAreaElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        title={value}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setCopied(undefined);
          try {
            await writePublicText(value);
            setCopied(value);
          } catch {
            setFallback(value);
          } finally {
            setBusy(false);
          }
        }}
      >
        {children}
      </button>
      <span className="copy-status" role="status">
        {copied === value ? `${label} copied` : ""}
      </span>
      {fallback !== undefined && (
        <Modal
          title={`Copy ${label.toLowerCase()}`}
          onClose={() => setFallback(undefined)}
        >
          <p>
            Your browser couldn’t copy automatically. Select the public value
            below and use your device’s Copy command.
          </p>
          <label>
            {label}
            <textarea
              ref={input}
              readOnly
              value={fallback}
              rows={3}
              className="mono"
            />
          </label>
          <button
            type="button"
            className="nom-btn nom-btn--outline nom-btn--default"
            onClick={() => {
              input.current?.focus();
              input.current?.select();
            }}
          >
            Select value
          </button>
        </Modal>
      )}
    </>
  );
}
