"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, Dialog, ErrorState, TextField } from "@flyvan/ui";
import { apiBaseUrl, apiRequest, readError } from "../lib/api";
import { DriverEditDialog, DriverPasswordDialog } from "./driver-dialogs";
import { DriverTripSchedule } from "./driver-trip-schedule";

type MoneyTotal = { currency: string; amount: string };

type VehicleSummary = {
  id: string;
  plateNumber: string;
  capacity: number;
  vehicleType: string;
  approvalStatus: string;
  imageUrl: string | null;
};

type DriverProfile = {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  approvalStatus: string;
  assignmentBlocked: boolean;
  createdAt: string;
  deletedAt: string | null;
  imageUrl: string | null;
  primaryVehicle: VehicleSummary | null;
  documents: { id: string; kind: string; status: string; expiresOn: string | null }[];
  stats: { tripCount: number; commissionTotals: MoneyTotal[]; outstandingTotals: MoneyTotal[] };
};

const approvalLabels: Record<string, string> = {
  PENDING: "قيد المراجعة",
  APPROVED: "معتمد",
  SUSPENDED: "موقوف",
  REJECTED: "مرفوض",
};

function moneyText(totals: MoneyTotal[], empty: string): string {
  if (totals.length === 0) return empty;
  return totals.map((item) => `${item.amount} ${item.currency}`).join(" · ");
}

export function DriverProfileView({ driverId }: { driverId: string }) {
  const [driver, setDriver] = useState<DriverProfile | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [documentKind, setDocumentKind] = useState("رخصة قيادة");
  const [documentExpiry, setDocumentExpiry] = useState("");

  async function load(): Promise<void> {
    const response = await apiRequest(`/api/drivers/${driverId}`);
    if (response.status === 404) {
      setError("السائق غير موجود.");
      setDriver(null);
      return;
    }
    if (!response.ok) {
      setError(await readError(response, "تعذر قراءة ملف السائق."));
      return;
    }
    setDriver((await response.json()) as DriverProfile);
    setError("");
  }

  useEffect(() => {
    void load();
  }, [driverId]);

  async function archive(): Promise<void> {
    if (!driver) return;
    const response = await apiRequest(`/api/drivers/${driver.id}/archive`, { method: "POST" });
    if (!response.ok) {
      setError(await readError(response, "تعذر نقل السائق إلى المحذوفين."));
      return;
    }
    setArchiveOpen(false);
    setMessage("نُقل السائق إلى المحذوفين. السجل محفوظ.");
    await load();
  }

  async function approve(status: "APPROVED" | "SUSPENDED", revokeReason?: string): Promise<void> {
    if (!driver) return;
    const response = await apiRequest(`/api/drivers/${driver.id}/approval`, {
      method: "POST",
      body: JSON.stringify(revokeReason ? { status, reason: revokeReason } : { status }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تغيير الاعتماد."));
      return;
    }
    setRevokeOpen(false);
    setReason("");
    setMessage(status === "APPROVED" ? "تم الاعتماد." : "تم إلغاء الاعتماد.");
    await load();
  }

  async function addDocument(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!driver) return;
    const response = await apiRequest(`/api/drivers/${driver.id}/documents`, {
      method: "POST",
      body: JSON.stringify({ kind: documentKind, expiresOn: documentExpiry }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تسجيل الوثيقة."));
      return;
    }
    setMessage("سُجّلت بيانات الوثيقة.");
    await load();
  }

  async function reviewDocument(documentId: string, status: "APPROVED" | "REJECTED"): Promise<void> {
    const response = await apiRequest(`/api/driver-documents/${documentId}/review`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر مراجعة الوثيقة."));
      return;
    }
    await load();
  }

  if (error && !driver) return <ErrorState title="ملف السائق" description={error} />;
  if (!driver) return <p className="m-0 text-muted">جارٍ تحميل ملف السائق.</p>;

  return (
    <section className="fv-profile">
      <Link className="fv-back-link" href="/admin/drivers">عودة إلى السائقين</Link>
      {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
      {message ? <p className="m-0 text-sm text-success">{message}</p> : null}
      <article className="fv-profile-hero">
        {driver.imageUrl ? (
          <img className="fv-profile-photo" src={`${apiBaseUrl()}${driver.imageUrl}`} alt="" />
        ) : (
          <div className="fv-profile-photo" aria-hidden="true">{driver.displayName.slice(0, 1)}</div>
        )}
        <div>
          <h1 className="m-0 text-2xl">{driver.displayName}</h1>
          <p className="fv-profile-meta">
            <span>{driver.phone ?? "بدون هاتف"}</span>
            <span>{driver.email ?? "بدون بريد"}</span>
            <span>منذ {new Date(driver.createdAt).toLocaleDateString("ar")}</span>
            <span>{approvalLabels[driver.approvalStatus] ?? driver.approvalStatus}</span>
            {driver.deletedAt ? <span>في قائمة المحذوفين</span> : null}
            {driver.assignmentBlocked ? <span>الإسناد موقوف</span> : null}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(true)}>تعديل</Button>
            <Button variant="secondary" onClick={() => setPasswordOpen(true)}>تغيير كلمة المرور</Button>
            {driver.deletedAt ? null : (
              <Button variant="danger" onClick={() => setArchiveOpen(true)}>نقل إلى المحذوفين</Button>
            )}
            {driver.deletedAt ? null : (
              <button
                type="button"
                className="fv-switch-control"
                role="switch"
                aria-checked={driver.approvalStatus === "APPROVED"}
                aria-label="اعتماد السائق"
                title="اعتماد السائق"
                onClick={() => {
                  if (driver.approvalStatus === "APPROVED") {
                    setReason("");
                    setRevokeOpen(true);
                    return;
                  }
                  void approve("APPROVED");
                }}
              >
                <span />
              </button>
            )}
          </div>
        </div>
      </article>
      <dl className="fv-stat-grid">
        <div className="fv-stat">
          <dt>عدد الرحلات</dt>
          <dd>{driver.stats.tripCount}</dd>
        </div>
        <div className="fv-stat">
          <dt>مجموع العمولات</dt>
          <dd>{moneyText(driver.stats.commissionTotals, "لا توجد عمولات")}</dd>
        </div>
        <div className="fv-stat">
          <dt>العمولات المترتبة حاليًا</dt>
          <dd>{moneyText(driver.stats.outstandingTotals, "لا يوجد مستحق")}</dd>
        </div>
      </dl>
      <DriverTripSchedule driverId={driver.id} />
      <Card className="grid gap-3 p-4">
        <h2 className="m-0 text-lg">المركبة</h2>
        {driver.primaryVehicle ? (
          <div className="flex flex-wrap items-center gap-3">
            {driver.primaryVehicle.imageUrl ? (
              <img className="h-16 w-24 rounded-xl object-cover" src={`${apiBaseUrl()}${driver.primaryVehicle.imageUrl}`} alt="" />
            ) : null}
            <div>
              <p className="m-0 font-bold">
                <Link className="fv-back-link" href={`/admin/vehicles/${driver.primaryVehicle.id}`}>{driver.primaryVehicle.plateNumber}</Link>
              </p>
              <p className="m-0 text-sm text-muted">
                {driver.primaryVehicle.vehicleType} — {driver.primaryVehicle.capacity} مقاعد — {approvalLabels[driver.primaryVehicle.approvalStatus] ?? driver.primaryVehicle.approvalStatus}
              </p>
            </div>
          </div>
        ) : (
          <p className="m-0 text-muted">لا توجد مركبة مرتبطة.</p>
        )}
      </Card>
      <Card className="grid gap-3 p-4">
        <h2 className="m-0 text-lg">الوثائق</h2>
        {driver.documents.length === 0 ? <p className="m-0">لا توجد وثائق.</p> : null}
        <ul className="m-0 grid gap-2 p-0">
          {driver.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {document.kind} — {approvalLabels[document.status] ?? document.status}
                {document.expiresOn ? ` — حتى ${document.expiresOn}` : ""}
              </span>
              <span className="flex gap-2">
                <Button variant="secondary" onClick={() => void reviewDocument(document.id, "APPROVED")}>اعتماد الوثيقة</Button>
                <Button variant="ghost" onClick={() => void reviewDocument(document.id, "REJECTED")}>رفض</Button>
              </span>
            </li>
          ))}
        </ul>
        <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => void addDocument(event)}>
          <TextField label="نوع الوثيقة" name="documentKind" value={documentKind} onChange={(event) => setDocumentKind(event.target.value)} required />
          <TextField label="تاريخ الانتهاء" name="documentExpiry" type="date" value={documentExpiry} onChange={(event) => setDocumentExpiry(event.target.value)} />
          <div className="flex items-end"><Button type="submit">تسجيل الوثيقة</Button></div>
        </form>
      </Card>
      <DriverEditDialog driver={driver} open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => void load()} />
      <DriverPasswordDialog driver={driver} open={passwordOpen} onClose={() => setPasswordOpen(false)} onSaved={() => setMessage("تم تغيير كلمة المرور.")} />
      <Dialog open={archiveOpen} title="نقل السائق إلى المحذوفين" description="السجل يبقى محفوظًا ولن يظهر في قائمة السائقين." onClose={() => setArchiveOpen(false)}>
        <div className="fv-dialog-footer">
          <Button type="button" variant="secondary" onClick={() => setArchiveOpen(false)}>إلغاء</Button>
          <Button type="button" variant="danger" onClick={() => void archive()}>نقل إلى المحذوفين</Button>
        </div>
      </Dialog>
      <Dialog open={revokeOpen} title="إلغاء الاعتماد" description="إلغاء الاعتماد يحتاج سببًا." onClose={() => setRevokeOpen(false)}>
        <form
          className="fv-dialog-layout"
          onSubmit={(event) => {
            event.preventDefault();
            if (reason.trim().length < 3) {
              setError("سبب إلغاء الاعتماد يجب أن يكون 3 أحرف على الأقل.");
              return;
            }
            void approve("SUSPENDED", reason.trim());
          }}
        >
          <div className="fv-dialog-scroll">
            <TextField label="سبب إلغاء الاعتماد" name="revokeReason" required minLength={3} value={reason} onChange={(event) => setReason(event.target.value)} />
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="secondary" onClick={() => setRevokeOpen(false)}>إلغاء</Button>
            <Button type="submit" variant="danger">تأكيد الإلغاء</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
