import { Module } from '@nestjs/common';
import { FamiliesService } from './families.service';
import { PeopleService } from './people.service';
import { FamilyAccessPolicy, PersonAccessPolicy } from './policies';
import { SelfServiceController } from './self-service.controller';
import { StaffController } from './staff.controller';

/** Domain services for people, personal addresses and families, plus the parent self-service routes (/me/...) and the registration-officer routes (/people, /families). */
@Module({
  controllers: [SelfServiceController, StaffController],
  providers: [PeopleService, FamiliesService, FamilyAccessPolicy, PersonAccessPolicy],
  exports: [PeopleService, FamiliesService, FamilyAccessPolicy, PersonAccessPolicy],
})
export class PeopleModule {}
