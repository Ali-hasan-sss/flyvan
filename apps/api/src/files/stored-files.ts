import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { FleetError } from "../fleet/fleet.errors";

export type StoredUpload = {
  mimetype: string;
  size: number;
  buffer: Buffer;
};

const imageTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
]);

const documentTypes = new Map([...imageTypes, ["application/pdf", ".pdf"]]);

export const uploadsDirectory = path.resolve(__dirname, "../../uploads");
const maxBytes = 5 * 1024 * 1024;

export async function storeUpload(file: StoredUpload, kind: "image" | "document"): Promise<string> {
  if (file.size > maxBytes) {
    throw new FleetError("FILE_SIZE");
  }
  const extension = (kind === "image" ? imageTypes : documentTypes).get(file.mimetype);
  if (!extension) {
    throw new FleetError(kind === "image" ? "IMAGE_TYPE" : "DOCUMENT_TYPE");
  }
  await mkdir(uploadsDirectory, { recursive: true });
  const name = `${randomUUID()}${extension}`;
  await writeFile(path.join(uploadsDirectory, name), file.buffer);
  return `/api/files/${name}`;
}

export async function removeStoredFile(url: string | null): Promise<void> {
  if (!url?.startsWith("/api/files/")) {
    return;
  }
  const name = path.basename(url);
  await unlink(path.join(uploadsDirectory, name)).catch(() => undefined);
}
