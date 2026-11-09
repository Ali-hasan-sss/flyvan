import { BadRequestException } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import { memoryStorage } from "multer";

const imageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const documentTypes = new Set([...imageTypes, "application/pdf"]);

export const vehicleFilesInterceptor = FileFieldsInterceptor(
  [
    { name: "vehicleImage", maxCount: 1 },
    { name: "vehicleDocument", maxCount: 1 },
  ],
  {
    storage: memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_request, file, callback) => {
      const allowed = file.fieldname === "vehicleImage" ? imageTypes : documentTypes;
      if (!allowed.has(file.mimetype)) {
        callback(new BadRequestException("نوع الملف غير مدعوم."), false);
        return;
      }
      callback(null, true);
    },
  },
);
