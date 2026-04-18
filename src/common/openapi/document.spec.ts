import { buildOpenApiDocument } from './document';

describe('OpenAPI document', () => {
  const doc = buildOpenApiDocument({
    apiOrigin: 'https://api.portfoli.app',
    appOrigin: 'https://app.portfoli.app',
  });

  it('declares the expected top-level shape', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('Portfoli API');
    expect(doc.servers[0]?.url).toBe('https://api.portfoli.app');
    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it('covers the advertised auth + account endpoints', () => {
    expect(doc.paths['/api/auth/register']?.post).toBeDefined();
    expect(doc.paths['/api/auth/login']?.post).toBeDefined();
    expect(doc.paths['/api/auth/password/forgot']?.post).toBeDefined();
    expect(doc.paths['/api/auth/password/reset']?.post).toBeDefined();
    expect(doc.paths['/api/auth/email-verification/confirm']?.post).toBeDefined();
  });

  it('marks protected endpoints with bearer security', () => {
    const me = doc.paths['/api/users/me']?.get as { security?: { bearerAuth: string[] }[] };
    expect(me?.security?.[0]?.bearerAuth).toBeDefined();
  });

  it('references every shared schema it uses', () => {
    const json = JSON.stringify(doc);
    const refs = Array.from(json.matchAll(/"\$ref":"#\/components\/schemas\/([A-Za-z0-9_]+)"/g)).map(
      (m) => m[1]!,
    );
    for (const name of refs) {
      expect(doc.components.schemas[name]).toBeDefined();
    }
  });
});
