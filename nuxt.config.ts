import { networkInterfaces } from "node:os";
const lanHost =
  Object.values(networkInterfaces())
    .flat()
    .find(
      (address) =>
        address &&
        address.family === "IPv4" &&
        !address.internal &&
        /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address),
    )?.address || "";
export default defineNuxtConfig({
  compatibilityDate: "2026-10-01",
  modules: ["@nuxt/ui", "@nuxtjs/i18n", "@nuxtjs/seo"],
  i18n: {
    strategy: "no_prefix",
    defaultLocale: "en",
    baseUrl: "https://bold.nembestil.dk",
    langDir: "locales",
    locales: [
      { code: "en", language: "en-GB", name: "English", file: "en.ts" },
      { code: "da", language: "da-DK", name: "Dansk", file: "da.ts" },
      { code: "tr", language: "tr-TR", name: "Türkçe", file: "tr.ts" },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: "nem-bold-language",
      fallbackLocale: "en",
      redirectOn: "all",
    },
    vueI18n: "./i18n.config.ts",
  },
  site: {
    url: "https://bold.nembestil.dk",
    name: "Nem Bold",
    description: "Play free 3D table football in your browser. Use your phone as a controller, invite friends with a QR code, or play against the computer. No account needed.",
    defaultLocale: "en-GB",
  },
  // The social card is a local image of the actual table; no runtime image service is needed.
  ogImage: false,
  aiReady: false,
  skewProtection: false,
  sitemap: { exclude: ["/controller", "/replay"] },
  routeRules: {
    "/controller": { robots: false },
    "/replay": { robots: false },
  },
  ui: { fonts: false },
  runtimeConfig: {
    public: { lanHost: process.env.NODE_ENV === "development" ? lanHost : "" },
  },
  css: ["~/assets/css/main.css"],
  ssr: true,
  devtools: { enabled: false },
  vite: {
    optimizeDeps: {
      include: [
        "@dimforge/rapier3d-compat",
        "peerjs",
        "qrcode",
        "three",
        "three/addons/geometries/RoundedBoxGeometry.js",
        "three/addons/loaders/GLTFLoader.js",
      ],
    },
  },
  app: {
    head: {
      htmlAttrs: { class: "dark" },
      title: "Nem Bold — Bring the match to the table",
      meta: [
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, viewport-fit=cover",
        },
        { name: "theme-color", content: "#121812" },
        { name: "mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        {
          name: "apple-mobile-web-app-status-bar-style",
          content: "black-translucent",
        },
      ],
      link: [
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32x32.png" },
        { rel: "icon", sizes: "any", href: "/favicon.ico" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png" },
      ],
    },
  },
  nitro: { prerender: { routes: ["/", "/controller", "/about"] } },
  icon: { provider: "none", clientBundle: { scan: true } },
});
