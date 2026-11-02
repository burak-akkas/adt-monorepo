import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { mountAuth } from "./auth/auth.module.js";
import { internalApiKeyMiddleware, readInternalApiKey } from "./internal-api-key.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Before mountAuth, so /auth/*, /health and every Nest route need the key.
  app.use(internalApiKeyMiddleware(readInternalApiKey()));
  mountAuth(app);
  await app.listen(process.env.PORT ?? 4000);
}
// Not awaited at the top level: on Vercel, listen() doesn't finish, and that would block the module from loading.
void bootstrap();
