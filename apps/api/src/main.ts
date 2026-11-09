import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { readApiConfig } from "./config";
import { uploadsDirectory } from "./files/stored-files";

async function bootstrap(): Promise<void> {
  const config = readApiConfig(process.env);
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.useStaticAssets(uploadsDirectory, { prefix: "/api/files", index: false, fallthrough: false });
  app.enableCors({ origin: config.webOrigin, credentials: true });
  app.setGlobalPrefix("api");
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Fly Van API")
      .setDescription("واجهة فلاي فان. التشغيل والحجوزات والدفتر المالي للعمولات والتسويات مفعّلة.")
      .setVersion("0.5.0")
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document);

  await app.listen(config.port);
}

void bootstrap();
