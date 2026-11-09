"use client";

import { useEffect, useState } from "react";
import { Button, Dialog, TextField } from "@flyvan/ui";
import { apiBaseUrl, apiRequest, readError } from "../lib/api";
import { FileTile } from "./file-tile";

export type EditableVehicle = {
  id: string;
  plateNumber: string;
  capacity: number;
  vehicleType: string;
  imageUrl: string | null;
  documentUrl: string | null;
};

export function VehicleEditDialog({
  vehicle,
  open,
  onClose,
  onSaved,
}: {
  vehicle: EditableVehicle | null;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [plate, setPlate] = useState("");
  const [capacity, setCapacity] = useState("4");
  const [vehicleType, setVehicleType] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [clearImage, setClearImage] = useState(false);
  const [clearDocument, setClearDocument] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!vehicle || !open) return;
    setPlate(vehicle.plateNumber);
    setCapacity(String(vehicle.capacity));
    setVehicleType(vehicle.vehicleType);
    setImage(null);
    setDocumentFile(null);
    setClearImage(false);
    setClearDocument(false);
    setError("");
  }, [vehicle, open]);

  async function save(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!vehicle) return;
    if (clearImage && !image) {
      setError("صورة المركبة مطلوبة.");
      return;
    }
    setPending(true);
    setError("");
    const body = new FormData();
    body.set("plateNumber", plate);
    body.set("capacity", capacity);
    body.set("vehicleType", vehicleType);
    if (clearDocument) body.set("clearDocument", "true");
    if (image) body.set("vehicleImage", image);
    if (documentFile) body.set("vehicleDocument", documentFile);
    const response = await apiRequest(`/api/vehicles/${vehicle.id}`, { method: "PATCH", body });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response, "تعذر تعديل المركبة."));
      return;
    }
    onSaved();
    onClose();
  }

  const imageUrl = !clearImage && vehicle?.imageUrl ? `${apiBaseUrl()}${vehicle.imageUrl}` : null;
  const documentUrl = !clearDocument && vehicle?.documentUrl ? `${apiBaseUrl()}${vehicle.documentUrl}` : null;

  return (
    <Dialog open={open} title="تعديل المركبة" description={vehicle?.plateNumber} onClose={onClose}>
      <form className="fv-dialog-layout" onSubmit={(event) => void save(event)}>
        <div className="fv-dialog-scroll grid gap-4">
          {error ? <p className="m-0 text-sm text-danger" role="alert">{error}</p> : null}
          <TextField label="اللوحة" name="editPlate" required value={plate} onChange={(event) => setPlate(event.target.value)} />
          <TextField label="المقاعد" name="editCapacity" type="number" min={1} max={20} required value={capacity} onChange={(event) => setCapacity(event.target.value)} />
          <TextField label="النوع" name="editType" required value={vehicleType} onChange={(event) => setVehicleType(event.target.value)} />
          <div className="fv-file-row">
            <FileTile
              label="صورة المركبة"
              accept="image/jpeg,image/png,image/webp"
              file={image}
              existingUrl={imageUrl}
              onChange={(file) => {
                setImage(file);
                if (file) setClearImage(false);
              }}
              onClearExisting={() => {
                setImage(null);
                setClearImage(true);
              }}
            />
            <FileTile
              label="وثيقة المركبة"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              file={documentFile}
              existingUrl={documentUrl}
              onChange={(file) => {
                setDocumentFile(file);
                if (file) setClearDocument(false);
              }}
              onClearExisting={() => {
                setDocumentFile(null);
                setClearDocument(true);
              }}
            />
          </div>
        </div>
        <div className="fv-dialog-footer">
          <Button type="button" variant="secondary" onClick={onClose}>إلغاء</Button>
          <Button type="submit" variant="teal" disabled={pending}>{pending ? "جارٍ الحفظ" : "حفظ"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
