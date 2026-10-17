import type { Config } from 'tailwindcss';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import animate from 'tailwindcss-animate';

const root = path.dirname(fileURLToPath(import.meta.url));

export default {
  darkMode: ['class'],
  content: [path.join(root, 'client/index.html'), path.join(root, 'client/src/**/*.{ts,tsx}')],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1440px' } },
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        sidebar: { DEFAULT: 'hsl(var(--sidebar))', foreground: 'hsl(var(--sidebar-foreground))', muted: 'hsl(var(--sidebar-muted))' },
        // Quality status tokens (always paired with an icon + text label in the UI)
        ok: { DEFAULT: 'hsl(var(--ok))', soft: 'hsl(var(--ok-soft))', foreground: 'hsl(var(--ok-foreground))' },
        warn: { DEFAULT: 'hsl(var(--warn))', soft: 'hsl(var(--warn-soft))', foreground: 'hsl(var(--warn-foreground))' },
        bad: { DEFAULT: 'hsl(var(--bad))', soft: 'hsl(var(--bad-soft))', foreground: 'hsl(var(--bad-foreground))' },
        chain: { DEFAULT: 'hsl(var(--chain))', soft: 'hsl(var(--chain-soft))' },
      },
      borderRadius: { lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 hsl(var(--ring) / 0.6)' }, '100%': { boxShadow: '0 0 0 12px hsl(var(--ring) / 0)' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'pulse-ring': 'pulse-ring 1.2s ease-out infinite',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
