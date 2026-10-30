import { z } from 'zod';

export const usernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);

const webAuthnResponseBaseSchema = z
  .object({
    id: z.string().min(1),
    rawId: z.string().min(1),
    type: z.literal('public-key'),
    clientExtensionResults: z.record(z.string(), z.unknown()),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).nullable().optional(),
  })
  .passthrough();

export const registrationResponseSchema = webAuthnResponseBaseSchema.extend({
  response: z
    .object({
      clientDataJSON: z.string().min(1),
      attestationObject: z.string().min(1),
      authenticatorData: z.string().optional(),
      transports: z.array(z.string()).optional(),
      publicKeyAlgorithm: z.number().optional(),
      publicKey: z.string().optional(),
    })
    .passthrough(),
});

export const authenticationResponseSchema = webAuthnResponseBaseSchema.extend({
  response: z
    .object({
      clientDataJSON: z.string().min(1),
      authenticatorData: z.string().min(1),
      signature: z.string().min(1),
      userHandle: z.string().nullable().optional(),
    })
    .passthrough(),
});

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}