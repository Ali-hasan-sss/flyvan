import { HttpException } from "@nestjs/common";

export type OperationsCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "NAME"
  | "PHONE"
  | "FARE"
  | "CURRENCY"
  | "DATE"
  | "COORDINATES"
  | "DIRECTION"
  | "TRANSITION"
  | "REASON"
  | "STATE"
  | "ASSIGN"
  | "OFFER"
  | "CODE"
  | "DUPLICATE"
  | "DESTINATION"
  | "LEG"
  | "CAPACITY"
  | "SEAT"
  | "SEATS"
  | "TIME"
  | "ORIGIN"
  | "ROUTE"
  | "CREDIT"
  | "FINANCE";

const messages: Record<OperationsCode, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: "السجل غير موجود." },
  FORBIDDEN: { status: 403, message: "ليست لديك صلاحية لهذا الإجراء." },
  NAME: { status: 400, message: "اسم الراكب يجب أن يكون بين حرفين و80 حرفًا." },
  PHONE: { status: 400, message: "رقم هاتف الراكب غير صالح." },
  FARE: { status: 400, message: "الأجرة يجب أن تكون مبلغًا أكبر من صفر بمنزلتين عشريتين كحد أقصى." },
  CURRENCY: { status: 400, message: "العملة يجب أن تكون رمزًا من ثلاثة أحرف." },
  DATE: { status: 400, message: "موعد الرحلة غير صالح." },
  COORDINATES: { status: 400, message: "أدخل خط العرض وخط الطول معًا، أو اتركهما فارغين." },
  DIRECTION: { status: 400, message: "اتجاه الرحلة غير معروف." },
  TRANSITION: { status: 409, message: "لا يمكن نقل الرحلة إلى هذه الحالة." },
  REASON: { status: 400, message: "السبب يجب أن يكون بين 3 و300 حرف." },
  STATE: { status: 409, message: "الحجز أو الرحلة ليست في حالة تسمح بهذا الإجراء." },
  ASSIGN: { status: 409, message: "لا يمكن إسناد الرحلة: السائق أو المركبة غير جاهزين." },
  OFFER: { status: 409, message: "لا يمكن عرض الرحلة على هذا السائق." },
  CODE: { status: 400, message: "رمز التحقق غير صحيح." },
  DUPLICATE: { status: 409, message: "تعذر حفظ الحجز. أعد المحاولة." },
  DESTINATION: { status: 400, message: "اختر وجهة نشطة من وجهات المنصة." },
  LEG: { status: 400, message: "اختر رحلة ذهاب ورحلة إياب منفصلتين، واتجاه كل رحلة يجب أن يطابق الاختيار." },
  CAPACITY: { status: 409, message: "مقاعد المركبات المرتبطة بالرحلة لا تكفي." },
  SEAT: { status: 409, message: "الراكب مسجّل مسبقًا على هذه الرحلة." },
  SEATS: { status: 400, message: "عدد المقاعد يجب أن يكون بين 1 و6." },
  TIME: { status: 400, message: "وقت الوصول يجب أن يكون بعد وقت الانطلاق." },
  ORIGIN: { status: 400, message: "حدد موقع انطلاق السائق على الخريطة قبل حساب المسار." },
  ROUTE: { status: 503, message: "تعذر حساب مسار الطريق." },
  CREDIT: { status: 409, message: "الإسناد يتجاوز حد مديونية هذا السائق." },
  FINANCE: { status: 409, message: "لا يمكن اعتماد الرحلة قبل اكتمال إعداد العمولة." },
};

export class OperationsError extends Error {
  constructor(
    readonly code: OperationsCode,
    readonly detail?: string,
  ) {
    super(code);
  }
}

export function throwOperationsHttp(error: unknown): never {
  if (error instanceof OperationsError) {
    const mapped = messages[error.code];
    throw new HttpException(error.detail ?? mapped.message, mapped.status);
  }
  throw error;
}
