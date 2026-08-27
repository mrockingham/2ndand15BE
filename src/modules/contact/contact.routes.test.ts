/* Vitest repository mock methods are intentionally referenced as assertion subjects. */
/* eslint-disable @typescript-eslint/unbound-method */
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../common/middleware/error-handler.js';
import { notFoundHandler } from '../../common/middleware/not-found.js';
import type { RateLimitConfig } from '../../config/env.js';
import { createAdminContactRouter, createPublicContactRouter } from './contact.routes.js';
import type { ContactServiceContract } from './contact.service.js';

const editorUserId = '00000000-0000-4000-8000-000000000001';
const adminUserId = '00000000-0000-4000-8000-000000000002';
const contactMessageId = '00000000-0000-4000-8000-000000000100';

const contactMessage = {
  id: contactMessageId,
  name: 'Jane Doe',
  email: 'jane@example.com',
  subject: 'A question',
  message: 'This is a perfectly reasonable contact message.',
  status: 'NEW',
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
};

function service(): ContactServiceContract {
  return {
    submit: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ messages: [contactMessage], nextCursor: null }),
    get: vi.fn().mockResolvedValue(contactMessage),
    updateStatus: vi.fn().mockResolvedValue({ ...contactMessage, status: 'RESOLVED' }),
  };
}

function defaultRateLimit(): RateLimitConfig {
  return { windowMs: 3_600_000, max: 5 };
}

function app(
  contactService: ContactServiceContract,
  rateLimit: RateLimitConfig = defaultRateLimit(),
) {
  const authenticate: RequestHandler = (req, _res, next) => {
    if (req.headers.authorization === 'Bearer editor')
      req.auth = { userId: editorUserId, sessionId: '00000000-0000-4000-8000-000000000003' };
    if (req.headers.authorization === 'Bearer admin')
      req.auth = { userId: adminUserId, sessionId: '00000000-0000-4000-8000-000000000004' };
    next();
  };
  const identities = {
    findAdministrativeIdentity: (id: string) => {
      if (id === editorUserId) {
        return Promise.resolve({
          userId: editorUserId,
          email: 'editor@example.com',
          role: 'EDITOR' as const,
        });
      }
      if (id === adminUserId) {
        return Promise.resolve({
          userId: adminUserId,
          email: 'admin@example.com',
          role: 'ADMIN' as const,
        });
      }
      return Promise.resolve(null);
    },
  };
  const adminRouter = createAdminContactRouter({
    authenticate,
    identities,
    service: contactService,
  });
  const instance = express();
  instance.use(express.json());
  instance.use('/api/v1/admin/contact-messages', adminRouter);
  instance.use(
    '/api/v1/contact',
    createPublicContactRouter({ service: contactService, rateLimit }),
  );
  instance.use(notFoundHandler);
  instance.use(errorHandler);
  return instance;
}

describe('public contact route', () => {
  it('accepts a valid submission with 202 and the generic accepted message', async () => {
    const response = await request(app(service())).post('/api/v1/contact').send({
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'This is a perfectly reasonable contact message.',
    });
    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      data: { message: "Thanks -- we've received your message and will follow up soon." },
    });
  });

  it('rejects an invalid body with 400 VALIDATION_ERROR', async () => {
    const response = await request(app(service())).post('/api/v1/contact').send({
      name: 'Jane Doe',
      email: 'not-an-email',
      message: 'This is a perfectly reasonable contact message.',
    });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it('enforces the rate limiter, returning 429 after the limit is exceeded', async () => {
    const instance = app(service(), { windowMs: 60_000, max: 1 });
    const body = {
      name: 'Jane Doe',
      email: 'jane@example.com',
      message: 'This is a perfectly reasonable contact message.',
    };
    const first = await request(instance).post('/api/v1/contact').send(body);
    expect(first.status).toBe(202);
    const second = await request(instance).post('/api/v1/contact').send(body);
    expect(second.status).toBe(429);
  });

  it('does not expose a route for reading a contact message id publicly', async () => {
    const response = await request(app(service())).get(`/api/v1/contact/${contactMessageId}`);
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ error: { code: 'ROUTE_NOT_FOUND' } });
  });
});

describe('admin contact routes', () => {
  it('rejects unauthenticated requests', async () => {
    const response = await request(app(service())).get('/api/v1/admin/contact-messages');
    expect(response.status).toBe(401);
  });

  it('allows an EDITOR to list contact messages (EDITOR has VIEW_CONTACT_MESSAGES)', async () => {
    const response = await request(app(service()))
      .get('/api/v1/admin/contact-messages')
      .set('Authorization', 'Bearer editor');
    expect(response.status).toBe(200);
  });

  it('forbids an EDITOR from updating status (EDITOR lacks MANAGE_CONTACT_MESSAGES)', async () => {
    const response = await request(app(service()))
      .patch(`/api/v1/admin/contact-messages/${contactMessageId}`)
      .set('Authorization', 'Bearer editor')
      .send({ status: 'READ' });
    expect(response.status).toBe(403);
  });

  it('allows an ADMIN to update status, calling service.updateStatus with the right args', async () => {
    const svc = service();
    const response = await request(app(svc))
      .patch(`/api/v1/admin/contact-messages/${contactMessageId}`)
      .set('Authorization', 'Bearer admin')
      .send({ status: 'READ' });
    expect(response.status).toBe(200);
    expect(vi.mocked(svc.updateStatus)).toHaveBeenCalledWith(
      contactMessageId,
      { status: 'READ' },
      expect.objectContaining({ userId: adminUserId, role: 'ADMIN' }),
      null,
    );
  });
});
