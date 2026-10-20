<script setup lang="ts">
import { NuxtLink } from "#components";
defineProps<{ interactive?: boolean }>();
const { t } = useI18n();
</script>

<template>
  <component
    :is="interactive ? 'button' : NuxtLink"
    :to="interactive ? undefined : '/'"
    :type="interactive ? 'button' : undefined"
    :prefetch="false"
    class="brand"
    :aria-label="t('ui.common.brandHome')"
  >
    <img
      class="brand-image"
      src="/branding/nembestil-bold.svg"
      width="382"
      height="208"
      alt="NemBestil Bold"
    />
  </component>
</template>
