"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, Dialog, ErrorState, TextField } from "@flyvan/ui";
import { apiBaseUrl, apiRequest, readError } from "../lib/api";
import { DriverEditDialog, DriverPasswordDialog } from "./driver-dialogs";
import { VehicleEditDialog } from "./vehicle-dialogs";
import { FileTile } from "./file-tile";
import { TableFrame } from "./table-frame";

type VehicleSummary = {
  id: string;
  plateNumber: string;
  capacity: number;
  vehicleType: string;
  approvalStatus: string;
  isPrimary: boolean;
  imageUrl: string | null;
  documentUrl: string | null;
  assignedDriver: { id: string; displayName: string } | null;
};

type DriverView = {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  approvalStatus: string;
  assignmentBlocked: boolean;
  createdAt: string;
  deletedAt: string | null;
  tripCount: number;
  imageUrl: string | null;
  primaryVehicle: VehicleSummary | null;
};

type DriverSort = "name" | "createdAt" | "activity";
type VehicleSort = "plate" | "createdAt" | "activity";
type SortDirection = "asc" | "desc";
type ReasonTarget = { kind: "driver" | "vehicle"; id: string };

const approvalLabels: Record<string, string> = {
  PENDING: "قيد المراجعة",
  APPROVED: "معتمد",
  SUSPENDED: "موقوف",
  REJECTED: "مرفوض",
};

const emptyDriverForm = {
  displayName: "",
  phone: "",
  email: "",
  password: "",
  plateNumber: "",
  capacity: "4",
  vehicleType: "فان",
};

export function DriversAdmin() {
  const [drivers, setDrivers] = useState<DriverView[]>([]);
  const [vehicles, setVehicles] = useState<VehicleSummary[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [vehicleOpen, setVehicleOpen] = useState(false);
  const [hasVehicle, setHasVehicle] = useState(false);
  const [driverForm, setDriverForm] = useState(emptyDriverForm);
  const [vehicleForm, setVehicleForm] = useState({ plateNumber: "", capacity: "4", vehicleType: "فان" });
  const [assignDriverId, setAssignDriverId] = useState("");
  const [assignDrivers, setAssignDrivers] = useState<DriverView[]>([]);
  const [deletedView, setDeletedView] = useState(false);
  const [sort, setSort] = useState<DriverSort>("createdAt");
  const [direction, setDirection] = useState<SortDirection>("desc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [total, setTotal] = useState(0);
  const [driversLoading, setDriversLoading] = useState(true);
  const [vehicleSort, setVehicleSort] = useState<VehicleSort>("createdAt");
  const [vehicleDirection, setVehicleDirection] = useState<SortDirection>("desc");
  const [vehiclePage, setVehiclePage] = useState(1);
  const [vehiclePageSize, setVehiclePageSize] = useState(10);
  const [assignTarget, setAssignTarget] = useState<VehicleSummary | null>(null);
  const [vehiclesDeleted, setVehiclesDeleted] = useState(false);
  const [editVehicle, setEditVehicle] = useState<VehicleSummary | null>(null);
  const [archiveVehicleTarget, setArchiveVehicleTarget] = useState<VehicleSummary | null>(null);
  const [vehicleSearchDraft, setVehicleSearchDraft] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [vehicleTotal, setVehicleTotal] = useState(0);
  const [vehiclesLoading, setVehiclesLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const [driverImage, setDriverImage] = useState<File | null>(null);
  const [driverDocument, setDriverDocument] = useState<File | null>(null);
  const [vehicleImage, setVehicleImage] = useState<File | null>(null);
  const [vehicleDocument, setVehicleDocument] = useState<File | null>(null);
  const [reasonTarget, setReasonTarget] = useState<ReasonTarget | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<DriverView | null>(null);
  const [editDriver, setEditDriver] = useState<DriverView | null>(null);
  const [passwordDriver, setPasswordDriver] = useState<DriverView | null>(null);
  function refresh(): void {
    setReloadKey((value) => value + 1);
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = searchDraft.trim();
      setSearch((current) => {
        if (current === next) return current;
        setPage(1);
        return next;
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [searchDraft]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const next = vehicleSearchDraft.trim();
      setVehicleSearch((current) => {
        if (current === next) return current;
        setVehiclePage(1);
        return next;
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [vehicleSearchDraft]);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sort,
      direction,
      deleted: String(deletedView),
    });
    if (search) query.set("q", search);
    void (async () => {
      const response = await apiRequest(`/api/drivers?${query.toString()}`);
      if (cancelled) return;
      if (response.status === 403) {
        setError("إدارة السائقين والمركبات متاحة لمالك المنصة ومدير العمليات.");
        setDriversLoading(false);
        return;
      }
      if (!response.ok) {
        setError(await readError(response, "تعذر تحميل السائقين."));
        setDriversLoading(false);
        return;
      }
      const body = (await response.json()) as { items: DriverView[]; total: number };
      setDrivers(body.items);
      setTotal(body.total);
      setDriversLoading(false);
      setError("");
    })();
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, sort, direction, deletedView, search, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({
      page: String(vehiclePage),
      pageSize: String(vehiclePageSize),
      sort: vehicleSort,
      direction: vehicleDirection,
      deleted: String(vehiclesDeleted),
    });
    if (vehicleSearch) query.set("q", vehicleSearch);
    void (async () => {
      const response = await apiRequest(`/api/vehicles?${query.toString()}`);
      if (cancelled) return;
      if (response.status === 403) {
        setError("إدارة السائقين والمركبات متاحة لمالك المنصة ومدير العمليات.");
        setVehiclesLoading(false);
        return;
      }
      if (!response.ok) {
        setError(await readError(response, "تعذر تحميل المركبات."));
        setVehiclesLoading(false);
        return;
      }
      const body = (await response.json()) as { items: VehicleSummary[]; total: number };
      setVehicles(body.items);
      setVehicleTotal(body.total);
      setVehiclesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [vehiclePage, vehiclePageSize, vehicleSort, vehicleDirection, vehicleSearch, vehiclesDeleted, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await apiRequest("/api/drivers?page=1&pageSize=100&sort=name&direction=asc&deleted=false");
      if (cancelled || !response.ok) return;
      const body = (await response.json()) as { items: DriverView[] };
      setAssignDrivers(body.items);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function openAddVehicle(): void {
    setVehicleForm({ plateNumber: "", capacity: "4", vehicleType: "فان" });
    setVehicleImage(null);
    setVehicleDocument(null);
    setError("");
    setVehicleOpen(true);
  }

  function openAddDriver(): void {
    setDriverForm(emptyDriverForm);
    setHasVehicle(false);
    setDriverImage(null);
    setDriverDocument(null);
    setError("");
    setAddOpen(true);
  }

  async function createDriver(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (hasVehicle && !driverImage) {
      setError("صورة المركبة مطلوبة.");
      return;
    }
    setPending(true);
    setMessage("");
    const body = new FormData();
    body.set("displayName", driverForm.displayName);
    body.set("phone", driverForm.phone);
    body.set("password", driverForm.password);
    if (driverForm.email.trim()) body.set("email", driverForm.email.trim());
    if (hasVehicle) {
      body.set("plateNumber", driverForm.plateNumber);
      body.set("capacity", driverForm.capacity);
      body.set("vehicleType", driverForm.vehicleType);
      if (driverImage) {
        body.set("vehicleImage", driverImage);
      }
      if (driverDocument) {
        body.set("vehicleDocument", driverDocument);
      }
    }
    const response = await apiRequest("/api/drivers", { method: "POST", body });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response, "تعذر إنشاء السائق."));
      return;
    }
    const created = (await response.json()) as DriverView;
    setAddOpen(false);
    setDriverForm(emptyDriverForm);
    setHasVehicle(false);
    setDriverImage(null);
    setDriverDocument(null);
    form.reset();
    setDeletedView(false);
    setSort("createdAt");
    setDirection("desc");
    setSearchDraft("");
    setSearch("");
    setPage(1);
    setDrivers((items) => [created, ...items.filter((item) => item.id !== created.id)].slice(0, pageSize));
    setTotal((count) => count + 1);
    setDriversLoading(false);
    if (created.primaryVehicle) {
      const vehicle = {
        ...created.primaryVehicle,
        assignedDriver: created.primaryVehicle.assignedDriver ?? { id: created.id, displayName: created.displayName },
      };
      setVehicleSort("createdAt");
      setVehicleDirection("desc");
      setVehicleSearchDraft("");
      setVehicleSearch("");
      setVehiclePage(1);
      setVehicles((items) => [vehicle, ...items.filter((item) => item.id !== vehicle.id)].slice(0, vehiclePageSize));
      setVehicleTotal((count) => count + 1);
      setVehiclesLoading(false);
    }
    setMessage(hasVehicle ? "تم إنشاء السائق وربط المركبة في الطلب نفسه." : "تم إنشاء السائق من دون مركبة.");
    refresh();
  }

  async function setApproval(target: ReasonTarget, status: "APPROVED" | "SUSPENDED", reason?: string): Promise<void> {
    const path = target.kind === "driver" ? `/api/drivers/${target.id}/approval` : `/api/vehicles/${target.id}/approval`;
    const response = await apiRequest(path, {
      method: "POST",
      body: JSON.stringify(reason ? { status, reason } : { status }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تغيير الاعتماد."));
      return;
    }
    setMessage(status === "APPROVED" ? "تم الاعتماد." : "تم إلغاء الاعتماد.");
    setReasonTarget(null);
    setReasonText("");
    refresh();
  }

  function toggleApproval(target: ReasonTarget, approved: boolean): void {
    if (approved) {
      setReasonText("");
      setReasonTarget(target);
      return;
    }
    void setApproval(target, "APPROVED");
  }

  async function confirmRevoke(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!reasonTarget || reasonText.trim().length < 3) {
      setError("سبب إلغاء الاعتماد يجب أن يكون 3 أحرف على الأقل.");
      return;
    }
    await setApproval(reasonTarget, "SUSPENDED", reasonText.trim());
  }

  async function confirmArchive(): Promise<void> {
    if (!archiveTarget) {
      return;
    }
    const response = await apiRequest(`/api/drivers/${archiveTarget.id}/archive`, { method: "POST" });
    if (!response.ok) {
      setError(await readError(response, "تعذر نقل السائق إلى المحذوفين."));
      return;
    }
    setArchiveTarget(null);
    setMessage("نُقل السائق إلى المحذوفين. السجل محفوظ.");
    refresh();
  }

  async function confirmArchiveVehicle(): Promise<void> {
    if (!archiveVehicleTarget) return;
    const response = await apiRequest(`/api/vehicles/${archiveVehicleTarget.id}/archive`, { method: "POST" });
    if (!response.ok) {
      setError(await readError(response, "تعذر نقل المركبة إلى المحذوفين."));
      return;
    }
    setArchiveVehicleTarget(null);
    setMessage("نُقلت المركبة إلى المحذوفين. السجل محفوظ.");
    refresh();
  }

  async function createVehicle(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const form = event.currentTarget;
    if (!vehicleImage) {
      setError("صورة المركبة مطلوبة.");
      return;
    }
    setPending(true);
    const body = new FormData();
    body.set("plateNumber", vehicleForm.plateNumber);
    body.set("capacity", vehicleForm.capacity);
    body.set("vehicleType", vehicleForm.vehicleType);
    body.set("vehicleImage", vehicleImage);
    if (vehicleDocument) {
      body.set("vehicleDocument", vehicleDocument);
    }
    const response = await apiRequest("/api/vehicles", { method: "POST", body });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response, "تعذر تسجيل المركبة."));
      return;
    }
    const created = (await response.json()) as VehicleSummary;
    setVehicleOpen(false);
    setVehicleForm({ plateNumber: "", capacity: "4", vehicleType: "فان" });
    setVehicleImage(null);
    setVehicleDocument(null);
    form.reset();
    setVehicleSort("createdAt");
    setVehicleDirection("desc");
    setVehicleSearchDraft("");
    setVehicleSearch("");
    setVehiclePage(1);
    setVehicles((items) => [created, ...items.filter((item) => item.id !== created.id)].slice(0, vehiclePageSize));
    setVehicleTotal((count) => count + 1);
    setVehiclesLoading(false);
    setMessage("تم تسجيل المركبة وحفظ رابط الصورة.");
    refresh();
  }

  function openAssign(vehicle: VehicleSummary): void {
    setAssignDriverId(vehicle.assignedDriver?.id ?? "");
    setAssignTarget(vehicle);
    setError("");
  }

  async function assignVehicle(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!assignTarget) return;
    if (!assignDriverId) {
      setError("اختر السائق قبل الإسناد.");
      return;
    }
    const response = await apiRequest(`/api/vehicles/${assignTarget.id}/assign`, {
      method: "POST",
      body: JSON.stringify({ driverProfileId: assignDriverId, isPrimary: true }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر إسناد المركبة."));
      return;
    }
    setAssignTarget(null);
    setMessage(assignTarget.assignedDriver ? "تم تغيير سائق المركبة." : "أُسندت المركبة كمركبة أساسية.");
    refresh();
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const vehiclePageCount = Math.max(1, Math.ceil(vehicleTotal / vehiclePageSize));

  if (error && drivers.length === 0 && vehicles.length === 0) {
    return <ErrorState title="السائقون والمركبات" description={error} />;
  }

  return (
    <section className="grid gap-4">
      <header className="fv-page-head">
        <div>
          <h1>السائقون والمركبات</h1>
          <p>
            السائق يتعاقد مع الشركة مباشرة. اعتماد السائق يحتاج وثيقة سائق معتمدة، واعتماد المركبة يحتاج صورتها.
            الحذف ينقل السائق إلى المحذوفين دون مسح السجل.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="teal" onClick={openAddDriver}>
            إضافة سائق
          </Button>
          <Button variant="teal" onClick={openAddVehicle}>
            إضافة مركبة
          </Button>
        </div>
      </header>
      {error && !addOpen ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="m-0 text-sm text-success">{message}</p> : null}
      <Dialog
        open={addOpen}
        title="إضافة سائق"
        description="يمكن حفظ السائق وحده، أو تفعيل المركبة لربطها في الطلب نفسه."
        onClose={() => setAddOpen(false)}
      >
        <form className="fv-dialog-layout" onSubmit={(event) => void createDriver(event)}>
          <div className="fv-dialog-scroll grid gap-4">
          {error ? (
            <p className="m-0 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <TextField
            label="الاسم"
            name="driverName"
            required
            value={driverForm.displayName}
            onChange={(event) => setDriverForm({ ...driverForm, displayName: event.target.value })}
          />
          <TextField
            label="الهاتف"
            name="driverPhone"
            required
            hint="مطلوب وفريد. يستطيع السائق تسجيل الدخول به."
            value={driverForm.phone}
            onChange={(event) => setDriverForm({ ...driverForm, phone: event.target.value })}
          />
          <TextField
            label="البريد"
            name="driverEmail"
            type="email"
            hint="اختياري. إن أُدخل يستطيع السائق الدخول به أيضًا."
            value={driverForm.email}
            onChange={(event) => setDriverForm({ ...driverForm, email: event.target.value })}
          />
          <TextField
            label="كلمة المرور"
            name="driverPassword"
            type="password"
            required
            minLength={8}
            hint="8 أحرف على الأقل."
            value={driverForm.password}
            onChange={(event) => setDriverForm({ ...driverForm, password: event.target.value })}
          />
          <div className="fv-switch">
            <span className="fv-switch-copy">
              <span className="font-semibold">لديه مركبة</span>
              <span className="text-sm text-muted">عند التفعيل تُضاف المركبة وتُربط بالسائق في الطلب نفسه.</span>
            </span>
            <button
              type="button"
              className="fv-switch-control"
              role="switch"
              aria-checked={hasVehicle}
              aria-label="لديه مركبة"
              onClick={() => setHasVehicle((value) => !value)}
            >
              <span />
            </button>
          </div>
          {hasVehicle ? (
            <div className="grid gap-4">
              <h3 className="m-0 text-base">بيانات المركبة</h3>
              <TextField
                label="اللوحة"
                name="newPlateNumber"
                required
                value={driverForm.plateNumber}
                onChange={(event) => setDriverForm({ ...driverForm, plateNumber: event.target.value })}
              />
              <TextField
                label="المقاعد"
                name="newCapacity"
                type="number"
                min={1}
                max={20}
                required
                value={driverForm.capacity}
                onChange={(event) => setDriverForm({ ...driverForm, capacity: event.target.value })}
              />
              <TextField
                label="النوع"
                name="newVehicleType"
                required
                value={driverForm.vehicleType}
                onChange={(event) => setDriverForm({ ...driverForm, vehicleType: event.target.value })}
              />
              <div className="fv-file-row">
                <FileTile
                  label="صورة المركبة"
                  accept="image/jpeg,image/png,image/webp"
                  file={driverImage}
                  onChange={setDriverImage}
                />
                <FileTile
                  label="وثيقة المركبة"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  file={driverDocument}
                  onChange={setDriverDocument}
                />
              </div>
            </div>
          ) : null}
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="teal" disabled={pending}>
              {pending ? "جارٍ الحفظ" : "حفظ"}
            </Button>
          </div>
        </form>
      </Dialog>
      <TableFrame
        sorts={[
          { id: "name", label: "الاسم", icon: "user" },
          { id: "createdAt", label: "تاريخ التسجيل", icon: "calendar" },
          { id: "activity", label: "الأكثر نشاطًا", icon: "activity" },
        ]}
        sort={sort}
        onSort={(id) => {
          setSort(id as DriverSort);
          setPage(1);
        }}
        direction={direction}
        onDirection={() => {
          setDirection((value) => (value === "asc" ? "desc" : "asc"));
          setPage(1);
        }}
        search={searchDraft}
        onSearch={setSearchDraft}
        pageSize={String(pageSize)}
        onPageSize={(value) => {
          setPageSize(Number(value));
          setPage(1);
        }}
        page={page}
        pageCount={pageCount}
        total={total}
        totalLabel="سائق"
        onPage={setPage}
        loading={driversLoading}
        isEmpty={drivers.length === 0}
        empty="لا يوجد سائقون في هذه القائمة."
        headers={["السائق", "الهاتف", "التسجيل", "الرحلات", "الاعتماد", "المركبة", "إجراء"]}
        extra={
          <>
            <Button
              type="button"
              variant={deletedView ? "secondary" : "teal"}
              onClick={() => {
                setDeletedView(false);
                setPage(1);
              }}
            >
              السائقون
            </Button>
            <Button
              type="button"
              variant={deletedView ? "teal" : "secondary"}
              onClick={() => {
                setDeletedView(true);
                setPage(1);
              }}
            >
              المحذوفون
            </Button>
          </>
        }
      >
        {drivers.map((driver) => (
          <tr key={driver.id}>
            <td>{driver.displayName}</td>
            <td>{driver.phone}</td>
            <td>{new Date(driver.createdAt).toLocaleDateString("ar")}</td>
            <td>{driver.tripCount}</td>
            <td>
              {deletedView ? (
                approvalLabels[driver.approvalStatus] ?? driver.approvalStatus
              ) : (
                <button
                  type="button"
                  className="fv-switch-control"
                  role="switch"
                  aria-checked={driver.approvalStatus === "APPROVED"}
                  aria-label={`اعتماد ${driver.displayName}`}
                  onClick={() =>
                    toggleApproval({ kind: "driver", id: driver.id }, driver.approvalStatus === "APPROVED")
                  }
                >
                  <span />
                </button>
              )}
              {driver.assignmentBlocked ? " الإسناد موقوف" : ""}
            </td>
            <td>{driver.primaryVehicle ? driver.primaryVehicle.plateNumber : "—"}</td>
            <td className="fv-actions-col">
              <div className="fv-cell-actions">
                <Link className="fv-icon-button" href={`/admin/drivers/${driver.id}`} title="التفاصيل" aria-label={`تفاصيل ${driver.displayName}`}>
                  <DetailIcon />
                </Link>
                <button type="button" className="fv-icon-button" title="تعديل" aria-label={`تعديل ${driver.displayName}`} onClick={() => setEditDriver(driver)}>
                  <EditIcon />
                </button>
                <button type="button" className="fv-icon-button" title="تغيير كلمة المرور" aria-label={`تغيير كلمة مرور ${driver.displayName}`} onClick={() => setPasswordDriver(driver)}>
                  <LockIcon />
                </button>
                {deletedView ? null : (
                  <button type="button" className="fv-icon-button is-danger" title="حذف" aria-label={`حذف ${driver.displayName}`} onClick={() => setArchiveTarget(driver)}>
                    <TrashIcon />
                  </button>
                )}
              </div>
            </td>
          </tr>
        ))}
      </TableFrame>
      <DriverEditDialog
        driver={editDriver}
        open={editDriver !== null}
        onClose={() => setEditDriver(null)}
        onSaved={() => {
          setMessage("تم تعديل السائق.");
          refresh();
        }}
      />
      <DriverPasswordDialog
        driver={passwordDriver}
        open={passwordDriver !== null}
        onClose={() => setPasswordDriver(null)}
        onSaved={() => setMessage("تم تغيير كلمة المرور.")}
      />
      <Card className="grid gap-4 p-4">
        <h2 className="m-0 text-lg">المركبات</h2>
        <TableFrame
          sorts={[
            { id: "plate", label: "اللوحة", icon: "plate" },
            { id: "createdAt", label: "تاريخ التسجيل", icon: "calendar" },
            { id: "activity", label: "الأكثر نشاطًا", icon: "activity" },
          ]}
          sort={vehicleSort}
          onSort={(id) => {
            setVehicleSort(id as VehicleSort);
            setVehiclePage(1);
          }}
          direction={vehicleDirection}
          onDirection={() => {
            setVehicleDirection((value) => (value === "asc" ? "desc" : "asc"));
            setVehiclePage(1);
          }}
          search={vehicleSearchDraft}
          onSearch={setVehicleSearchDraft}
          pageSize={String(vehiclePageSize)}
          onPageSize={(value) => {
            setVehiclePageSize(Number(value));
            setVehiclePage(1);
          }}
          page={vehiclePage}
          pageCount={vehiclePageCount}
          total={vehicleTotal}
          totalLabel="مركبة"
          onPage={setVehiclePage}
          loading={vehiclesLoading}
          isEmpty={vehicles.length === 0}
          empty="لا توجد مركبات."
          headers={["الصورة", "اللوحة", "النوع", "المقاعد", "السائق", "الوثيقة", "الاعتماد", "إجراء"]}
          extra={
            <>
              <Button
                type="button"
                variant={vehiclesDeleted ? "secondary" : "teal"}
                onClick={() => {
                  setVehiclesDeleted(false);
                  setVehiclePage(1);
                }}
              >
                المركبات
              </Button>
              <Button
                type="button"
                variant={vehiclesDeleted ? "teal" : "secondary"}
                onClick={() => {
                  setVehiclesDeleted(true);
                  setVehiclePage(1);
                }}
              >
                المحذوفون
              </Button>
            </>
          }
        >
          {vehicles.map((vehicle) => (
            <tr key={vehicle.id}>
              <td>
                {vehicle.imageUrl ? (
                  <img
                    src={`${apiBaseUrl()}${vehicle.imageUrl}`}
                    alt=""
                    className="h-12 w-16 rounded-lg object-cover"
                  />
                ) : (
                  "—"
                )}
              </td>
              <td>{vehicle.plateNumber}</td>
              <td>{vehicle.vehicleType}</td>
              <td>{vehicle.capacity}</td>
              <td>{vehicle.assignedDriver?.displayName ?? "—"}</td>
              <td>
                {vehicle.documentUrl ? (
                  <a href={`${apiBaseUrl()}${vehicle.documentUrl}`} target="_blank" rel="noreferrer">
                    عرض
                  </a>
                ) : (
                  "—"
                )}
              </td>
              <td>
                {vehiclesDeleted ? (
                  approvalLabels[vehicle.approvalStatus] ?? vehicle.approvalStatus
                ) : (
                  <button
                    type="button"
                    className="fv-switch-control"
                    role="switch"
                    aria-checked={vehicle.approvalStatus === "APPROVED"}
                    aria-label={`اعتماد المركبة ${vehicle.plateNumber}`}
                    onClick={() =>
                      toggleApproval({ kind: "vehicle", id: vehicle.id }, vehicle.approvalStatus === "APPROVED")
                    }
                  >
                    <span />
                  </button>
                )}
              </td>
              <td className="fv-actions-col">
                <div className="fv-cell-actions">
                  <Link className="fv-icon-button" href={`/admin/vehicles/${vehicle.id}`} title="التفاصيل" aria-label={`تفاصيل ${vehicle.plateNumber}`}>
                    <DetailIcon />
                  </Link>
                  <button type="button" className="fv-icon-button" title="تعديل" aria-label={`تعديل ${vehicle.plateNumber}`} onClick={() => setEditVehicle(vehicle)}>
                    <EditIcon />
                  </button>
                  {vehiclesDeleted ? null : (
                    <Button variant={vehicle.assignedDriver ? "secondary" : "primary"} onClick={() => openAssign(vehicle)}>
                      {vehicle.assignedDriver ? "تغيير السائق" : "إسناد"}
                    </Button>
                  )}
                  {vehiclesDeleted ? null : (
                    <button type="button" className="fv-icon-button is-danger" title="حذف" aria-label={`حذف ${vehicle.plateNumber}`} onClick={() => setArchiveVehicleTarget(vehicle)}>
                      <TrashIcon />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </TableFrame>
      </Card>
      <VehicleEditDialog
        vehicle={editVehicle}
        open={editVehicle !== null}
        onClose={() => setEditVehicle(null)}
        onSaved={() => {
          setMessage("تم تعديل المركبة.");
          refresh();
        }}
      />
      <Dialog
        open={archiveVehicleTarget !== null}
        title="نقل المركبة إلى المحذوفين"
        description={archiveVehicleTarget ? `${archiveVehicleTarget.plateNumber} لن تظهر في قائمة المركبات، ويبقى سجلها محفوظًا.` : undefined}
        onClose={() => setArchiveVehicleTarget(null)}
      >
        <div className="fv-dialog-layout">
          <div className="fv-dialog-scroll">
            <p className="m-0 text-sm text-muted">يُغلق إسنادها الحالي. لا تُحذف الرحلات المرتبطة بها.</p>
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="secondary" onClick={() => setArchiveVehicleTarget(null)}>
              إلغاء
            </Button>
            <Button type="button" variant="danger" onClick={() => void confirmArchiveVehicle()}>
              نقل إلى المحذوفين
            </Button>
          </div>
        </div>
      </Dialog>
      <Dialog
        open={vehicleOpen}
        title="إضافة مركبة"
        description="صورة المركبة مطلوبة، والوثيقة اختيارية. يُحفظ الرابطان في السجل."
        onClose={() => setVehicleOpen(false)}
      >
        <form className="fv-dialog-layout" onSubmit={(event) => void createVehicle(event)}>
          <div className="fv-dialog-scroll grid gap-4">
            <TextField
              label="اللوحة"
              name="plateNumber"
              required
              value={vehicleForm.plateNumber}
              onChange={(event) => setVehicleForm({ ...vehicleForm, plateNumber: event.target.value })}
            />
            <TextField
              label="المقاعد"
              name="capacity"
              type="number"
              min={1}
              max={20}
              required
              value={vehicleForm.capacity}
              onChange={(event) => setVehicleForm({ ...vehicleForm, capacity: event.target.value })}
            />
            <TextField
              label="النوع"
              name="vehicleType"
              required
              value={vehicleForm.vehicleType}
              onChange={(event) => setVehicleForm({ ...vehicleForm, vehicleType: event.target.value })}
            />
            <div className="fv-file-row">
              <FileTile
                label="صورة المركبة"
                accept="image/jpeg,image/png,image/webp"
                file={vehicleImage}
                onChange={setVehicleImage}
              />
              <FileTile
                label="وثيقة المركبة"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                file={vehicleDocument}
                onChange={setVehicleDocument}
              />
            </div>
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="secondary" onClick={() => setVehicleOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit" variant="teal" disabled={pending}>
              {pending ? "جارٍ الحفظ" : "حفظ"}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={reasonTarget !== null}
        title="إلغاء الاعتماد"
        description="الاعتماد يتم مباشرة. إلغاؤه يحتاج سببًا يُحفظ في سجل التدقيق."
        onClose={() => setReasonTarget(null)}
      >
        <form className="fv-dialog-layout" onSubmit={(event) => void confirmRevoke(event)}>
          <div className="fv-dialog-scroll">
            <label className="fv-field">
              <span className="fv-label">سبب إلغاء الاعتماد</span>
              <textarea
                className="fv-input min-h-28"
                required
                minLength={3}
                maxLength={300}
                value={reasonText}
                onChange={(event) => setReasonText(event.target.value)}
              />
            </label>
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="secondary" onClick={() => setReasonTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" variant="danger">
              تأكيد الإلغاء
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={assignTarget !== null}
        title={assignTarget?.assignedDriver ? "تغيير السائق" : "إسناد المركبة"}
        description={assignTarget ? `المركبة ${assignTarget.plateNumber}` : undefined}
        onClose={() => setAssignTarget(null)}
      >
        <form className="fv-dialog-layout" onSubmit={(event) => void assignVehicle(event)}>
          <div className="fv-dialog-scroll">
            <label className="fv-field">
              <span className="fv-label">السائق</span>
              <select
                className="fv-input"
                required
                value={assignDriverId}
                onChange={(event) => setAssignDriverId(event.target.value)}
              >
                <option value="">اختر السائق</option>
                {assignDrivers.map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.displayName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="secondary" onClick={() => setAssignTarget(null)}>
              إلغاء
            </Button>
            <Button type="submit" variant="teal">
              {assignTarget?.assignedDriver ? "تغيير السائق" : "إسناد"}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        open={archiveTarget !== null}
        title="نقل السائق إلى المحذوفين"
        description={archiveTarget ? `${archiveTarget.displayName} لن يظهر في قائمة السائقين، ويبقى سجله محفوظًا.` : undefined}
        onClose={() => setArchiveTarget(null)}
      >
        <div className="fv-dialog-layout">
          <div className="fv-dialog-scroll">
            <p className="m-0 text-sm text-muted">لن يُحذف الحساب ولا الرحلات المرتبطة به.</p>
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="secondary" onClick={() => setArchiveTarget(null)}>
              إلغاء
            </Button>
            <Button type="button" variant="danger" onClick={() => void confirmArchive()}>
              نقل إلى المحذوفين
            </Button>
          </div>
        </div>
      </Dialog>
    </section>
  );
}

function DetailIcon() {
  return (
    <svg className="fv-table-icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8.25" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M12 10.5v5.2M12 7.6h.01" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="fv-table-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 20h4.2L19 9.2 14.8 5 4 15.8V20zM13.2 6.6l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="fv-table-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5.5" y="10.5" width="13" height="8.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <path d="M8.2 10.5V8.2a3.8 3.8 0 0 1 7.6 0v2.3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="fv-table-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 8h14M9 8V5.8h6V8M8 8l1 11.2h6L16 8" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
