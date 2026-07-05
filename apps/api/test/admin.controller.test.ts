import 'reflect-metadata';
import { describe, expect, test } from 'vitest';
import { SUPER_ADMIN_KEY } from '../src/auth/guards';
import { AdminController } from '../src/workspace/admin.controller';

describe('AdminController — deployment-wide routes require super-admin', () => {
  test('listProviders is super-admin gated', () => {
    expect(Reflect.getMetadata(SUPER_ADMIN_KEY, AdminController.prototype.listProviders)).toBe(true);
  });

  test('listPlugins is super-admin gated', () => {
    expect(Reflect.getMetadata(SUPER_ADMIN_KEY, AdminController.prototype.listPlugins)).toBe(true);
  });

  test('togglePlugin remains super-admin gated (regression guard)', () => {
    expect(Reflect.getMetadata(SUPER_ADMIN_KEY, AdminController.prototype.togglePlugin)).toBe(true);
  });

  test('monitor remains super-admin gated (regression guard)', () => {
    expect(Reflect.getMetadata(SUPER_ADMIN_KEY, AdminController.prototype.monitor)).toBe(true);
  });
});
