"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, TextField } from "@flyvan/ui";
import { apiBaseUrl, apiRequest, readError } from "../lib/api";
import { FileTile } from "./file-tile";

export type EditableDriver = {
  id: string;
  displayName: string;
  phone: string | null;
  email: string | null;
  imageUrl: string | null;
};

export function DriverEditDialog({
  driver,
  open,
  onClose,
  onSaved,
}: {
  driver: EditableDriver | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [clearPhoto, setClearPhoto] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!driver || !open) return;
    setName(driver.displayName);
    setPhone(driver.phone ?? "");
    setEmail(driver.email ?? "");
    setPhoto(null);
    setClearPhoto(false);
    setError("");
  }, [driver, open]);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!driver) return;
    setPending(true);
    setError("");
    const body = new FormData();
    body.set("displayName", name);
    body.set("phone", phone);
    body.set("email", email);
    if (clearPhoto) body.set("clearPhoto", "true");
    if (photo) body.set("driverPhoto", photo);
    const response = await apiRequest(`/api/drivers/${driver.id}`, { method: "PATCH", body });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response, "تعذر تعديل السائق."));
      return;
    }
    onSaved();
    onClose();
  }

  const existingUrl = !clearPhoto && driver?.imageUrl ? `${apiBaseUrl()}${driver.imageUrl}` : null;

  return (
    <Dialog open={open} title="تعديل السائق" description={driver?.displayName} onClose={onClose}>
      <form className="fv-dialog-layout" onSubmit={(event) => void save(event)}>
        <div className="fv-dialog-scroll grid gap-4">
          {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
          <TextField label="الاسم" name="editName" required value={name} onChange={(event) => setName(event.target.value)} />
          <TextField label="الهاتف" name="editPhone" required hint="مطلوب وفريد، ويُستخدم لتسجيل الدخول." value={phone} onChange={(event) => setPhone(event.target.value)} />
          <TextField label="البريد" name="editEmail" type="email" hint="اختياري. اتركه فارغًا إن لم يُستخدم للدخول." value={email} onChange={(event) => setEmail(event.target.value)} />
          <FileTile
            label="صورة السائق"
            accept="image/jpeg,image/png,image/webp"
            file={photo}
            existingUrl={existingUrl}
            onChange={(file) => {
              setPhoto(file);
              if (file) setClearPhoto(false);
            }}
            onClearExisting={() => {
              setPhoto(null);
              setClearPhoto(true);
            }}
          />
        </div>
        <div className="fv-dialog-footer">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="teal" disabled={pending}>{pending ? "جارٍ الحفظ" : "حفظ"}</Button>
        </div>
      </form>
    </Dialog>
  );
}

export function DriverPasswordDialog({
  driver,
  open,
  onClose,
  onSaved,
}: {
  driver: { id: string; displayName: string } | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError("");
  }, [open, driver?.id]);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!driver) return;
    setPending(true);
    setError("");
    const response = await apiRequest(`/api/drivers/${driver.id}/password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response, "تعذر تغيير كلمة المرور."));
      return;
    }
    onSaved();
    onClose();
  }

  return (
    <Dialog open={open} title="تغيير كلمة المرور" description={driver?.displayName} onClose={onClose}>
      <form className="fv-dialog-layout" onSubmit={(event) => void save(event)}>
        <div className="fv-dialog-scroll grid gap-4">
          {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
          <TextField
            label="كلمة المرور الجديدة"
            name="newPassword"
            type="password"
            required
            minLength={8}
            hint="8 أحرف على الأقل."
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="fv-dialog-footer">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="teal" disabled={pending}>{pending ? "جارٍ الحفظ" : "حفظ"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
