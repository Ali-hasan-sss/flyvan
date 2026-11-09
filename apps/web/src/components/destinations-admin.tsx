"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Button, Dialog, ErrorState, TextField } from "@flyvan/ui";
import { apiRequest, readError } from "../lib/api";

const MapPicker = dynamic(() => import("./map-picker").then((mod) => mod.MapPicker), { ssr: false });

type Destination = {
  id: string;
  name: string;
  latitude: string;
  longitude: string;
  addressNote: string | null;
  notes: string | null;
  isActive: boolean;
};

type DestinationForm = {
  name: string;
  latitude: string;
  longitude: string;
  addressNote: string;
  notes: string;
  isActive: boolean;
};

const emptyForm: DestinationForm = {
  name: "",
  latitude: "",
  longitude: "",
  addressNote: "",
  notes: "",
  isActive: true,
};

export function DestinationsAdmin() {
  const [items, setItems] = useState<Destination[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [forbidden, setForbidden] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Destination | null>(null);
  const [form, setForm] = useState<DestinationForm>(emptyForm);

  async function load(): Promise<void> {
    const response = await apiRequest("/api/destinations");
    if (response.status === 403) {
      setForbidden("إدارة الوجهات متاحة للكونترول والإدارة ومالك المنصة.");
      return;
    }
    if (!response.ok) {
      setError(await readError(response, "تعذر تحميل الوجهات."));
      return;
    }
    const body = (await response.json()) as { items: Destination[] };
    setItems(body.items);
    setError("");
  }

  useEffect(() => {
    void load();
  }, []);

  function openCreate(): void {
    setEditing(null);
    setForm(emptyForm);
    setError("");
    setOpen(true);
  }

  function openEdit(item: Destination): void {
    setEditing(item);
    setForm({
      name: item.name,
      latitude: item.latitude,
      longitude: item.longitude,
      addressNote: item.addressNote ?? "",
      notes: item.notes ?? "",
      isActive: item.isActive,
    });
    setError("");
    setOpen(true);
  }

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!form.latitude || !form.longitude) {
      setError("حدد موقع الوجهة على الخريطة.");
      return;
    }
    const response = await apiRequest(editing ? `/api/destinations/${editing.id}` : "/api/destinations", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify(form),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر حفظ الوجهة."));
      return;
    }
    setOpen(false);
    setMessage(editing ? "تم تحديث الوجهة." : "أُضيفت الوجهة ويمكن ربط الرحلات بها.");
    await load();
  }

  if (forbidden) return <ErrorState title="الوجهات" description={forbidden} />;

  return (
    <section className="grid gap-4">
      <header className="fv-page-head">
        <div>
          <h1>الوجهات</h1>
          <p>الوجهة مكان ثابت على الخريطة. الرحلة تختار وجهة واحدة، ولا تُكتب الوجهة كنص حر داخل الحجز.</p>
        </div>
        <Button variant="teal" onClick={openCreate}>
          وجهة جديدة
        </Button>
      </header>
      {error && !open ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="m-0 text-sm text-success">{message}</p> : null}
      <div className="fv-table-wrap">
        <table className="fv-table">
          <thead>
            <tr>
              <th scope="col">الوجهة</th>
              <th scope="col">الموقع</th>
              <th scope="col">ملاحظة السائق</th>
              <th scope="col">الحالة</th>
              <th scope="col">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5}>لا توجد وجهات بعد.</td>
              </tr>
            ) : (
              items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <strong>{item.name}</strong>
                    {item.addressNote ? <div className="text-sm text-muted">{item.addressNote}</div> : null}
                  </td>
                  <td>
                    {item.latitude}, {item.longitude}
                  </td>
                  <td>{item.notes ?? "—"}</td>
                  <td>{item.isActive ? "نشطة" : "متوقفة"}</td>
                  <td>
                    <Button variant="secondary" onClick={() => openEdit(item)}>
                      تعديل
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Dialog
        open={open}
        title={editing ? "تعديل الوجهة" : "وجهة جديدة"}
        description="الموقع يُحدد من الخريطة ليظهر لاحقًا في مسار السائق."
        onClose={() => setOpen(false)}
      >
        <form className="fv-dialog-layout" onSubmit={(event) => void save(event)}>
          <div className="fv-dialog-scroll grid gap-4">
            {error ? (
              <p className="m-0 text-sm text-danger" role="alert">
                {error}
              </p>
            ) : null}
            <TextField label="اسم الوجهة" name="destinationName" required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            {open ? (
              <MapPicker
                latitude={form.latitude}
                longitude={form.longitude}
                markerTone="destination"
                onChange={(latitude, longitude) => setForm({ ...form, latitude, longitude })}
              />
            ) : null}
            <TextField label="وصف المعلم" name="addressNote" hint="اختياري، مثل بوابة أو مبنى." value={form.addressNote} onChange={(event) => setForm({ ...form, addressNote: event.target.value })} />
            <TextField label="ملاحظة للسائق" name="destinationNotes" hint="اختياري، مثل موقف التحميل." value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            <label className="fv-field">
              <span className="fv-label">الحالة</span>
              <select className="fv-input" value={form.isActive ? "active" : "inactive"} onChange={(event) => setForm({ ...form, isActive: event.target.value === "active" })}>
                <option value="active">نشطة</option>
                <option value="inactive">متوقفة</option>
              </select>
            </label>
          </div>
          <div className="fv-dialog-footer">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button type="submit">حفظ الوجهة</Button>
          </div>
        </form>
      </Dialog>
    </section>
  );
}
