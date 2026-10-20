<script setup lang="ts">
defineProps<{ joinUrl?: string; qr?: string; copied?: boolean; compact?: boolean; connecting?: boolean; error?: string; retryable?: boolean }>();
const emit = defineEmits<{ copy: []; retry: [] }>();
const { t } = useI18n();
const gameText = useGameText();
</script>

<template>
  <div class="join-card" :class="{ 'join-card-compact': compact }">
    <div class="join-card-top"><span class="eyebrow">{{ t(compact ? 'ui.join.compactEyebrow' : 'ui.join.eyebrow') }}</span><UIcon v-if="!compact" name="i-lucide-move-up-right" /></div>
    <h2 v-if="compact">{{ t('ui.join.compactHeadline1') }}<br /><em>{{ t('ui.join.compactHeadline2') }}</em></h2>
    <h2 v-else>{{ t('ui.join.headline1') }}<br /><em>{{ t('ui.join.headline2') }}</em></h2>
    <p class="join-description">{{ t(compact ? 'ui.join.compactDescription' : 'ui.join.description') }}</p>
    <div class="qr-frame" :aria-busy="!qr && !error">
      <img v-if="qr" :src="qr" :alt="t('ui.join.qrAlt')" />
      <div v-else class="qr-loading" role="status"><UIcon :name="error ? 'i-lucide-wifi-off' : 'i-lucide-loader-circle'" :class="{ 'animate-spin': !error }" /><span>{{ t(error ? 'ui.join.missing' : 'ui.join.opening') }}</span></div>
    </div>
    <span v-if="!compact" class="scan-label">{{ t('ui.join.scan') }}</span>
    <UButton v-if="joinUrl" class="copy-link" variant="link" color="neutral" icon="i-lucide-link" @click="emit('copy')">{{ t(copied ? 'ui.join.copied' : 'ui.join.copy') }}</UButton>
    <p v-if="error" class="join-error" role="alert">{{ gameText(error) }}</p>
    <UButton v-if="retryable && !joinUrl && !connecting" class="join-retry" color="neutral" variant="outline" size="sm" @click="emit('retry')">{{ t(error ? 'ui.join.retry' : 'ui.join.connect') }}</UButton>
  </div>
</template>

<style scoped>
.join-card-compact {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(104px, 30vw, 144px);
  grid-template-rows: auto auto auto auto;
  align-items: center;
  gap: 5px 14px;
  padding: 15px;
}
.join-card-compact .join-card-top { grid-column: 1; grid-row: 1; }
.join-card-compact .eyebrow { color: #657056; font-size: 7px; letter-spacing: 1px; }
.join-card-compact h2 { grid-column: 1; grid-row: 2; margin: 0; font-size: clamp(23px, 6vw, 28px); letter-spacing: -1px; }
.join-card-compact .join-description { grid-column: 1; grid-row: 3; margin: 1px 0; font-size: 10px; line-height: 1.45; }
.join-card-compact .qr-frame { grid-column: 2; grid-row: 1 / 5; width: 100%; max-width: none; padding: 0; margin: 0; justify-self: end; }
.join-card-compact .qr-loading { min-height: 104px; padding: 8px; gap: 10px; text-align: center; font-size: 10px; line-height: 1.4; }
.join-card-compact .copy-link { grid-column: 1; grid-row: 4; justify-content: flex-start; width: auto; min-height: 24px; margin: 0; padding: 0; border: 0; color: #657056; font-size: 9px; line-height: 1.4; white-space: normal; text-align: left; }
.join-card-compact .copy-link:hover { color: #172018; }
.join-card-compact .join-error { grid-column: 1 / -1; grid-row: 5; margin: 6px 0 0; font-size: 10px; line-height: 1.5; color: #7a372d; overflow-wrap: anywhere; }
.join-card-compact .join-retry { grid-column: 1 / -1; grid-row: 6; justify-self: start; margin-top: 5px; border: 1px solid #7a826e6b; box-shadow: none; color: #283c1c; }
</style>
