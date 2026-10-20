<script setup lang="ts">
import { LANGUAGES, isAppLanguage } from "../utils/language";
const { locale, setLocale, t } = useI18n();
const nuxt = useNuxtApp();
const menu = ref<HTMLDetailsElement>();
const changing = ref(false);
const current = computed(() => LANGUAGES.find(language => language.code === locale.value) ?? LANGUAGES[0]);
async function change(code: string) {
  if (!isAppLanguage(code) || changing.value) return;
  changing.value = true;
  try {
    await nuxt.$deviceLanguageReady;
    await setLocale(code);
  } finally {
    changing.value = false;
    if (menu.value) menu.value.open = false;
  }
}
</script>
<template>
  <details ref="menu" class="language-switcher" @keydown.esc="menu && (menu.open = false)">
    <summary :aria-label="t('core.language.current', { name: current.name })" :title="t('core.language.choose')">
      <img :src="current.flag" alt="" width="24" height="16" />
    </summary>
    <ul :aria-label="t('core.language.choose')">
      <li v-for="language in LANGUAGES" :key="language.code">
        <button type="button" :lang="language.code" :aria-pressed="locale === language.code" :disabled="changing" @click="change(language.code)">
          <img :src="language.flag" alt="" width="24" height="16" /><span>{{ language.name }}</span>
        </button>
      </li>
    </ul>
  </details>
</template>
<style scoped>
.language-switcher { position: relative; flex: 0 0 auto; z-index: 250; }
.language-switcher summary { display: flex; align-items: center; justify-content: center; width: 38px; height: 36px; border-radius: 6px; cursor: pointer; list-style: none; }
.language-switcher summary::-webkit-details-marker { display: none; }
.language-switcher summary:hover { background: #aebda21a; }
.language-switcher img { width: 24px; height: 16px; border-radius: 2px; object-fit: cover; box-shadow: 0 0 0 1px #ffffff30; }
.language-switcher ul { position: absolute; right: 0; top: calc(100% + 7px); min-width: 155px; margin: 0; padding: 6px; border: 1px solid #aebda240; border-radius: 9px; background: #182018; box-shadow: 0 10px 30px #0006; list-style: none; }
.language-switcher button { display: flex; align-items: center; gap: 11px; width: 100%; padding: 9px 10px; border-radius: 5px; text-align: left; font-size: 13px; color: #edf2e6; cursor: pointer; }
.language-switcher button:hover, .language-switcher button[aria-pressed="true"] { background: #aebda21f; }
.language-switcher summary:focus-visible, .language-switcher button:focus-visible { outline: 2px solid #d2f35c; outline-offset: 2px; }
</style>
