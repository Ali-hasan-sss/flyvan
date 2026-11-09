import { BadRequestException } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export const driverPhotoInterceptor = FileInterceptor("driverPhoto", {
  storage: memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    if (!imageTypes.has(file.mimetype)) {
      callback(new BadRequestException("صورة السائق يجب أن تكون JPG أو PNG أو WEBP."), false);
      return;
    }
    callback(null, true);
  },
});
