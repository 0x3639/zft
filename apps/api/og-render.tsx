import {
  BRAND_REVISION,
  BRAND_LOCKUP_DARK,
  BRAND_MARK_DARK,
} from "../../packages/protocol/brand";
import React from "react";
import satori, { init } from "satori/standalone";
import yoga from "satori/yoga.wasm";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvg from "@resvg/resvg-wasm/index_bg.wasm";
import space from "@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff";
import mono from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff";
import type { Snapshot } from "./sharing";
import type { Env } from "./types";
import { base64 } from "../../packages/vault";
import {
  thumbnail,
  THUMBNAIL_VERSION,
} from "../../packages/file-codec/thumbnail";
import { sha256 } from "viem";

let initialized: Promise<unknown> | undefined;
export async function renderOG(page: Snapshot, env: Env) {
  initialized ??= Promise.all([init(yoga), initWasm(resvg)]);
  await initialized;
  const profileImage = async (hash?: string | null) => {
    if (!hash || !page.profileMedia) return null;
    try {
      const key = `profile-media/${page.profileMedia.address}/${hash.slice(2)}`;
      let object = await env.MEDIA.get(`${key}/${THUMBNAIL_VERSION}.png`);
      let bytes: Uint8Array;
      if (object) bytes = new Uint8Array(await object.arrayBuffer());
      else {
        object = await env.MEDIA.get(`${key}.png`);
        if (!object || object.size > 2_600_000) return null;
        const original = new Uint8Array(await object.arrayBuffer());
        if (sha256(original) !== hash) return null;
        bytes = await thumbnail(original);
        await env.MEDIA.put(`${key}/${THUMBNAIL_VERSION}.png`, bytes, {
          httpMetadata: { contentType: "image/png" },
        });
      }
      return bytes.length <= 1_048_576
        ? `data:image/png;base64,${base64(bytes)}`
        : null;
    } catch {
      return null;
    }
  };
  const avatar = await profileImage(page.profileMedia?.avatar);
  const cover = await profileImage(page.profileMedia?.cover);
  // Only admitted, immutable R2 art; never URLs supplied by metadata or requests.
  const images: (string | null)[] = [];
  for (const art of page.art.slice(0, 3)) {
    try {
      const key = `preview/${art.hash.slice(2)}/${THUMBNAIL_VERSION}.png`;
      let object = await env.MEDIA.get(key);
      let bytes: Uint8Array;
      if (object) bytes = new Uint8Array(await object.arrayBuffer());
      else {
        object = await env.MEDIA.get(`art/${art.hash.slice(2)}.png`);
        if (!object || object.size > 10 * 1024 * 1024)
          throw new Error("Missing art");
        const original = new Uint8Array(await object.arrayBuffer());
        if (sha256(original) !== art.hash)
          throw new Error("Art digest mismatch");
        bytes = await thumbnail(original);
        await env.MEDIA.put(key, bytes, {
          httpMetadata: { contentType: "image/png" },
        });
      }
      images.push(
        bytes.length <= 1_048_576
          ? `data:image/png;base64,${base64(bytes)}`
          : null,
      );
    } catch {
      images.push(null);
    }
  }
  const branded = page.branding === BRAND_REVISION;
  const brandImage = (svg: string) =>
    `data:image/svg+xml;base64,${base64(new TextEncoder().encode(svg))}`;
  const title = Array.from(
    page.title.replace(/[^\u0020-\u024f\u2000-\u206f]/gu, "·"),
  )
    .slice(0, 82)
    .join("");
  const svg = await satori(
    <div
      style={{
        width: 1200,
        height: 630,
        display: "flex",
        background: "#090e13",
        color: "#f0f4f5",
        fontFamily: "Space",
        padding: 58,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {cover && (
        <img
          src={cover}
          width={1200}
          height={630}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            objectFit: "cover",
            opacity: 0.16,
          }}
        />
      )}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: 1200,
          height: 6,
          background: "#00d994",
        }}
      />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: 660,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          {avatar && (
            <img
              src={avatar}
              width={64}
              height={64}
              style={{ borderRadius: 32, objectFit: "cover" }}
            />
          )}
          {branded ? (
            <img src={brandImage(BRAND_LOCKUP_DARK)} width={160} height={48} />
          ) : (
            <span style={{ fontSize: 50, letterSpacing: -3 }}>
              zft<span style={{ color: "#00d994" }}>.</span>
            </span>
          )}
          <span style={{ fontFamily: "Mono", fontSize: 16, color: "#00d994" }}>
            ZVM DEVNET
          </span>
        </div>
        <div
          style={{ display: "flex", flexDirection: "column", paddingRight: 45 }}
        >
          <span
            style={{
              fontFamily: "Mono",
              fontSize: 15,
              color: "#9caaad",
              marginBottom: 24,
            }}
          >
            {page.label.toUpperCase()}
          </span>
          <span
            style={{
              fontSize: title.length > 48 ? 48 : 62,
              lineHeight: 1.08,
              letterSpacing: -2,
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontFamily: "Mono",
              fontSize: 17,
              color: "#9caaad",
              marginTop: 26,
            }}
          >
            {page.subtitle}
          </span>
        </div>
        <span style={{ fontFamily: "Mono", fontSize: 16, color: "#829496" }}>
          ZFT.FOO / KEEP IT. PASS IT ON.
        </span>
      </div>
      <div
        style={{
          width: 420,
          height: 420,
          marginTop: 44,
          display: "flex",
          position: "relative",
        }}
      >
        {images.filter(Boolean).length ? (
          images
            .map((src, i) => ({ src, i }))
            .reverse()
            .map(
              ({ src, i }) =>
                src && (
                  <div
                    key={i}
                    style={{
                      display: "flex",
                      position: "absolute",
                      top: i * 22,
                      left: i * 16,
                      width: 365,
                      height: page.art[i]?.title ? 401 : 365,
                      flexDirection: "column",
                      padding: 12,
                      borderRadius: 22,
                      background: "#16242a",
                      border: "1px solid #385146",
                      transform: `rotate(${i * 7 - 5}deg)`,
                    }}
                  >
                    <img
                      src={src}
                      width={341}
                      height={341}
                      style={{ objectFit: "cover", borderRadius: 14 }}
                    />
                    {page.art[i]?.title && (
                      <span
                        style={{
                          fontSize: 18,
                          paddingTop: 7,
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {page.art[i].title!.slice(0, 28)}
                      </span>
                    )}
                  </div>
                ),
            )
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 375,
              height: 395,
              background: "#12291f",
              border: "1px solid #286345",
              borderRadius: 30,
              transform: "rotate(7deg)",
              color: "#00d994",
              fontSize: 180,
            }}
          >
            {branded ? (
              <img src={brandImage(BRAND_MARK_DARK)} width={180} height={180} />
            ) : (
              "Z"
            )}
          </div>
        )}
      </div>
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Space", data: space, weight: 700 },
        { name: "Mono", data: mono, weight: 400 },
      ],
    },
  );
  const renderer = new Resvg(svg, { fitTo: { mode: "width", value: 1200 } });
  const rendered = renderer.render();
  try {
    return rendered.asPng().slice();
  } finally {
    rendered.free();
    renderer.free();
  }
}
