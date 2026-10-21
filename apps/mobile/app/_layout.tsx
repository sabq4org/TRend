import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { applyDirection, deviceLocale } from '@/i18n';

applyDirection(deviceLocale());

export default function RootLayout() {
  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
