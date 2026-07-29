import { z } from 'zod';

export const emailSchema = z.string().trim().max(254).pipe(z.email());
export const passwordSchema = z.string().min(12).max(128);
export const displayNameSchema = z.string().trim().min(1).max(80).nullable().optional();

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: displayNameSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(32).max(512),
    password: passwordSchema,
  })
  .strict();
