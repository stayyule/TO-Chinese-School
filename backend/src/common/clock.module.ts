import { Global, Module } from '@nestjs/common';
import { Clock, clockProvider } from './clock';

@Global()
@Module({ providers: [clockProvider], exports: [Clock] })
export class ClockModule {}
