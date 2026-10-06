import React, { useEffect, useRef, useState } from "react";
import {
  PROFILE_MEDIA,
  profileMediaURL,
  type MediaKind,
} from "../../../packages/protocol/profile-media";
import { cropRect, type Crop } from "../../../packages/file-codec/profile-crop";
import { base64 } from "../../../packages/vault";
import { Modal } from "./site-controls";

const button = "nom-btn nom-btn--outline nom-btn--default";
export type MediaDraft = { image: string } | null | undefined;
export function ProfileImage({
  src,
  fallback,
  className,
}: {
  src?: string | null;
  fallback?: React.ReactNode;
  className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  return src && failed !== src ? (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(src)}
    />
  ) : (
    <>{fallback}</>
  );
}
function CropDialog({
  file,
  kind,
  onClose,
  onUse,
}: {
  file: File;
  kind: MediaKind;
  onClose: () => void;
  onUse: (bytes: Uint8Array) => void;
}) {
  const worker = useRef<Worker | undefined>(undefined);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<{
    url: string;
    width: number;
    height: number;
  }>();
  const [crop, setCrop] = useState<Crop>({ x: 50, y: 50, zoom: 1 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const applying = useRef(false);
  const useImage = useRef(onUse);
  useImage.current = onUse;
  useEffect(() => {
    const w = new Worker(
      new URL("./profile-image.worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.current = w;
    let active = true,
      url: string | undefined;
    w.onmessage = ({ data }) => {
      if (!active) return;
      if (data.error) {
        setError(data.error);
        setBusy(false);
        applying.current = false;
      }
      if (data.loaded) {
        url = URL.createObjectURL(
          new Blob([data.loaded.bytes], { type: "image/png" }),
        );
        setLoaded({
          url,
          width: data.loaded.width,
          height: data.loaded.height,
        });
      }
      if (data.cropped) useImage.current(data.cropped);
    };
    w.onerror = () => {
      if (active) {
        setError("Could not process this image. Choose another file.");
        setBusy(false);
        applying.current = false;
      }
    };
    void file
      .arrayBuffer()
      .then((bytes) => {
        if (active) w.postMessage({ bytes, kind }, [bytes]);
      })
      .catch(() => {
        if (active) setError("Could not read this file.");
      });
    return () => {
      active = false;
      w.terminate();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file, kind]);
  useEffect(() => {
    if (!loaded) return;
    let active = true;
    const image = new Image();
    image.onload = () => {
      const context = canvas.current?.getContext("2d");
      if (!active || !context) return;
      const r = cropRect(loaded.width, loaded.height, kind, crop),
        target = PROFILE_MEDIA[kind];
      context.clearRect(0, 0, target.width, target.height);
      context.drawImage(
        image,
        r.x,
        r.y,
        r.width,
        r.height,
        0,
        0,
        target.width,
        target.height,
      );
    };
    image.src = loaded.url;
    return () => {
      active = false;
    };
  }, [loaded, kind, crop]);
  return (
    <Modal title={`Crop ${kind}`} onClose={onClose}>
      <p>
        Adjust the frame. Your image stays on this device until you save your
        profile.
      </p>
      {loaded ? (
        <canvas
          className={`crop-preview crop-${kind}`}
          ref={canvas}
          width={PROFILE_MEDIA[kind].width}
          height={PROFILE_MEDIA[kind].height}
          aria-label={`${kind} crop preview`}
          role="img"
        />
      ) : (
        !error && <p role="status">Preparing image…</p>
      )}
      {(
        [
          ["x", "Horizontal position", 0, 100, 1],
          ["y", "Vertical position", 0, 100, 1],
          ["zoom", "Zoom", 1, 3, 0.05],
        ] as const
      ).map(([key, label, min, max, step]) => (
        <label className="crop-control" key={key}>
          {label}
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={crop[key]}
            disabled={!loaded || busy}
            onChange={(e) =>
              setCrop((old) => ({ ...old, [key]: Number(e.target.value) }))
            }
          />
          <output>
            {key === "zoom" ? `${crop[key].toFixed(2)}×` : `${crop[key]}%`}
          </output>
        </label>
      ))}
      {error && <p role="alert">{error}</p>}
      <div className="actions">
        <button type="button" className={button} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="nom-btn nom-btn--primary nom-btn--default"
          disabled={!loaded || busy}
          onClick={() => {
            if (applying.current) return;
            applying.current = true;
            setBusy(true);
            worker.current?.postMessage({ kind, crop });
          }}
        >
          {busy ? "Applying…" : "Use image"}
        </button>
      </div>
    </Modal>
  );
}
export function ProfileMediaEditor({
  kind,
  address,
  saved,
  value,
  onChange,
  disabled,
}: {
  kind: MediaKind;
  address: string;
  saved?: string | null;
  value: MediaDraft;
  onChange: (value: MediaDraft) => void;
  disabled: boolean;
}) {
  const [file, setFile] = useState<File>();
  const [error, setError] = useState("");
  const src = value
    ? `data:image/png;base64,${value.image}`
    : value === null
      ? null
      : profileMediaURL(address, saved);
  return (
    <div className={`media-editor media-${kind}`}>
      <div className="media-label">
        {kind === "avatar" ? "Profile picture" : "Cover image"}
      </div>
      <div className="media-preview">
        <ProfileImage
          src={src}
          fallback={
            <span>
              {kind === "avatar"
                ? address.slice(2, 4).toUpperCase()
                : "KEEP IT. PASS IT ON."}
            </span>
          }
        />
      </div>
      <label className="media-file-label">
        Choose {kind}
        <input
          aria-label={`Choose ${kind}`}
          type="file"
          accept="image/png,image/jpeg"
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.files?.[0];
            e.target.value = "";
            setError("");
            if (!next) return;
            if (!next.size || next.size > 10 * 1024 * 1024) {
              setError("Choose a JPG or PNG up to 10 MiB.");
              return;
            }
            setFile(next);
          }}
        />
      </label>
      <div className="actions">
        <button
          type="button"
          className="text-button"
          disabled={disabled || !src}
          onClick={() => onChange(null)}
        >
          Reset to default
        </button>
        {value !== undefined && (
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() => onChange(undefined)}
          >
            Undo change
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      {file && (
        <CropDialog
          file={file}
          kind={kind}
          onClose={() => setFile(undefined)}
          onUse={(bytes) => {
            onChange({ image: base64(bytes) });
            setFile(undefined);
          }}
        />
      )}
    </div>
  );
}
