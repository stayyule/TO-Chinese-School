import { INestApplication } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner } from '@nestjs/core';
import { isPermissionCode } from './permission-codes';
import { ACCESS_RULE, AccessRule } from './permission.decorators';

/**
 * Startup check: every route handler of every controller in the app must carry an access rule
 * (@RequirePermission / @Public / @Authenticated, on the handler or its class). Throws listing all offenders.
 */
export function assertRouteCoverage(app: INestApplication): void {
  const discovery = app.get(DiscoveryService);
  const scanner = new MetadataScanner();
  const problems: string[] = [];

  for (const wrapper of discovery.getControllers()) {
    const type = wrapper.metatype as (new (...args: never[]) => unknown) | null;
    if (!type?.prototype) continue;
    const classRule = Reflect.getMetadata(ACCESS_RULE, type) as AccessRule | undefined;
    for (const name of scanner.getAllMethodNames(type.prototype)) {
      const handler: unknown = (type.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function') continue;
      const isRoute = Reflect.getMetadata(PATH_METADATA, handler) !== undefined && Reflect.getMetadata(METHOD_METADATA, handler) !== undefined;
      if (!isRoute) continue;
      const rule = (Reflect.getMetadata(ACCESS_RULE, handler) as AccessRule | undefined) ?? classRule;
      if (!rule) problems.push(`${type.name}.${name}: no @RequirePermission/@Public/@Authenticated`);
      else if (rule.kind === 'permission' && !isPermissionCode(rule.code)) {
        problems.push(`${type.name}.${name}: unknown permission code "${String(rule.code)}"`);
      }
    }
  }

  if (problems.length > 0) {
    throw new Error(`Route coverage check failed (default-deny):\n  ${problems.join('\n  ')}`);
  }
}
