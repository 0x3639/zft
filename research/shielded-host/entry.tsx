import React from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/700.css";
import "@fontsource/jetbrains-mono/400.css";
import "../../design/vendor/zenon/tokens/colors.css";
import "../../design/vendor/zenon/tokens/typography.css";
import "../../design/vendor/zenon/tokens/radius.css";
import "../../design/vendor/zenon/tokens/elevation.css";
import "../../design/vendor/zenon/tokens/utilities.css";
import "../../design/vendor/zenon/components/components.css";
import "../../apps/web/src/styles.css";
import ShieldedApp from "../../apps/web/src/shielded/app";
import configuration from "../shielded-devnet/evidence/app-config.json?raw";
const brand = (
  <span className="wordmark">
    <img
      className="brand-on-light"
      src="/shielded/brand/light.svg"
      width="120"
      height="36"
      alt="ZFT home"
    />
    <img
      className="brand-on-dark"
      src="/shielded/brand/dark.svg"
      width="120"
      height="36"
      alt="ZFT home"
    />
  </span>
);
createRoot(document.getElementById("root")!).render(
  <ShieldedApp testHost={{ configuration, brand }} />,
);
