import { z } from 'zod';

export const contactMessageStatusSchema = z.enum(['NEW', 'READ', 'RESOLVED', 'SPAM']);

/** Public POST /contact body. `website` is an invisible honeypot field the
 * frontend should never populate for a real human submission -- see
 * contact.service.ts. */
export const submitContactMessageSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.email().max(254),
    subject: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : value),
      z.string().trim().max(150).optional(),
    ),
    message: z.string().trim().min(10).max(5000),
    website: z.preprocess(
      (value) => (value === '' || value === undefined ? undefined : value),
      z.string().max(1000).optional(),
    ),
  })
  .strict();

export type SubmitContactMessageInput = z.infer<typeof submitContactMessageSchema>;

export const contactMessageIdParamsSchema = z.object({ contactMessageId: z.uuid() }).strict();

export const adminContactMessageListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.uuid().optional(),
    status: contactMessageStatusSchema.optional(),
  })
  .strict();

export type AdminContactMessageListQuery = z.infer<typeof adminContactMessageListQuerySchema>;

export const updateContactMessageStatusSchema = z
  .object({ status: contactMessageStatusSchema })
  .strict();

export type UpdateContactMessageStatusInput = z.infer<typeof updateContactMessageStatusSchema>;
