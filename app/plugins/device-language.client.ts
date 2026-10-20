import { preferredLanguage, savedLanguage } from "../utils/language";
import { createLanguageDetection } from "../utils/languageDetection";

export default defineNuxtPlugin({
  name: "device-language",
  enforce: "pre",
  setup(nuxt) {
    // Static HTML is English. Capture the user's cookie before hydration sets
    // the prerendered locale, then apply detection after hydration without routing.
    const preferred = preferredLanguage(navigator.languages?.length ? navigator.languages : [navigator.language], savedLanguage(document.cookie));
    const detection = createLanguageDetection(() => nuxt.$i18n.setLocale(preferred));
    nuxt.hook("app:mounted", detection.run);
    return { provide: { deviceLanguageReady: detection.ready } };
  },
});
