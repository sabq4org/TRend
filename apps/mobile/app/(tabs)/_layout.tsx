import { Tabs } from 'expo-router';
import { deviceLocale, translator } from '@/i18n';
import { useTheme } from '@/theme';

// §10.3: شريط سفلي بخمسة عناصر، وزر الإضافة السريعة في المنتصف.
export default function TabsLayout() {
  const t = translator(deviceLocale());
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('nav.home') }} />
      <Tabs.Screen name="tasks" options={{ title: t('nav.tasks') }} />
      <Tabs.Screen name="add" options={{ title: t('nav.quickAdd') }} />
      <Tabs.Screen name="chats" options={{ title: t('nav.chats') }} />
      <Tabs.Screen name="notes" options={{ title: t('nav.notes') }} />
    </Tabs>
  );
}
