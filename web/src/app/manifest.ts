import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Close Knit",
    short_name: "Close Knit",
    description: "Free, source-linked neighbourhood analytics; London in depth.",
    start_url: "/",
    display: "standalone",
    background_color: "#f4f7fa",
    theme_color: "#f4f7fa",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
