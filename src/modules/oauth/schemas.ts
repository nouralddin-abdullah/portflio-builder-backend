import { z } from 'zod';
import { ZodDto } from '../../common/pipes/zod-validation.pipe';
import { OAUTH_PROVIDERS } from '../../database/entities/oauth-account.entity';

export const providerParamSchema = z.object({
  provider: z.enum(OAUTH_PROVIDERS),
});
export type ProviderParamInput = z.infer<typeof providerParamSchema>;

@ZodDto(providerParamSchema)
export class ProviderParamDto implements ProviderParamInput {
  provider!: (typeof OAUTH_PROVIDERS)[number];
}

export const callbackQuerySchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(2048),
});
export type CallbackQueryInput = z.infer<typeof callbackQuerySchema>;

@ZodDto(callbackQuerySchema)
export class CallbackQueryDto implements CallbackQueryInput {
  code!: string;
  state!: string;
}

export const exchangeSchema = z.object({
  code: z.string().min(1).max(64),
});
export type ExchangeInput = z.infer<typeof exchangeSchema>;

@ZodDto(exchangeSchema)
export class ExchangeDto implements ExchangeInput {
  code!: string;
}
