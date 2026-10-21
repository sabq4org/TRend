import { StyleSheet, Text, View } from 'react-native';
import { deviceLocale, translator } from './i18n';
import { useTheme } from './theme';

// §10.6: كل شاشة فارغة تشرح ما يظهر فيها.
export function Placeholder({ titleKey, bodyKey }: { titleKey: string; bodyKey?: string }) {
  const t = translator(deviceLocale());
  const { colors } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <Text style={[styles.title, { color: colors.text }]}>{t(titleKey)}</Text>
      <Text style={[styles.body, { color: colors.textMuted }]}>
        {t(bodyKey ?? 'common.comingSoon')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 24, gap: 8 },
  // textAlign: 'left' يُعكس تلقائياً في وضع RTL.
  title: { fontSize: 22, fontWeight: '700', textAlign: 'left' },
  body: { fontSize: 16, textAlign: 'left' },
});
