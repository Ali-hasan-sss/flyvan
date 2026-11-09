"use client";

import { useEffect, useState } from "react";

type FileTileProps = {
  label: string;
  accept: string;
  file: File | null;
  existingUrl?: string | null;
  onChange: (file: File | null) => void;
  onClearExisting?: () => void;
};

export function FileTile({ label, accept, file, existingUrl, onChange, onClearExisting }: FileTileProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const image = file?.type.startsWith("image/") ?? false;

  useEffect(() => {
    if (!file || !image) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, image]);

  const shown = Boolean(file || existingUrl);
  const existingImage = Boolean(existingUrl) && !/\.pdf(?:$|\?)/i.test(existingUrl ?? "");
  return (
    <div className="fv-file-tile">
      <span className="fv-label">{label}</span>
      <div className={shown ? "fv-file-preview has-file" : "fv-file-preview"}>
        {preview ? (
          <img src={preview} alt="" />
        ) : existingImage ? (
          <img src={existingUrl ?? ""} alt="" />
        ) : existingUrl ? (
          <span className="fv-file-name">PDF</span>
        ) : file ? (
          <span className="fv-file-name">{file.name}</span>
        ) : null}
        <span className="fv-file-tools">
          <label className="fv-file-tool">
            <input
              key={file ? `${file.name}-${file.size}` : "empty"}
              className="fv-file-input"
              type="file"
              accept={accept}
              aria-label={`رفع ${label}`}
              onChange={(event) => onChange(event.target.files?.[0] ?? null)}
            />
            <UploadIcon />
          </label>
          {shown ? (
            <button
              type="button"
              className="fv-file-tool is-remove"
              aria-label={`إزالة ${label}`}
              onClick={() => {
                if (file) onChange(null);
                else onClearExisting?.();
              }}
            >
              <RemoveIcon />
            </button>
          ) : null}
        </span>
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg className="fv-table-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M12 16V7M8.5 10.5 12 7l3.5 3.5M5 18h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RemoveIcon() {
  return (
    <svg className="fv-table-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M8 8l8 8M16 8l-8 8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
