<template>
  <UApp :locale="interfaceLocale"><NuxtPage /></UApp>
</template>
<script setup lang="ts">
import { en, da, tr } from "@nuxt/ui/locale";
const { locale, t } = useI18n();
const interfaceLocale = computed(() => ({ en, da, tr })[locale.value as "en" | "da" | "tr"] ?? en);
const languageHead = useLocaleHead({ lang: true, dir: true, seo: false });
useHead(() => ({ titleTemplate: null, htmlAttrs: languageHead.value.htmlAttrs }));
useSeoMeta({
  title: () => t("core.meta.title"),
  description: () => t("core.meta.description"),
  ogTitle: () => t("core.meta.title"),
  ogDescription: () => t("core.meta.ogDescription"),
  ogType: "website",
  ogLocale: () => ({ da: "da_DK", tr: "tr_TR", en: "en_GB" })[locale.value as "en" | "da" | "tr"] ?? "en_GB",
  ogSiteName: "Nem Bold",
  ogImage: "https://bold.nembestil.dk/og/nem-bold.png",
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageType: "image/png",
  ogImageAlt: () => t("core.meta.imageAlt"),
  twitterCard: "summary_large_image",
  twitterTitle: () => t("core.meta.title"),
  twitterDescription: () => t("core.meta.twitterDescription"),
  twitterImage: "https://bold.nembestil.dk/og/nem-bold.png",
  twitterImageAlt: () => t("core.meta.imageAlt"),
});
</script>
