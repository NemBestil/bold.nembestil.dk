<script setup lang="ts">
import type { GameEngine } from "../../../game/GameEngine";

const props = defineProps<{ engine: GameEngine; compact?: boolean }>();
const { t } = useI18n();
const gameText = useGameText();
const saving = ref(false);
const error = ref("");
async function download() {
  if (saving.value) return;
  error.value = "";
  const recording = props.engine.exportMatchReplay();
  if (!recording) { error.value = "Der er endnu ikke en færdig kamp at gemme."; return; }
  saving.value = true;
  try {
    const { encodeReplayFile } = await import("../../../shared/replayFile");
    const { blob, filename } = await encodeReplayFile(recording);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : "Replayet kunne ikke gemmes. Prøv igen.";
  } finally { saving.value = false; }
}
</script>

<template>
  <span class="replay-download">
    <UButton icon="i-lucide-download" color="neutral" :variant="compact ? 'ghost' : 'outline'" :loading="saving" @click="download">{{ t('ui.common.download') }}</UButton>
    <span v-if="error" class="replay-download-error" role="alert">{{ gameText(error) }}</span>
  </span>
</template>

<style scoped>
.replay-download { display: inline-flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 6px; }
.replay-download-error { flex-basis: 100%; max-width: 280px; color: #f1c6bd; font-size: 11px; line-height: 1.5; }
</style>
