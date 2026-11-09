import { HttpException } from "@nestjs/common";

export type FleetCode =
  | "NAME"
  | "PHONE"
  | "EMAIL"
  | "PASSWORD"
  | "IDENTIFIER"
  | "DUPLICATE"
  | "NOT_FOUND"
  | "PLATE"
  | "CAPACITY"
  | "TYPE"
  | "KIND"
  | "PREFERENCE"
  | "STATUS"
  | "DATE"
  | "REASON"
  | "RADIUS"
  | "EMPTY"
  | "APPROVAL_BLOCKED"
  | "DOCUMENT_EXPIRED"
  | "REVIEW_STATE"
  | "COORDINATES"
  | "IMAGE_REQUIRED"
  | "IMAGE_TYPE"
  | "DOCUMENT_TYPE"
  | "FILE_SIZE"
  | "ARCHIVED"
  | "ALREADY_ARCHIVED"
  | "VEHICLE_ARCHIVED"
  | "VEHICLE_ALREADY_ARCHIVED";

const messages: Record<FleetCode, { status: number; message: string }> = {
  NAME: { status: 400, message: "الاسم يجب أن يكون بين حرفين و80 حرفًا." },
  PHONE: { status: 400, message: "رقم الهاتف مطلوب ويجب أن يكون صالحًا وفريدًا." },
  EMAIL: { status: 400, message: "البريد غير صالح." },
  PASSWORD: { status: 400, message: "كلمة المرور يجب أن تكون 8 أحرف على الأقل." },
  IDENTIFIER: { status: 400, message: "أدخل هاتف السائق." },
  DUPLICATE: { status: 409, message: "رقم الهاتف أو البريد أو اللوحة مستخدم من قبل." },
  NOT_FOUND: { status: 404, message: "السجل غير موجود." },
  PLATE: { status: 400, message: "رقم اللوحة يجب أن يكون بين حرفين و16 حرفًا." },
  CAPACITY: { status: 400, message: "سعة المقاعد يجب أن تكون بين 1 و20." },
  TYPE: { status: 400, message: "نوع المركبة يجب أن يكون بين حرفين و40 حرفًا." },
  KIND: { status: 400, message: "نوع المنطقة غير معروف." },
  PREFERENCE: { status: 400, message: "تفضيل المنطقة غير معروف." },
  STATUS: { status: 400, message: "الحالة غير معروفة." },
  DATE: { status: 400, message: "التاريخ يجب أن يكون بصيغة YYYY-MM-DD." },
  REASON: { status: 400, message: "السبب يجب أن يكون بين 3 و300 حرف." },
  RADIUS: { status: 400, message: "نصف القطر يجب أن يكون بين 500 و50000 متر." },
  EMPTY: { status: 400, message: "لا يوجد تغيير ليُحفظ." },
  APPROVAL_BLOCKED: { status: 409, message: "لا يمكن الاعتماد قبل وجود وثيقة معتمدة غير منتهية." },
  DOCUMENT_EXPIRED: { status: 409, message: "لا يمكن اعتماد وثيقة منتهية الصلاحية." },
  REVIEW_STATE: { status: 409, message: "لا يمكن مراجعة هذا الربط إلا وهو قيد المراجعة." },
  COORDINATES: { status: 400, message: "أدخل خط العرض وخط الطول معًا، أو اتركهما فارغين." },
  IMAGE_REQUIRED: { status: 400, message: "صورة المركبة مطلوبة." },
  IMAGE_TYPE: { status: 400, message: "صورة المركبة يجب أن تكون JPG أو PNG أو WEBP." },
  DOCUMENT_TYPE: { status: 400, message: "وثيقة المركبة يجب أن تكون PDF أو JPG أو PNG أو WEBP." },
  FILE_SIZE: { status: 400, message: "حجم الملف يجب ألا يتجاوز 5 ميغابايت." },
  ARCHIVED: { status: 409, message: "هذا السائق في قائمة المحذوفين." },
  ALREADY_ARCHIVED: { status: 409, message: "السائق منقول إلى المحذوفين بالفعل." },
  VEHICLE_ARCHIVED: { status: 409, message: "هذه المركبة في قائمة المحذوفين." },
  VEHICLE_ALREADY_ARCHIVED: { status: 409, message: "المركبة منقولة إلى المحذوفين بالفعل." },
};

export class FleetError extends Error {
  constructor(readonly code: FleetCode) {
    super(code);
  }
}

export function throwFleetHttp(error: unknown): never {
  if (error instanceof FleetError) {
    const mapped = messages[error.code];
    throw new HttpException(mapped.message, mapped.status);
  }
  throw error;
}
