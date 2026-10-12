import React, { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  GalleryHome,
  GalleryDetail,
  GalleryHelp,
  PublicShell,
} from "./gallery";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "../../../design/vendor/zenon/tokens/colors.css";
import "../../../design/vendor/zenon/tokens/typography.css";
import "../../../design/vendor/zenon/tokens/radius.css";
import "../../../design/vendor/zenon/tokens/elevation.css";
import "../../../design/vendor/zenon/tokens/utilities.css";
import "../../../design/vendor/zenon/components/components.css";
import "./styles.css";
const ShieldedApp = __SHIELDED_CANDIDATE__
  ? lazy(() => import("./shielded/app"))
  : undefined;
const path = location.pathname;
const detail = /^\/nft\/(0x[0-9a-f]{64})$/.exec(path);
const page =
  path.startsWith("/shielded") && ShieldedApp ? (
    <Suspense fallback={<p role="status">Opening collection…</p>}>
      <ShieldedApp />
    </Suspense>
  ) : path === "/" ? (
    <GalleryHome />
  ) : detail ? (
    <GalleryDetail assetId={detail[1]} />
  ) : path === "/how-it-works" ? (
    <GalleryHelp />
  ) : (
    <PublicShell>
      <h1>Page not found</h1>
      <a href="/">Open the shielded gallery</a>
    </PublicShell>
  );
createRoot(document.getElementById("root")!).render(page);
