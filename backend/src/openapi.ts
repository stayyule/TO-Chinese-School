import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/** Pure: builds the OpenAPI document from the app's controllers (schemas come from the Nest CLI swagger plugin). */
export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('TOCS Registration API')
    .setDescription('Thousand Oaks Chinese School registration system')
    .setVersion('1.0.0')
    .addServer('/')
    .build();
  return SwaggerModule.createDocument(app, config);
}

/** Serves the document at /api/v1/openapi.json. Never mounted in production (the API surface is not public there). */
export function mountOpenApi(app: INestApplication, nodeEnv: string | undefined): void {
  if (nodeEnv === 'production') return;
  SwaggerModule.setup('api/v1', app, buildOpenApiDocument(app), { jsonDocumentUrl: 'api/v1/openapi.json', ui: false });
}
