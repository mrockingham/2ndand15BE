import { describe, expect, it } from 'vitest';

import {
  adminContactMessageListQuerySchema,
  submitContactMessageSchema,
} from './contact.schemas.js';

describe('submitContactMessageSchema', () => {
  it('accepts a valid full submission', () => {
    const result = submitContactMessageSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      subject: 'A question',
      message: 'This is a perfectly reasonable contact message.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts a valid submission with subject omitted', () => {
    const result = submitContactMessageSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'This is a perfectly reasonable contact message.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = submitContactMessageSchema.safeParse({
      name: 'Jane Doe',
      email: 'not-an-email',
      message: 'This is a perfectly reasonable contact message.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty name', () => {
    const result = submitContactMessageSchema.safeParse({
      name: '',
      email: 'jane@example.com',
      message: 'This is a perfectly reasonable contact message.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a name over 100 characters', () => {
    const result = submitContactMessageSchema.safeParse({
      name: 'a'.repeat(101),
      email: 'jane@example.com',
      message: 'This is a perfectly reasonable contact message.',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a message under 10 characters', () => {
    const result = submitContactMessageSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'a'.repeat(9),
    });
    expect(result.success).toBe(false);
  });

  it('rejects a message over 5000 characters', () => {
    const result = submitContactMessageSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'a'.repeat(5001),
    });
    expect(result.success).toBe(false);
  });

  it('accepts a message exactly 10 characters', () => {
    const result = submitContactMessageSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'a'.repeat(10),
    });
    expect(result.success).toBe(true);
  });

  it('rejects an extra unknown field', () => {
    const result = submitContactMessageSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'This is a perfectly reasonable contact message.',
      unexpected: 'nope',
    });
    expect(result.success).toBe(false);
  });

  it('still parses a populated website honeypot field (rejection happens in the service, not the schema)', () => {
    const result = submitContactMessageSchema.safeParse({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'This is a perfectly reasonable contact message.',
      website: 'https://spam.example.com',
    });
    expect(result.success).toBe(true);
  });
});

describe('adminContactMessageListQuerySchema', () => {
  it('defaults limit to 25 when omitted', () => {
    const result = adminContactMessageListQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(25);
    }
  });

  it('rejects a limit of 101', () => {
    const result = adminContactMessageListQuerySchema.safeParse({ limit: '101' });
    expect(result.success).toBe(false);
  });

  it('rejects a limit of 0', () => {
    const result = adminContactMessageListQuerySchema.safeParse({ limit: '0' });
    expect(result.success).toBe(false);
  });

  it('accepts a limit of 100', () => {
    const result = adminContactMessageListQuerySchema.safeParse({ limit: '100' });
    expect(result.success).toBe(true);
  });
});
