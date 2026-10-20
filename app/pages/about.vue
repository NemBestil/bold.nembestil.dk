<script setup lang="ts">
const { t } = useI18n();
useSeoMeta({
  title: () => t("ui.seo.aboutTitle"),
  description: () => t("ui.seo.aboutDescription"),
  ogTitle: () => t("ui.seo.aboutSocialTitle"),
  ogDescription: () => t("ui.seo.aboutSocialDescription"),
  twitterTitle: () => t("ui.seo.aboutSocialTitle"),
});
</script>

<template>
  <main class="about-page">
    <header class="site-header">
      <BrandLogo />
      <div class="header-actions"><LanguageSwitcher /><NuxtLink to="/" class="back-link">← {{ t('ui.common.backToTable') }}</NuxtLink></div>
    </header>
    <article>
      <span class="eyebrow">{{ t('ui.about.eyebrow') }}</span>
      <h1>{{ t('ui.about.headline1') }}<br />{{ t('ui.about.headline2') }}</h1>
      <p class="about-lead">{{ t('ui.about.lead') }}</p>
      <h2>{{ t('ui.start.title') }}</h2>
      <ul class="quick-start-steps">
        <li>{{ t('ui.start.step1') }}</li>
        <li>{{ t('ui.start.step2') }}</li>
        <li>{{ t('ui.start.step3') }}</li>
      </ul>
      <h2>{{ t('ui.about.hobbyTitle') }}</h2>
      <p>{{ t('ui.about.hobby') }}</p>
      <h2>{{ t('ui.about.technologyTitle') }}</h2>
      <p>{{ t('ui.about.technology1') }}</p>
      <p>{{ t('ui.about.technology2') }}</p>
      <p>{{ t('ui.about.technology3') }}</p>
      <h2>{{ t('ui.about.thanksTitle') }}</h2>
      <i18n-t keypath="ui.about.credit" tag="p">
        <template #model><a href="https://sketchfab.com/3d-models/foosball-table-1303a318d4584639acef729b9fd296fc" target="_blank" rel="noreferrer">{{ t('ui.about.model') }}</a></template>
        <template #license><a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></template>
      </i18n-t>
      <NuxtLink to="/" class="about-cta">{{ t('ui.common.backToTable') }} <span>↗</span></NuxtLink>
    </article>
    <footer class="site-footer"><span>{{ t('ui.about.footer1') }}</span><span>{{ t('ui.about.footer2') }}</span></footer>
  </main>
</template>
