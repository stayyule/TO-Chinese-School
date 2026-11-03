import type { PermissionCode } from './permission-codes';

export const ACCESS_RULE = 'tocs:access-rule';

/**
 * How a route is protected. Exactly one rule per class or handler; a handler's rule overrides its class's.
 * Routes with no rule at all are denied at runtime and fail assertRouteCoverage at startup.
 */
export type AccessRule = { kind: 'public' } | { kind: 'authenticated' } | { kind: 'permission'; code: PermissionCode };

function accessRule(rule: AccessRule): ClassDecorator & MethodDecorator {
  return (target: object, propertyKey?: string | symbol, descriptor?: PropertyDescriptor): void => {
    const holder: object = descriptor ? (descriptor.value as object) : target;
    if (Reflect.hasOwnMetadata(ACCESS_RULE, holder)) {
      const name = propertyKey ? `${(target as { constructor: { name: string } }).constructor.name}.${String(propertyKey)}` : (target as { name: string }).name;
      throw new Error(`${name}: only one of @Public/@Authenticated/@RequirePermission may be applied`);
    }
    Reflect.defineMetadata(ACCESS_RULE, rule, holder);
  };
}

/** Anyone, signed in or not. */
export const Public = (): ClassDecorator & MethodDecorator => accessRule({ kind: 'public' });

/** Any signed-in user; no permission code required. */
export const Authenticated = (): ClassDecorator & MethodDecorator => accessRule({ kind: 'authenticated' });

/** A signed-in user whose roles grant `code` (Super User always passes). */
export const RequirePermission = (code: PermissionCode): ClassDecorator & MethodDecorator =>
  accessRule({ kind: 'permission', code });
