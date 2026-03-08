import { z } from "zod";

const envSchema = z.object({
  CHATWOOT_BASE_URL: z.url(),
  CHATWOOT_ACCOUNT_ID: z.coerce.number().int().positive(),
  CHATWOOT_API_TOKEN: z.string().min(1),
  APP_ACCESS_KEY: z.string().min(24),
  KOMMO_STRUCTURE_PATH: z.string().optional(),
});

let cachedEnv: z.infer<typeof envSchema> | null = null;

export function getServerEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}

export function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
