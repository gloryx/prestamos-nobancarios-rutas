import { BadRequestException, type PipeTransform } from '@nestjs/common';

export class OptionalPositiveIntPipe implements PipeTransform<string | undefined, number | undefined> {
  transform(value: string | undefined): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d+$/.test(value) || Number(value) < 1) throw new BadRequestException('The territorial code must be a positive integer.');
    return Number(value);
  }
}
