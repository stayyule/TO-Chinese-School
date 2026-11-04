import { Module } from '@nestjs/common';
import { DiscoveryModule } from '@nestjs/core';
import { MeController } from './me.controller';
import { RolesController } from './roles.controller';
import { PermissionsService } from './permissions.service';
import { RoleDerivationService } from './role-derivation.service';
import { SchoolYearModule } from '../school-year/school-year.module';

/**
 * Roles/permissions lookups, instructor role derivation and GET /me. The global PermissionGuard is registered by AuthModule (after
 * SessionGuard, in one ordered list); DiscoveryModule backs assertRouteCoverage.
 */
@Module({
  imports: [DiscoveryModule, SchoolYearModule],
  controllers: [MeController, RolesController],
  providers: [PermissionsService, RoleDerivationService],
  exports: [PermissionsService, RoleDerivationService],
})
export class AccessModule {}
