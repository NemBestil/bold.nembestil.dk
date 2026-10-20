<script setup lang="ts">
import { isMobileControllerDevice } from "../utils/touchStart";
import { sessionIdFromQuery } from "../utils/sessionLink";
const requestedSession = ref("");
const invalid = ref(false);
const ready = ref(false);
const phone = ref(false);
const { t, locale } = useI18n();
useSeoMeta({ title: () => t("ui.seo.homeTitle"), description: () => t("ui.seo.homeDescription") });
useSchemaOrg(computed(() => [{
  "@type": "VideoGame",
  name: "Nem Bold",
  description: t("ui.seo.homeDescription"),
  url: "https://bold.nembestil.dk/",
  image: "https://bold.nembestil.dk/og/nem-bold.png",
  inLanguage: ({ da: "da-DK", en: "en-GB", tr: "tr-TR" } as Record<string, string>)[locale.value] || "en-GB",
  isAccessibleForFree: true,
  genre: [t("ui.seo.sport"), t("ui.seo.foosball")],
  gamePlatform: "Web browser",
  playMode: ["https://schema.org/SinglePlayer", "https://schema.org/MultiPlayer"],
}]));
onNuxtReady(() => {
  // Prerendered hydration restores query parameters after mounting; wait before choosing a host or viewer.
  const session = new URLSearchParams(window.location.search).get("session");
  requestedSession.value = sessionIdFromQuery(session);
  invalid.value = session !== null && !requestedSession.value;
  phone.value = isMobileControllerDevice(navigator.userAgent, navigator.maxTouchPoints || 0);
  ready.value = true;
});
</script>
<template>
  <main v-if="invalid" class="phone-host-loading"><LanguageSwitcher class="loading-language-switcher" /><BrandLogo /><h1>{{ t('ui.start.invalidLink') }}</h1><p>{{ t('ui.start.scanAgain') }}</p><NuxtLink to="/">{{ t('ui.start.createTable') }}</NuxtLink></main>
  <ClientOnly v-else>
  <template v-if="ready">
    <ControllerSession v-if="phone && requestedSession" :session-id="requestedSession" />
    <TouchStart v-else-if="phone" />
    <DesktopTable v-else :session-id="requestedSession || undefined" />
  </template>
  <template #fallback>
  <main class="about-page">
    <header class="site-header"><BrandLogo /><div class="header-actions"><LanguageSwitcher /><NuxtLink to="/about">{{ t('ui.common.about') }} ↗</NuxtLink></div></header>
    <article>
      <span class="eyebrow">{{ t('ui.start.browserEyebrow') }}</span>
      <h1>{{ t('ui.start.homeHeadline1') }}<br />{{ t('ui.start.homeHeadline2') }}</h1>
      <p class="about-lead">{{ t('ui.start.homeLead') }}</p>
      <h2>{{ t('ui.start.title') }}</h2>
      <ul class="quick-start-steps">
        <li>{{ t('ui.start.step1') }}</li>
        <li>{{ t('ui.start.step2') }}</li>
        <li>{{ t('ui.start.step3') }}</li>
      </ul>
      <NuxtLink to="/about" class="about-cta">{{ t('ui.common.readMoreAbout') }} <span>↗</span></NuxtLink>
    </article>
  </main>
  </template>
  </ClientOnly>
</template>
<style scoped>
.phone-host-loading > .loading-language-switcher { position: absolute; top: 20px; right: 20px; }
</style>
