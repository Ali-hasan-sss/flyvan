import { HttpException } from "@nestjs/common";

export type FinanceCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "ACCOUNT"
  | "LIMIT"
  | "RATE"
  | "AMOUNT"
  | "DUPLICATE"
  | "STATE"
  | "REASON";

const messages: Record<FinanceCode, { status: number; message: string }> = {
  NOT_FOUND: { status: 404, message: "السجل المالي غير موجود." },
  FORBIDDEN: { status: 403, message: "ليست لديك صلاحية لهذا الإجراء المالي." },
  ACCOUNT: { status: 409, message: "لا يوجد حد ائتماني للسائق بهذه العملة." },
  LIMIT: { status: 409, message: "الإسناد يتجاوز حد مديونية هذا السائق." },
  RATE: { status: 409, message: "لا توجد نسبة عمولة سارية." },
  AMOUNT: { status: 400, message: "المبلغ أو النسبة غير صالحة." },
  DUPLICATE: { status: 409, message: "هذه الدفعة مسجّلة مسبقًا." },
  STATE: { status: 409, message: "حالة التسوية لا تسمح بهذا الإجراء." },
  REASON: { status: 400, message: "السبب يجب أن يكون بين 3 و300 حرف." },
};

export class FinanceError extends Error {
  constructor(
    readonly code: FinanceCode,
    readonly detail?: string,
  ) {
    super(code);
  }
}

export function throwFinanceHttp(error: unknown): never {
  if (error instanceof FinanceError) {
    const mapped = messages[error.code];
    throw new HttpException(error.detail ?? mapped.message, mapped.status);
  }
  throw error;
}
