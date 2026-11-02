import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { ZodType } from "zod";

/** Parses a request body or query with a schema from `@adt/contracts`; 400 with the issues when it doesn't fit. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({ message: "Validation failed", issues: result.error.issues });
    }
    return result.data;
  }
}
