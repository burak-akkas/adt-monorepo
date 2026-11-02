import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { mountAuth } from "./auth/auth.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  mountAuth(app);
  await app.listen(process.env.PORT ?? 4000);
}
// Not awaited at the top level: on Vercel, listen() doesn't finish, and that would block the module from loading.
void bootstrap();
