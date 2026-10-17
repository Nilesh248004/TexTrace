import type { ContractModule } from './types';

export const AccessContract: ContractModule = {
  name: 'Access',
  description: 'Identity and access-control operations',
  functions: {
    login: {
      key: 'Access.login',
      description: 'Record a user sign-in',
      rules: ['user-exists'],
      handler(ctx, args: { userId: string }) {
        const user = ctx.get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', args.userId);
        ctx.check('user-exists', !!user, user ? `User ${args.userId} exists` : `User ${args.userId} does not exist`, 'NOT_FOUND');
        return user;
      },
    },
    updateSettings: {
      key: 'Access.updateSettings',
      description: 'Update system settings',
      rules: ['settings-valid'],
      handler(ctx, args: { patch: Record<string, unknown> }) {
        for (const [key, value] of Object.entries(args.patch)) {
          ctx.check('settings-key', ['millName', 'lotNoFormat', 'lotCodeFormat', 'lotMark', 'warnFraction', 'businessDate', 'qualityColumns'].includes(key), `Unknown setting ${key}`);
          const stored = ctx.get('SELECT key FROM settings WHERE key=?', key);
          if (stored) ctx.updateRaw('settings', 'key', key, { value: JSON.stringify(value) });
          else ctx.insertRaw('settings', { key, value: JSON.stringify(value) });
        }
        return { ...ctx.settings, ...args.patch };
      },
    },
  },
};
