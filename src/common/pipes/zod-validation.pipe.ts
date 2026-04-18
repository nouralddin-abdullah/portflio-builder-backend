import { ArgumentMetadata, Injectable, PipeTransform, UnprocessableEntityException } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Validates an incoming payload against a zod schema attached to its DTO class via
 * `Reflect.defineMetadata('zod:schema', schema, TargetClass)`. When no schema is
 * attached (primitive params, no DTO), the pipe is a no-op.
 *
 * Controllers use `@Body()`/`@Query()` with a zod-inferred DTO type and the
 * pipe pulls the runtime schema from the class metadata.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (!metadata.metatype) return value;
    const schema: ZodSchema | undefined = Reflect.getMetadata('zod:schema', metadata.metatype) as
      | ZodSchema
      | undefined;
    if (!schema) return value;
    try {
      return schema.parse(value);
    } catch (err) {
      if (err instanceof ZodError) {
        const details: Record<string, string> = {};
        for (const issue of err.issues) {
          const path = issue.path.join('.') || '(root)';
          if (!details[path]) details[path] = issue.message;
        }
        throw new UnprocessableEntityException({
          code: 'validation_error',
          message: 'Request failed validation.',
          details,
        });
      }
      throw err;
    }
  }
}

/**
 * Class decorator that binds a zod schema to a DTO class so the global
 * `ZodValidationPipe` can discover and apply it.
 *
 * ```ts
 * const loginSchema = z.object({ email: z.string().email(), password: z.string() });
 * type LoginDto = z.infer<typeof loginSchema>;
 * @ZodDto(loginSchema)
 * export class LoginDto {}
 * ```
 */
export function ZodDto(schema: ZodSchema): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata('zod:schema', schema, target);
  };
}
