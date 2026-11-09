"use client";

import { useEffect, useState } from "react";
import { Button, Card, ErrorState, TextField } from "@flyvan/ui";
import { apiRequest, readError } from "../lib/api";

type AreaItem = {
  id: string;
  name: string;
  kind: string;
  isActive: boolean;
  approvedDriverCount: number;
};

type AreaLink = {
  id: string;
  driverName: string;
  areaName: string;
  preference: string;
  status: string;
};

const kindLabels: Record<string, string> = {
  CITY: "مدينة",
  DISTRICT: "حي",
  GEOFENCE: "نطاق",
};

const preferenceLabels: Record<string, string> = {
  TARGET: "مستهدفة",
  EXCLUDED: "مستبعدة",
};

export function AreasAdmin() {
  const [areas, setAreas] = useState<AreaItem[]>([]);
  const [links, setLinks] = useState<AreaLink[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ name: "", kind: "CITY" });

  async function load(): Promise<void> {
    const response = await apiRequest("/api/service-areas");
    if (response.status === 403) {
      setError("إدارة المناطق متاحة لمالك المنصة ومدير العمليات.");
      return;
    }
    if (!response.ok) {
      setError(await readError(response, "تعذر تحميل المناطق."));
      return;
    }
    const body = (await response.json()) as { items: AreaItem[]; links: AreaLink[] };
    setAreas(body.items);
    setLinks(body.links);
    setError("");
  }

  useEffect(() => {
    void load();
  }, []);

  async function createArea(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const response = await apiRequest("/api/service-areas", { method: "POST", body: JSON.stringify(form) });
    if (!response.ok) {
      setError(await readError(response, "تعذر إنشاء المنطقة."));
      return;
    }
    setForm({ name: "", kind: "CITY" });
    setMessage("أُنشئت المنطقة. موافقة السائق عليها لا تعني قبول كل رحلة داخلها.");
    await load();
  }

  async function review(id: string, status: "APPROVED" | "REJECTED"): Promise<void> {
    const response = await apiRequest(`/api/driver-service-areas/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ status }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر مراجعة الربط."));
      return;
    }
    setMessage(status === "APPROVED" ? "اعتُمد الربط. لم تُسند أي رحلة." : "رُفض الربط.");
    await load();
  }

  async function toggle(area: AreaItem): Promise<void> {
    const response = await apiRequest(`/api/service-areas/${area.id}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: !area.isActive }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تحديث المنطقة."));
      return;
    }
    await load();
  }

  if (error && areas.length === 0) {
    return <ErrorState title="مناطق الخدمة" description={error} />;
  }

  return (
    <section className="grid gap-4">
      <header className="fv-page-head">
        <div>
          <h1>مناطق الخدمة</h1>
          <p>
            المنطقة المعتمدة تسمح بمعاينة عرض الطلب حتى لو كان السائق بعيدًا. فحص احتواء المضلع الجغرافي غير
            مفعّل، والربط اليدوي هو أساس المطابقة حاليًا.
          </p>
        </div>
      </header>
      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p className="m-0 text-sm text-success">{message}</p> : null}
      <Card className="grid gap-4 p-4">
        <h2 className="m-0 text-lg">منطقة جديدة</h2>
        <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => void createArea(event)}>
          <TextField
            label="الاسم"
            name="areaName"
            required
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
          />
          <label className="fv-field">
            <span className="fv-label">النوع</span>
            <select
              className="fv-input"
              value={form.kind}
              onChange={(event) => setForm({ ...form, kind: event.target.value })}
            >
              <option value="CITY">مدينة</option>
              <option value="DISTRICT">حي</option>
              <option value="GEOFENCE">نطاق</option>
            </select>
          </label>
          <div className="flex items-end">
            <Button type="submit">إنشاء المنطقة</Button>
          </div>
        </form>
      </Card>
      <div className="fv-table-wrap">
        <table className="fv-table">
          <thead>
            <tr>
              <th scope="col">المنطقة</th>
              <th scope="col">النوع</th>
              <th scope="col">الحالة</th>
              <th scope="col">سائقون معتمدون</th>
              <th scope="col">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <tr key={area.id}>
                <td>{area.name}</td>
                <td>{kindLabels[area.kind] ?? area.kind}</td>
                <td>{area.isActive ? "نشطة" : "متوقفة"}</td>
                <td>{area.approvedDriverCount}</td>
                <td>
                  <Button variant="secondary" onClick={() => void toggle(area)}>
                    {area.isActive ? "إيقاف" : "تفعيل"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Card className="grid gap-3 p-4">
        <h2 className="m-0 text-lg">طلبات الربط المعلقة</h2>
        {links.length === 0 ? <p className="m-0">لا توجد طلبات معلّقة.</p> : null}
        <ul className="m-0 grid gap-2 p-0">
          {links.map((link) => (
            <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {link.driverName} — {link.areaName} — {preferenceLabels[link.preference] ?? link.preference}
              </span>
              <span className="flex gap-2">
                <Button variant="secondary" onClick={() => void review(link.id, "APPROVED")}>
                  اعتماد
                </Button>
                <Button variant="ghost" onClick={() => void review(link.id, "REJECTED")}>
                  رفض
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
