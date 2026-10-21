import { colors, minTouchTarget } from '@trend/ui';
import { useColorScheme } from 'react-native';

// §10.1: الرموز نفسها للويب والجوال.
export function useTheme() {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: colors[scheme], minTouchTarget };
}
