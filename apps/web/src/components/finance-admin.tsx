"use client";

import { useEffect, useState } from "react";
import { Badge, Button, ErrorState, TextField } from "@flyvan/ui";
import { apiRequest, readError } from "../lib/api";
import { readSession } from "../lib/session";

type Account = {
  driverProfileId: string;
  driverName: string;
  currency: string;
  creditLimitAmount: string | null;
  ratePercent: string | null;
  outstanding: string;
  settled: string;
};

type Settlement = {
  id: string;
  driverProfileId: string;
  driverName: string;
  amount: string;
  currency: string;
  method: string;
  receivedAt: string;
  receiptNumber: string;
  status: string;
};

type Summary = {
  currency: string;
  companyOutstanding: string;
  companyOutstandingNote: string;
  policy: { ratePercent: string; effectiveFrom: string } | null;
  accounts: Account[];
  settlements: Settlement[];
};

const settlementLabels: Record<string, string> = {
  RECORDED: "مسجّلة",
  PENDING_REVIEW: "بانتظار الاعتماد",
  APPROVED: "معتمدة",
  REJECTED: "مرفوضة",
  REVERSED: "معكوسة",
};

export function FinanceAdmin() {
  const role = readSession()?.user.role;
  const canManage = role === "PLATFORM_OWNER";
  const canRecord = role === "PLATFORM_OWNER" || role === "FINANCE";
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [policyRate, setPolicyRate] = useState("10");
  const [policyReason, setPolicyReason] = useState("");
  const [payment, setPayment] = useState({ driverProfileId: "", amount: "", receiptNumber: "", method: "CASH" });

  async function load(): Promise<void> {
    const response = await apiRequest("/api/finance/summary");
    if (response.status === 403) {
      setError("عرض المالية متاح للإدارة والمالية ومالك المنصة.");
      return;
    }
    if (!response.ok) {
      setError(await readError(response, "تعذر تحميل الأرصدة."));
      return;
    }
    const body = (await response.json()) as Summary;
    setSummary(body);
    setPayment((current) => ({
      ...current,
      driverProfileId: current.driverProfileId || body.accounts[0]?.driverProfileId || "",
    }));
    setError("");
  }

  useEffect(() => {
    void load();
  }, []);

  async function submit(path: string, body: unknown, success: string): Promise<void> {
    setPending(true);
    setMessage("");
    const response = await apiRequest(path, { method: "POST", body: JSON.stringify(body) });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response, "تعذر حفظ العملية المالية."));
      return;
    }
    setError("");
    setMessage(success);
    await load();
  }

  if (error && !summary) return <ErrorState title="المالية" description={error} />;
  if (!summary) return <p className="m-0 text-sm text-muted">جارٍ تحميل الأرصدة.</p>;

  return (
    <section className="grid gap-4">
      <header className="fv-page-head">
        <div>
          <h1>المالية</h1>
          <p>الرصيد المستحق يُحسب من قيود العمولة والدفعات المعتمدة. أجرة الراكب النقدية لا تدخل هذا الدفتر.</p>
        </div>
      </header>
      {error ? <p className="m-0 text-sm text-danger">{error}</p> : null}
      {message ? <p className="m-0 text-sm text-success">{message}</p> : null}
      <article className="fv-card grid gap-2 p-4">
        <h2 className="m-0 text-base">إجمالي مستحقات الشركة</h2>
        <strong className="text-2xl">{summary.companyOutstanding} {summary.currency}</strong>
        <p className="m-0 text-sm text-muted">{summary.companyOutstandingNote}</p>
        <p className="m-0 text-sm">
          السياسة السارية: {summary.policy ? `${summary.policy.ratePercent}%` : "لم تُحدَّد بعد"}
        </p>
      </article>
      {canManage ? (
        <form
          className="fv-card grid gap-3 p-4 md:grid-cols-[1fr_2fr_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(
              "/api/finance/policy",
              { ratePercent: policyRate, effectiveFrom: new Date().toISOString(), reason: policyReason },
              "حُفظت سياسة العمولة الجديدة دون تعديل العمولات السابقة.",
            );
          }}
        >
          <TextField label="نسبة العمولة %" name="policy-rate" value={policyRate} onChange={(event) => setPolicyRate(event.target.value)} required />
          <TextField label="سبب السياسة" name="policy-reason" value={policyReason} onChange={(event) => setPolicyReason(event.target.value)} required minLength={3} />
          <div className="self-end">
            <Button type="submit" disabled={pending}>حفظ السياسة</Button>
          </div>
        </form>
      ) : null}
      <div className="grid gap-3">
        {summary.accounts.length === 0 ? <p className="m-0 text-sm text-muted">لا يوجد سائقون لعرض أرصدتهم.</p> : null}
        {summary.accounts.map((account) => (
          <article key={`${account.driverProfileId}-${account.currency}`} className="fv-card grid gap-2 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="m-0 text-base">{account.driverName}</h2>
              <span className="text-sm text-muted">{account.currency}</span>
            </div>
            <p className="m-0 text-sm">المستحق {account.outstanding} · المسدّد {account.settled} · الحد {account.creditLimitAmount ?? "غير معيّن"}</p>
            {canManage ? (
              <LimitForm
                driverId={account.driverProfileId}
                disabled={pending}
                onSubmit={(amount, reason) =>
                  submit(`/api/finance/drivers/${account.driverProfileId}/credit-limit`, { amount, reason }, "حُدّث حد المديونية.")
                }
              />
            ) : null}
          </article>
        ))}
      </div>
      {canRecord ? (
        <form
          className="fv-card grid gap-3 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit(
              "/api/finance/settlements",
              {
                ...payment,
                receivedAt: new Date().toISOString(),
                idempotencyKey: `receipt-${payment.receiptNumber.trim()}`,
              },
              "سُجّلت الدفعة. لا تدخل الدفتر قبل اعتماد مالك المنصة.",
            );
          }}
        >
          <h2 className="m-0 text-base">تسجيل دفعة مستلمة</h2>
          <label className="grid gap-1 text-sm font-semibold">
            السائق
            <select
              className="fv-input"
              name="driver"
              value={payment.driverProfileId}
              onChange={(event) => setPayment({ ...payment, driverProfileId: event.target.value })}
              required
            >
              {summary.accounts.map((account) => (
                <option key={account.driverProfileId} value={account.driverProfileId}>
                  {account.driverName}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <TextField label="المبلغ" name="amount" value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} required />
            <TextField label="رقم الإيصال" name="receipt" value={payment.receiptNumber} onChange={(event) => setPayment({ ...payment, receiptNumber: event.target.value })} required minLength={3} />
            <TextField label="طريقة الاستلام" name="method" value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value })} required />
          </div>
          <Button type="submit" disabled={pending || !payment.driverProfileId}>تسجيل الدفعة</Button>
        </form>
      ) : null}
      <article className="fv-card grid gap-3 p-4">
        <h2 className="m-0 text-base">التسويات</h2>
        {summary.settlements.length === 0 ? <p className="m-0 text-sm text-muted">لا توجد دفعات مسجّلة.</p> : null}
        <ul className="m-0 grid gap-3 p-0">
          {summary.settlements.map((settlement) => (
            <li key={settlement.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 last:border-0">
              <div>
                <strong>{settlement.driverName}</strong>
                <p className="m-0 text-sm text-muted">
                  {settlement.amount} {settlement.currency} · إيصال {settlement.receiptNumber}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={settlement.status === "APPROVED" ? "success" : settlement.status === "REJECTED" ? "danger" : "warning"}>
                  {settlementLabels[settlement.status] ?? settlement.status}
                </Badge>
                {canRecord && settlement.status === "RECORDED" ? (
                  <Button type="button" variant="secondary" disabled={pending} onClick={() => void submit(`/api/finance/settlements/${settlement.id}/review`, { decision: "PENDING_REVIEW", note: "مطابقة الإيصال" }, "أُرسلت الدفعة للاعتماد.")}>
                    مراجعة
                  </Button>
                ) : null}
                {canManage && (settlement.status === "RECORDED" || settlement.status === "PENDING_REVIEW") ? (
                  <Button type="button" disabled={pending} onClick={() => void submit(`/api/finance/settlements/${settlement.id}/approve`, {}, "اعتُمدت الدفعة ودخلت الدفتر.")}>
                    اعتماد
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}

function LimitForm({
  driverId,
  disabled,
  onSubmit,
}: {
  driverId: string;
  disabled: boolean;
  onSubmit: (amount: string, reason: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  return (
    <form
      className="grid gap-2 md:grid-cols-[10rem_1fr_auto]"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit(amount, reason);
      }}
    >
      <TextField label="حد المديونية" name={`limit-${driverId}`} value={amount} onChange={(event) => setAmount(event.target.value)} required />
      <TextField label="سبب التعديل" name={`limit-reason-${driverId}`} value={reason} onChange={(event) => setReason(event.target.value)} required minLength={3} />
      <div className="self-end">
        <Button type="submit" variant="secondary" disabled={disabled}>تحديث الحد</Button>
      </div>
    </form>
  );
}
