import { Param, PipeTransform } from '@nestjs/common';
import { AppError } from './errors';

const INT4_MAX = 2_147_483_647;

/** Positive int4 path id; anything else is a 422 VALIDATION_ERROR (and never reaches the database). */
export class IdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    if (!/^[0-9]+$/.test(value)) throw new AppError(422, 'VALIDATION_ERROR', 'Validation failed', ['id must be a positive integer']);
    const n = Number(value);
    if (n < 1 || n > INT4_MAX) throw new AppError(422, 'VALIDATION_ERROR', 'Validation failed', ['id must be a positive integer']);
    return n;
  }
}

/** `@IdParam('id') id: number` — a path parameter through IdPipe. */
export const IdParam = (name: string): ParameterDecorator => Param(name, new IdPipe());
