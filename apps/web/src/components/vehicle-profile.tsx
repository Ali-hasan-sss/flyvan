"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, Dialog, ErrorState, TextField } from "@flyvan/ui";
import { apiBaseUrl, apiRequest, readError } from "../lib/api";
import { VehicleEditDialog } from "./vehicle-dialogs";

type MoneyTotal = { currency: string; amount: string };

type VehicleProfile = {
  id: string;
  plateNumber: string;
  capacity: number;
  vehicleType: string;
  approvalStatus: string;
  imageUrl: string | null;
  documentUrl: string | null;
  createdAt: string;
  deletedAt: string | null;
  assignedDriver: { id: string; displayName: string } | null;
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

export function VehicleProfileView({ vehicleId }: { vehicleId: string }) {
  const [vehicle, setVehicle] = useState<VehicleProfile | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [documentKind, setDocumentKind] = useState("رخصة مركبة");
  const [documentExpiry, setDocumentExpiry] = useState("");

  async function load(): Promise<void> {
    const response = await apiRequest(`/api/vehicles/${vehicleId}`);
    if (response.status === 404) {
      setError("المركبة غير موجودة.");
      setVehicle(null);
      return;
    }
    if (!response.ok) {
      setError(await readError(response, "تعذر قراءة ملف المركبة."));
      return;
    }
    setVehicle((await response.json()) as VehicleProfile);
    setError("");
  }

  useEffect(() => {
    void load();
  }, [vehicleId]);

  async function archive(): Promise<void> {
    if (!vehicle) return;
    const response = await apiRequest(`/api/vehicles/${vehicle.id}/archive`, { method: "POST" });
    if (!response.ok) {
      setError(await readError(response, "تعذر نقل المركبة إلى المحذوفين."));
      return;
    }
    setArchiveOpen(false);
    setMessage("نُقلت المركبة إلى المحذوفين. السجل محفوظ.");
    await load();
  }

  async function approve(status: "APPROVED" | "SUSPENDED", revokeReason?: string): Promise<void> {
    if (!vehicle) return;
    const response = await apiRequest(`/api/vehicles/${vehicle.id}/approval`, {
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
    if (!vehicle) return;
    const response = await apiRequest(`/api/vehicles/${vehicle.id}/documents`, {
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
    const response = await apiRequest(`/api/vehicle-documents/${documentId}/review`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر مراجعة الوثيقة."));
      return;
    }
    await load();
  }

  if (error && !vehicle) return <ErrorState title="ملف المركبة" description={error} />;
  if (!vehicle) return <p className="m-0 text-muted">جارٍ تحميل ملف المركبة.</p>;

  return (
    <section className="fv-profile">
      <Link className="fv-back-link" href="/admin/drivers">عودة إلى المركبات</Link>
      {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
      {message ? <p className="m-0 text-sm text-success">{message}</p> : null}
      <article className="fv-profile-hero">
        {vehicle.imageUrl ? (
          <img className="fv-profile-photo" src={`${apiBaseUrl()}${vehicle.imageUrl}`} alt="" />
        ) : (
          <div className="fv-profile-photo" aria-hidden="true">{vehicle.plateNumber.slice(0, 1)}</div>
        )}
        <div>
          <h1 className="m-0 text-2xl">{vehicle.plateNumber}</h1>
          <p className="fv-profile-meta">
            <span>{vehicle.vehicleType}</span>
            <span>{vehicle.capacity} مقاعد</span>
            <span>منذ {new Date(vehicle.createdAt).toLocaleDateString("ar")}</span>
            <span>{approvalLabels[vehicle.approvalStatus] ?? vehicle.approvalStatus}</span>
            {vehicle.deletedAt ? <span>في قائمة المحذوفين</span> : null}
            {vehicle.assignedDriver ? (
              <Link className="fv-back-link" href={`/admin/drivers/${vehicle.assignedDriver.id}`}>{vehicle.assignedDriver.displayName}</Link>
            ) : (
              <span>بدون سائق</span>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={() => setEditOpen(true)}>تعديل</Button>
            {vehicle.deletedAt ? null : (
              <Button variant="danger" onClick={() => setArchiveOpen(true)}>نقل إلى المحذوفين</Button>
            )}
            {vehicle.documentUrl ? (
              <a className="fv-back-link" href={`${apiBaseUrl()}${vehicle.documentUrl}`} target="_blank" rel="noreferrer">عرض الوثيقة</a>
            ) : null}
            {vehicle.deletedAt ? null : (
              <button
                type="button"
                className="fv-switch-control"
                role="switch"
                aria-checked={vehicle.approvalStatus === "APPROVED"}
                aria-label="اعتماد المركبة"
                title="اعتماد المركبة"
                onClick={() => {
                  if (vehicle.approvalStatus === "APPROVED") {
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
          <dd>{vehicle.stats.tripCount}</dd>
        </div>
        <div className="fv-stat">
          <dt>مجموع العمولات</dt>
          <dd>{moneyText(vehicle.stats.commissionTotals, "لا توجد عمولات")}</dd>
        </div>
        <div className="fv-stat">
          <dt>العمولات المترتبة حاليًا</dt>
          <dd>{moneyText(vehicle.stats.outstandingTotals, "لا يوجد مستحق")}</dd>
        </div>
      </dl>
      <Card className="grid gap-3 p-4">
        <h2 className="m-0 text-lg">الوثائق</h2>
        {vehicle.documents.length === 0 ? <p className="m-0">لا توجد وثائق.</p> : null}
        <ul className="m-0 grid gap-2 p-0">
          {vehicle.documents.map((document) => (
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
      <VehicleEditDialog vehicle={vehicle} open={editOpen} onClose={() => setEditOpen(false)} onSaved={() => void load()} />
      <Dialog open={archiveOpen} title="نقل المركبة إلى المحذوفين" description="السجل يبقى محفوظًا ولن تظهر في قائمة المركبات." onClose={() => setArchiveOpen(false)}>
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
