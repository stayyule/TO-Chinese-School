import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MeController } from './me.controller';
import { RolesController } from './roles.controller';
import { PermissionsService } from './permissions.service';

/**
 * Roles/permissions lookups and GET /me. The global PermissionGuard is registered by AuthModule (after
 * SessionGuard, in one ordered list); DiscoveryModule backs assertRouteCoverage.
 */
@Module({
  imports: [DiscoveryModule],
  controllers: [MeController, RolesController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class AccessModule {}
