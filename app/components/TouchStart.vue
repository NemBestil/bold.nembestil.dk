<script setup lang="ts">
const { t } = useI18n();
const hosting = ref(false);
const joinDialog = ref<HTMLDialogElement>();
</script>

<template>
  <PhoneHost v-if="hosting" @exit="hosting = false" />
  <main v-else class="touch-start">
    <header><BrandLogo /><div class="touch-header-actions"><LanguageSwitcher /><NuxtLink to="/about">{{ t('ui.common.aboutGame') }} ↗</NuxtLink></div></header>
    <section class="touch-start-intro">
      <span class="eyebrow">{{ t('ui.start.touchEyebrow') }}</span>
      <h1>{{ t('ui.start.touchHeadline1') }}<br /><em>{{ t('ui.start.touchHeadline2') }}</em></h1>
      <p>{{ t('ui.start.touchLead') }}</p>
    </section>
    <section class="touch-start-actions" :aria-label="t('ui.start.startLabel')">
      <button class="touch-start-primary" @click="hosting = true"><UIcon name="i-lucide-play" /><span><strong>{{ t('ui.start.create') }}</strong><small>{{ t('ui.start.createHint') }}</small></span><span>→</span></button>
      <button @click="joinDialog?.showModal()"><UIcon name="i-lucide-qr-code" /><span><strong>{{ t('ui.start.join') }}</strong><small>{{ t('ui.start.joinHint') }}</small></span><span>↗</span></button>
    </section>
    <dialog ref="joinDialog" class="dialog-card touch-join-dialog" aria-labelledby="touch-join-title" @click.self="joinDialog?.close()">
      <button class="dialog-close" :aria-label="t('ui.common.close')" @click="joinDialog?.close()">×</button>
      <span class="eyebrow">{{ t('ui.start.joinEyebrow') }}</span>
      <h2 id="touch-join-title">{{ t('ui.start.joinTitle') }}</h2>
      <p>{{ t('ui.start.joinDescription') }}</p>
      <UButton block size="lg" @click="joinDialog?.close()">{{ t('ui.common.close') }}</UButton>
    </dialog>
    <footer>{{ t('ui.start.footer') }}</footer>
  </main>
</template>

<style scoped>
.touch-start { min-height: 100dvh; max-width: 700px; margin: auto; padding: max(22px, env(safe-area-inset-top)) max(22px, env(safe-area-inset-right)) max(20px, env(safe-area-inset-bottom)) max(22px, env(safe-area-inset-left)); background: radial-gradient(ellipse at 70% 30%, #2c3c22, #121c13 70%); }
.touch-start header { display: flex; align-items: center; justify-content: space-between; gap: 18px; }
.touch-header-actions { display: flex; align-items: center; justify-content: flex-end; gap: 14px; }
.touch-header-actions > a { color: #a5b595; font-size: 11px; }
.touch-start-intro { padding: clamp(35px, 7vh, 70px) 0 28px; }
.touch-start-intro .eyebrow { font-size: 8px; color: #acc297; }
.touch-start h1 { margin: 20px 0; font-weight: 750; font-size: clamp(42px, 10vw, 70px); line-height: 1.02; letter-spacing: -2px; }
.touch-start h1 em { font-family: Georgia, serif; font-weight: 400; color: #d2f35c; }
.touch-start-intro p { max-width: 440px; color: #aebda2; font-size: 13px; line-height: 1.7; }
.touch-start-actions { display: grid; gap: 12px; }
.touch-start-actions button { display: flex; align-items: center; gap: 15px; padding: 20px 17px; border: 1px solid #d9ecc429; border-radius: 9px; text-align: left; background: #22311f; }
.touch-start-actions button > .iconify { width: 25px; height: 25px; color: #c9e799; flex-shrink: 0; }
.touch-start-actions button > span:nth-child(2) { flex: 1; display: grid; gap: 6px; }
.touch-start-actions strong { font-size: 17px; font-weight: 700; }
.touch-start-actions small { font-size: 10px; line-height: 1.45; color: #a8bd95; }
.touch-start-actions .touch-start-primary { background: #d2f35c; color: #1a2a10; border-color: #d2f35c; }
.touch-start-primary small, .touch-start-actions .touch-start-primary > .iconify { color: #40542a; }
.touch-join-dialog { width: calc(100% - 40px); margin: auto; color: var(--ui-text); }
.touch-join-dialog::backdrop { background: #080d0cc9; backdrop-filter: blur(10px); }
.touch-join-dialog p { color: #b6c5a6; font-size: 13px; line-height: 1.7; margin-bottom: 24px; }
.touch-start footer { text-align: center; padding-top: 30px; color: #849875; font-size: 8px; letter-spacing: .5px; }
</style>
