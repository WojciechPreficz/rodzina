import { createTheme, type CSSVariablesResolver } from '@mantine/core';

export const colors = {
  background: '#f6f3eb',
  surface: '#fffefa',
  text: '#2f4035',
  muted: '#606e62',
  border: '#e6e7de',
  controlBorder: '#819081',
  accent: '#426655',
  tint: '#e7eee5',
  warm: '#e0b07b',
};

export const theme = createTheme({
  primaryColor: 'sage',
  primaryShade: 6,
  colors: {
    sage: [
      '#f2f5f0',
      '#e7eee5',
      '#d1dece',
      '#b5cbb3',
      '#91ad93',
      '#6b8d75',
      '#426655',
      '#365646',
      '#2c4639',
      '#21372c',
    ],
  },
  fontFamily: 'system-ui, sans-serif',
  headings: { fontFamily: 'system-ui, sans-serif' },
  defaultRadius: 'md',
  radius: { xs: '4px', sm: '10px', md: '12px', lg: '18px', xl: '20px' },
  spacing: { xs: '8px', sm: '12px', md: '16px', lg: '24px', xl: '32px' },
  components: {
    Button: { defaultProps: { size: 'sm' }, styles: { root: { minHeight: 44 } } },
    ActionIcon: { defaultProps: { size: 44 } },
    CloseButton: { defaultProps: { size: 44 } },
    Paper: { defaultProps: { radius: 'lg' } },
    Card: { defaultProps: { radius: 'lg' } },
    Modal: { defaultProps: { radius: 'xl', padding: 'lg' } },
    Drawer: { defaultProps: { padding: 'md' } },
    Tooltip: { defaultProps: { color: 'sage.8' } },
  },
});

export const cssVariablesResolver: CSSVariablesResolver = () => ({
  variables: {
    '--app-surface': colors.surface,
    '--app-border': colors.border,
    '--app-accent': colors.accent,
    '--app-tint': colors.tint,
    '--app-warm': colors.warm,
  },
  light: {
    '--mantine-color-body': colors.background,
    '--mantine-color-text': colors.text,
    '--mantine-color-dimmed': colors.muted,
    '--mantine-color-default': colors.surface,
    '--mantine-color-default-hover': colors.tint,
    '--mantine-color-default-color': colors.text,
    '--mantine-color-default-border': colors.controlBorder,
    '--mantine-color-placeholder': colors.muted,
    '--mantine-color-anchor': colors.accent,
  },
  dark: {},
});
