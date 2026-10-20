import { translateGameText } from "#shared/runtimeMessages";

/** Each screen translates canonical host messages in its own chosen language. */
export function useGameText() {
  const { locale } = useI18n();
  return (text: string | null | undefined) => text ? translateGameText(text, locale.value) : "";
}
