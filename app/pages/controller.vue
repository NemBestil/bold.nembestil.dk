<script setup lang="ts">
const { t } = useI18n();
useSeoMeta({ title: () => t("ui.seo.joinTitle"), robots: "noindex, nofollow" });
// Preserve session query parameters on static hosting, where a prerendered redirect cannot see them.
onNuxtReady(() => {
  const session = new URLSearchParams(window.location.search).get("session");
  void navigateTo({ path: "/", query: session === null ? {} : { session } }, { replace: true });
});
</script>
<template><main class="phone-host-loading"><LanguageSwitcher class="loading-language-switcher" /><BrandLogo /><p>{{ t('ui.start.connecting') }}</p><NuxtLink to="/">{{ t('ui.common.home') }}</NuxtLink></main></template>
<style scoped>
.phone-host-loading > .loading-language-switcher { position: absolute; top: 20px; right: 20px; }
</style>
