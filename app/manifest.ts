import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Aura CRM — Ювелирный магазин",
    short_name: "Aura CRM",
    description: "Автономная Local-First CRM-система для ювелирного ритейла",
    start_url: "/crm/pos",
    display: "standalone",
    background_color: "#FAFAF9",
    theme_color: "#125059",
    orientation: "any",
    icons: [
      {
        src: "/android-chrome-192x192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png",
      },
    ],
  }
}
