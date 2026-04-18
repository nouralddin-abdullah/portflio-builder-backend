import type { INestApplication } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as swaggerUi from 'swagger-ui-express';
import { AppConfigService } from '../../config/config.service';
import { buildOpenApiDocument } from './document';

/**
 * Serves an interactive Swagger UI at `/docs` and the raw OpenAPI JSON at
 * `/docs-json`. Gated on `OPENAPI_ENABLED` so production deployments can
 * choose to hide it.
 */
export function setupOpenApi(app: INestApplication): void {
  const config = app.get(AppConfigService);
  if (!config.openapiEnabled) return;

  const document = buildOpenApiDocument({
    apiOrigin: config.apiOrigin,
    appOrigin: config.appOrigin,
  });

  const httpAdapter = app.getHttpAdapter();
  const instance = httpAdapter.getInstance() as {
    get: (path: string, handler: (req: Request, res: Response) => void) => void;
    use: (path: string, ...handlers: unknown[]) => void;
  };

  instance.get('/docs-json', (_req: Request, res: Response) => {
    res.setHeader('content-type', 'application/json');
    res.send(JSON.stringify(document));
  });

  instance.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(document, {
      customSiteTitle: 'Portfoli API',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'list',
        tagsSorter: 'alpha',
      },
    }),
  );
}
