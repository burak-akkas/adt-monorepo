import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  await app.listen(process.env.PORT ?? 4000);
}
// Not awaited at the top level: on Vercel, listen() doesn't finish, and that would block the module from loading.
void bootstrap();
