import { Module } from '@nestjs/common';
import { FamiliesService } from './families.service';
import { PeopleService } from './people.service';

/** Domain services for people, personal addresses and families (endpoints are added by later tasks). */
@Module({
  providers: [PeopleService, FamiliesService],
  exports: [PeopleService, FamiliesService],
})
export class PeopleModule {}
