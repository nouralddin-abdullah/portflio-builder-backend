/**
 * Hand-crafted OpenAPI 3.1 document for the Portfoli API.
 *
 * Why hand-written: the codebase validates with zod, not class-validator, so
 * `@nestjs/swagger`'s decorator-reflection pipeline doesn't see our schemas.
 * Authoring the spec directly keeps us free of the `nestjs-zod` bridge and
 * makes the doc the contract — what you see in /docs is what the API
 * promises.
 *
 * When you add/change a route, update it here too. Missed updates show as
 * 404s in the Swagger UI "Try it out" button.
 */

type JsonSchema = Record<string, unknown>;

interface OpenAPIDocument {
  openapi: '3.1.0';
  info: {
    title: string;
    version: string;
    description: string;
    contact?: { name?: string; url?: string };
    license?: { name: string };
  };
  servers: { url: string; description?: string }[];
  tags: { name: string; description?: string }[];
  components: {
    securitySchemes: Record<string, JsonSchema>;
    schemas: Record<string, JsonSchema>;
  };
  paths: Record<string, Record<string, JsonSchema>>;
}

export interface OpenAPIBuildOptions {
  apiOrigin: string;
  appOrigin: string;
}

const bearerAuth = { bearerAuth: [] as string[] };

export function buildOpenApiDocument(opts: OpenAPIBuildOptions): OpenAPIDocument {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Portfoli API',
      version: '0.1.0',
      description:
        'Backend for Portfoli — a free, multi-tenant portfolio builder. Authenticate via `/api/auth/login`, copy the `accessToken`, then click "Authorize" above and paste it to exercise protected endpoints.',
      contact: { name: 'Portfoli', url: opts.appOrigin },
      license: { name: 'UNLICENSED' },
    },
    servers: [{ url: opts.apiOrigin, description: 'This deployment' }],
    tags: [
      { name: 'Auth', description: 'Register, login, refresh, logout.' },
      { name: 'Account', description: 'Email verification + password reset flows.' },
      { name: 'OAuth', description: 'Social sign-in (Google, GitHub).' },
      { name: 'Users', description: 'Current user profile + account mutations.' },
      { name: 'Tenants', description: 'Owner-scoped tenant (workspace).' },
      { name: 'Portfolios', description: 'Portfolio CRUD + publish + revisions.' },
      { name: 'Assets', description: 'R2-backed asset uploads.' },
      { name: 'Domains', description: 'Custom domain verification.' },
      { name: 'Inquiries', description: 'Contact-form inbox.' },
      { name: 'Analytics', description: 'Per-tenant analytics.' },
      { name: 'Public', description: 'Public-facing (unauthenticated) endpoints.' },
      { name: 'System', description: 'Health, readiness.' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Access token returned by /api/auth/login.',
        },
      },
      schemas: SCHEMAS,
    },
    paths: buildPaths(),
  };
}

// ─── shared schemas ────────────────────────────────────────────────────────
const SCHEMAS: Record<string, JsonSchema> = {
  ErrorResponse: {
    type: 'object',
    required: ['code', 'message'],
    properties: {
      code: { type: 'string', example: 'invalid_credentials' },
      message: { type: 'string' },
      details: { type: 'object', additionalProperties: true },
    },
  },
  AuthTokens: {
    type: 'object',
    required: ['accessToken', 'refreshToken', 'expiresAt', 'user'],
    properties: {
      accessToken: { type: 'string' },
      refreshToken: { type: 'string' },
      expiresAt: { type: 'string', format: 'date-time' },
      user: { $ref: '#/components/schemas/AuthedUser' },
    },
  },
  AuthedUser: {
    type: 'object',
    required: ['id', 'email', 'name', 'emailVerified'],
    properties: {
      id: { type: 'string' },
      email: { type: 'string', format: 'email' },
      name: { type: 'string' },
      emailVerified: { type: 'boolean' },
    },
  },
  UserProfile: {
    type: 'object',
    required: [
      'id',
      'email',
      'emailVerified',
      'name',
      'avatarUrl',
      'headline',
      'location',
      'createdAt',
      'updatedAt',
    ],
    properties: {
      id: { type: 'string' },
      email: { type: 'string', format: 'email' },
      emailVerified: { type: 'boolean' },
      name: { type: 'string' },
      avatarUrl: { type: ['string', 'null'] },
      headline: { type: ['string', 'null'] },
      location: { type: ['string', 'null'] },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  },
  Tenant: {
    type: 'object',
    required: ['id', 'ownerId', 'subdomain', 'createdAt'],
    properties: {
      id: { type: 'string' },
      ownerId: { type: 'string' },
      subdomain: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
  PortfolioSummary: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      slug: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string', enum: ['draft', 'published', 'unpublished'] },
      publishedAt: { type: ['string', 'null'], format: 'date-time' },
    },
  },
  Inquiry: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string', format: 'email' },
      subject: { type: ['string', 'null'] },
      body: { type: 'string' },
      readAt: { type: ['string', 'null'], format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
    },
  },
};

function jsonReq(refOrSchema: JsonSchema | string): JsonSchema {
  const schema = typeof refOrSchema === 'string' ? { $ref: refOrSchema } : refOrSchema;
  return { content: { 'application/json': { schema } } };
}

function jsonRes(
  description: string,
  refOrSchema?: JsonSchema | string,
): JsonSchema {
  if (!refOrSchema) return { description };
  const schema = typeof refOrSchema === 'string' ? { $ref: refOrSchema } : refOrSchema;
  return { description, content: { 'application/json': { schema } } };
}

const errorResponses: Record<string, JsonSchema> = {
  '400': jsonRes('Bad request', '#/components/schemas/ErrorResponse'),
  '401': jsonRes('Unauthorized', '#/components/schemas/ErrorResponse'),
  '403': jsonRes('Forbidden', '#/components/schemas/ErrorResponse'),
  '404': jsonRes('Not found', '#/components/schemas/ErrorResponse'),
  '409': jsonRes('Conflict', '#/components/schemas/ErrorResponse'),
  '422': jsonRes('Validation error', '#/components/schemas/ErrorResponse'),
  '429': jsonRes('Rate limited', '#/components/schemas/ErrorResponse'),
};

// ─── path definitions ──────────────────────────────────────────────────────
function buildPaths(): Record<string, Record<string, JsonSchema>> {
  return {
    '/healthz': {
      get: {
        tags: ['System'],
        summary: 'Liveness probe',
        responses: {
          '200': jsonRes('Process is alive', {
            type: 'object',
            properties: { status: { const: 'ok' } },
          }),
        },
      },
    },
    '/readyz': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe — DB/Redis checks',
        responses: {
          '200': jsonRes('All dependencies healthy', {
            type: 'object',
            properties: {
              status: { const: 'ok' },
              checks: { type: 'object', additionalProperties: true },
            },
          }),
          '503': errorResponses['503'] ?? jsonRes('Not ready', '#/components/schemas/ErrorResponse'),
        },
      },
    },

    // Auth
    '/api/auth/register': op({
      tags: ['Auth'],
      summary: 'Create a new account',
      body: {
        type: 'object',
        required: ['email', 'password', 'name'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254 },
          password: { type: 'string', minLength: 10, maxLength: 256 },
          name: { type: 'string', minLength: 1, maxLength: 120 },
        },
      },
      responses: {
        '201': jsonRes('Account created', '#/components/schemas/AuthTokens'),
        '409': errorResponses['409']!,
        '422': errorResponses['422']!,
        '429': errorResponses['429']!,
      },
    }),
    '/api/auth/login': op({
      tags: ['Auth'],
      summary: 'Log in with email + password',
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string' },
        },
      },
      responses: {
        '200': jsonRes('Signed in', '#/components/schemas/AuthTokens'),
        '401': errorResponses['401']!,
        '422': errorResponses['422']!,
        '429': errorResponses['429']!,
      },
    }),
    '/api/auth/refresh': op({
      tags: ['Auth'],
      summary: 'Rotate the refresh token',
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } },
      },
      responses: {
        '200': jsonRes('Refreshed', '#/components/schemas/AuthTokens'),
        '401': errorResponses['401']!,
      },
    }),
    '/api/auth/logout': op({
      tags: ['Auth'],
      summary: 'Revoke a refresh token',
      body: {
        type: 'object',
        required: ['refreshToken'],
        properties: { refreshToken: { type: 'string' } },
      },
      responses: { '204': jsonRes('Revoked') },
    }),

    // Account flows
    '/api/auth/email-verification/request': op({
      tags: ['Account'],
      summary: 'Send an email verification link (authenticated)',
      secured: true,
      responses: {
        '202': jsonRes('Queued', {
          type: 'object',
          properties: { status: { type: 'string', enum: ['sent', 'already_verified'] } },
        }),
        '401': errorResponses['401']!,
      },
    }),
    '/api/auth/email-verification/confirm': op({
      tags: ['Account'],
      summary: 'Confirm an email via token',
      body: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
      responses: { '204': jsonRes('Email verified'), '401': errorResponses['401']! },
    }),
    '/api/auth/email-change/confirm': op({
      tags: ['Account'],
      summary: 'Confirm a pending email change',
      body: { type: 'object', required: ['token'], properties: { token: { type: 'string' } } },
      responses: {
        '204': jsonRes('Email updated'),
        '401': errorResponses['401']!,
        '409': errorResponses['409']!,
      },
    }),
    '/api/auth/password/forgot': op({
      tags: ['Account'],
      summary: 'Request a password-reset link (silent on unknown emails)',
      body: {
        type: 'object',
        required: ['email'],
        properties: { email: { type: 'string', format: 'email' } },
      },
      responses: {
        '202': jsonRes('Accepted regardless of email existence', {
          type: 'object',
          properties: { status: { const: 'ok' } },
        }),
        '429': errorResponses['429']!,
      },
    }),
    '/api/auth/password/reset': op({
      tags: ['Account'],
      summary: 'Redeem a password-reset token',
      body: {
        type: 'object',
        required: ['token', 'newPassword'],
        properties: {
          token: { type: 'string' },
          newPassword: { type: 'string', minLength: 10, maxLength: 256 },
        },
      },
      responses: {
        '204': jsonRes('Password updated'),
        '401': errorResponses['401']!,
        '422': errorResponses['422']!,
      },
    }),

    // OAuth
    '/api/oauth/{provider}': op({
      tags: ['OAuth'],
      summary: 'Begin OAuth flow — 302 redirects to provider',
      params: [providerParam, returnToParam],
      responses: {
        '302': jsonRes('Redirect to provider'),
        '400': errorResponses['400']!,
      },
    }),
    '/api/oauth/{provider}/callback': op({
      tags: ['OAuth'],
      summary: 'Provider callback — 302 redirects to the app',
      params: [providerParam, { name: 'code', in: 'query', required: true, schema: { type: 'string' } }, { name: 'state', in: 'query', required: true, schema: { type: 'string' } }],
      responses: { '302': jsonRes('Redirect to app'), '401': errorResponses['401']! },
    }),
    '/api/oauth/exchange': op({
      tags: ['OAuth'],
      summary: 'Exchange a one-time code for a session',
      body: {
        type: 'object',
        required: ['code'],
        properties: { code: { type: 'string' } },
      },
      responses: {
        '200': jsonRes('Session issued', '#/components/schemas/AuthTokens'),
        '401': errorResponses['401']!,
      },
    }),

    // Users
    '/api/users/me': {
      get: secured({
        tags: ['Users'],
        summary: 'Return the authenticated user profile',
        responses: { '200': jsonRes('Profile', '#/components/schemas/UserProfile') },
      }),
      patch: secured({
        tags: ['Users'],
        summary: 'Partial profile update',
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            avatarUrl: { type: ['string', 'null'] },
            headline: { type: ['string', 'null'] },
            location: { type: ['string', 'null'] },
          },
        },
        responses: { '200': jsonRes('Updated', '#/components/schemas/UserProfile') },
      }),
      delete: secured({
        tags: ['Users'],
        summary: 'Permanently delete the account',
        body: { type: 'object', required: ['password'], properties: { password: { type: 'string' } } },
        responses: { '204': jsonRes('Deleted'), '401': errorResponses['401']! },
      }),
    },
    '/api/users/me/email-change': op({
      tags: ['Users'],
      summary: 'Request email-change (sends confirm link to new address)',
      secured: true,
      body: {
        type: 'object',
        required: ['newEmail'],
        properties: { newEmail: { type: 'string', format: 'email' } },
      },
      responses: {
        '204': jsonRes('Queued'),
        '400': errorResponses['400']!,
        '409': errorResponses['409']!,
      },
    }),
    '/api/users/me/password': op({
      tags: ['Users'],
      summary: 'Change password (reqs current password)',
      secured: true,
      body: {
        type: 'object',
        required: ['current', 'next'],
        properties: {
          current: { type: 'string' },
          next: { type: 'string', minLength: 10 },
        },
      },
      responses: { '204': jsonRes('Updated'), '401': errorResponses['401']! },
    }),

    // Tenants
    '/api/tenant': {
      get: secured({
        tags: ['Tenants'],
        summary: 'Get the caller\'s tenant (creates on first access)',
        responses: { '200': jsonRes('Tenant', '#/components/schemas/Tenant') },
      }),
    },
    '/api/tenant/subdomain': op({
      tags: ['Tenants'],
      summary: 'Change subdomain',
      secured: true,
      body: {
        type: 'object',
        required: ['subdomain'],
        properties: { subdomain: { type: 'string', minLength: 3, maxLength: 63 } },
      },
      responses: {
        '200': jsonRes('Updated', '#/components/schemas/Tenant'),
        '409': errorResponses['409']!,
        '422': errorResponses['422']!,
      },
    }),
    '/api/tenant/custom-domain': {
      get: secured({
        tags: ['Domains'],
        summary: 'Get current custom-domain state',
        responses: { '200': jsonRes('Domain verification state', { type: 'object' }) },
      }),
      post: secured({
        tags: ['Domains'],
        summary: 'Request verification for a new custom domain',
        body: {
          type: 'object',
          required: ['domain'],
          properties: { domain: { type: 'string' } },
        },
        responses: { '200': jsonRes('TXT record + token', { type: 'object' }) },
      }),
      delete: secured({ tags: ['Domains'], summary: 'Remove the custom domain', responses: { '204': jsonRes('Removed') } }),
    },
    '/api/tenant/custom-domain/verify': op({
      tags: ['Domains'],
      summary: 'Trigger a DoH re-check',
      secured: true,
      responses: { '200': jsonRes('Verification result', { type: 'object' }) },
    }),

    // Portfolios
    '/api/portfolio': {
      get: secured({
        tags: ['Portfolios'],
        summary: 'Fetch the tenant\'s single portfolio',
        responses: { '200': jsonRes('Portfolio', { type: 'object' }) },
      }),
    },
    '/api/portfolio/settings': op({
      tags: ['Portfolios'],
      summary: 'Patch portfolio settings',
      secured: true,
      method: 'patch',
      body: { type: 'object', additionalProperties: true },
      responses: { '200': jsonRes('Updated', { type: 'object' }) },
    }),
    '/api/portfolio/section/{kind}': {
      put: secured({
        tags: ['Portfolios'],
        summary: 'Upsert a section',
        params: [{ name: 'kind', in: 'path', required: true, schema: { type: 'string' } }],
        body: { type: 'object', additionalProperties: true },
        responses: { '200': jsonRes('Upserted', { type: 'object' }) },
      }),
      delete: secured({
        tags: ['Portfolios'],
        summary: 'Delete a section',
        params: [{ name: 'kind', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': jsonRes('Deleted') },
      }),
    },
    '/api/portfolio/publish': op({
      tags: ['Portfolios'],
      summary: 'Publish the portfolio',
      secured: true,
      responses: { '200': jsonRes('Published', { type: 'object' }) },
    }),
    '/api/portfolio/unpublish': op({
      tags: ['Portfolios'],
      summary: 'Unpublish the portfolio',
      secured: true,
      responses: { '200': jsonRes('Unpublished', { type: 'object' }) },
    }),
    '/api/portfolio/revisions': {
      get: secured({
        tags: ['Portfolios'],
        summary: 'List revisions',
        params: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
        ],
        responses: { '200': jsonRes('Revisions page', { type: 'object' }) },
      }),
    },
    '/api/portfolio/revisions/{id}/restore': op({
      tags: ['Portfolios'],
      summary: 'Restore a revision',
      secured: true,
      params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '200': jsonRes('Restored', { type: 'object' }) },
    }),

    // Assets
    '/api/assets/sign': op({
      tags: ['Assets'],
      summary: 'Get a presigned upload URL',
      secured: true,
      body: {
        type: 'object',
        required: ['filename', 'contentType', 'size'],
        properties: {
          filename: { type: 'string' },
          contentType: { type: 'string' },
          size: { type: 'integer', minimum: 1 },
        },
      },
      responses: { '200': jsonRes('Presigned URL + object key', { type: 'object' }) },
    }),
    '/api/assets/confirm': op({
      tags: ['Assets'],
      summary: 'Confirm a completed upload',
      secured: true,
      body: {
        type: 'object',
        required: ['objectKey'],
        properties: { objectKey: { type: 'string' } },
      },
      responses: { '200': jsonRes('Asset persisted', { type: 'object' }) },
    }),
    '/api/assets': {
      get: secured({
        tags: ['Assets'],
        summary: 'List the tenant\'s assets',
        responses: { '200': jsonRes('Asset list', { type: 'object' }) },
      }),
    },
    '/api/assets/{id}': {
      delete: secured({
        tags: ['Assets'],
        summary: 'Delete an asset',
        params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': jsonRes('Deleted') },
      }),
    },

    // Inquiries
    '/api/inquiries': {
      get: secured({
        tags: ['Inquiries'],
        summary: 'List inbox (cursor + unread filter)',
        params: [
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
          { name: 'unread', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        ],
        responses: {
          '200': jsonRes('Inquiry page', {
            type: 'object',
            properties: {
              items: { type: 'array', items: { $ref: '#/components/schemas/Inquiry' } },
              nextCursor: { type: ['string', 'null'] },
            },
          }),
        },
      }),
    },
    '/api/inquiries/{id}': {
      get: secured({
        tags: ['Inquiries'],
        summary: 'Get an inquiry',
        params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': jsonRes('Inquiry', '#/components/schemas/Inquiry') },
      }),
      delete: secured({
        tags: ['Inquiries'],
        summary: 'Delete an inquiry',
        params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': jsonRes('Deleted') },
      }),
    },
    '/api/inquiries/{id}/read': op({
      tags: ['Inquiries'],
      summary: 'Mark an inquiry read (idempotent)',
      secured: true,
      params: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
      responses: { '204': jsonRes('Marked read') },
    }),

    // Analytics
    '/api/analytics/overview': {
      get: secured({
        tags: ['Analytics'],
        summary: 'Views + uniques per day',
        params: [rangeParam],
        responses: { '200': jsonRes('Overview', { type: 'object' }) },
      }),
    },
    '/api/analytics/top-pages': {
      get: secured({
        tags: ['Analytics'],
        summary: 'Most-viewed paths',
        params: [rangeParam, limitParam],
        responses: { '200': jsonRes('Top pages', { type: 'object' }) },
      }),
    },
    '/api/analytics/referrers': {
      get: secured({
        tags: ['Analytics'],
        summary: 'Top referrers',
        params: [rangeParam, limitParam],
        responses: { '200': jsonRes('Referrers', { type: 'object' }) },
      }),
    },
    '/api/analytics/countries': {
      get: secured({
        tags: ['Analytics'],
        summary: 'Top countries',
        params: [rangeParam, limitParam],
        responses: { '200': jsonRes('Countries', { type: 'object' }) },
      }),
    },

    // Public
    '/api/public/config': {
      get: {
        tags: ['Public'],
        summary: 'Resolve public site config by hostname',
        parameters: [{ name: 'host', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          '200': jsonRes('Public config', { type: 'object' }),
          '404': errorResponses['404']!,
        },
      },
    },
    '/api/public/inquiry': op({
      tags: ['Public'],
      summary: 'Submit a contact-form inquiry',
      body: {
        type: 'object',
        required: ['host', 'name', 'email', 'body'],
        properties: {
          host: { type: 'string' },
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          subject: { type: 'string' },
          body: { type: 'string', maxLength: 4000 },
          hcaptchaToken: { type: 'string' },
        },
      },
      responses: {
        '202': jsonRes('Queued'),
        '400': errorResponses['400']!,
        '429': errorResponses['429']!,
      },
    }),
    '/api/public/pageview': op({
      tags: ['Public'],
      summary: 'Record a pageview (session-hashed, no cookies)',
      body: {
        type: 'object',
        required: ['host', 'path'],
        properties: {
          host: { type: 'string' },
          path: { type: 'string' },
          referrer: { type: 'string' },
          country: { type: 'string' },
        },
      },
      responses: { '204': jsonRes('Recorded') },
    }),
  };
}

// ─── helpers ───────────────────────────────────────────────────────────────
const providerParam: JsonSchema = {
  name: 'provider',
  in: 'path',
  required: true,
  schema: { type: 'string', enum: ['google', 'github'] },
};
const returnToParam: JsonSchema = {
  name: 'returnTo',
  in: 'query',
  required: false,
  schema: { type: 'string', format: 'uri' },
};
const rangeParam: JsonSchema = {
  name: 'range',
  in: 'query',
  schema: { type: 'string', enum: ['7d', '30d', '90d'], default: '30d' },
};
const limitParam: JsonSchema = {
  name: 'limit',
  in: 'query',
  schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
};

interface OpBuild {
  tags: string[];
  summary: string;
  body?: JsonSchema;
  params?: JsonSchema[];
  responses: Record<string, JsonSchema>;
  secured?: boolean;
  method?: 'post' | 'patch' | 'put' | 'delete' | 'get';
}

/** Defines a single-verb path entry — defaults to POST. */
function op(def: OpBuild): Record<string, JsonSchema> {
  const method = def.method ?? 'post';
  const entry: JsonSchema = {
    tags: def.tags,
    summary: def.summary,
    responses: def.responses,
  };
  if (def.params && def.params.length > 0) entry.parameters = def.params;
  if (def.body) entry.requestBody = { required: true, ...jsonReq(def.body) };
  if (def.secured) entry.security = [bearerAuth];
  return { [method]: entry };
}

/** Builds an op block with bearer security pre-applied. */
function secured(def: Omit<OpBuild, 'secured' | 'method'>): JsonSchema {
  const entry: JsonSchema = {
    tags: def.tags,
    summary: def.summary,
    security: [bearerAuth],
    responses: def.responses,
  };
  if (def.params && def.params.length > 0) entry.parameters = def.params;
  if (def.body) entry.requestBody = { required: true, ...jsonReq(def.body) };
  return entry;
}
