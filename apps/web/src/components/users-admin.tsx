"use client";

import { useEffect, useState } from "react";
import { Button, Card, ErrorState, TextField } from "@flyvan/ui";
import { apiRequest, readError } from "../lib/api";
import { roleLabels, roleOptions } from "../lib/roles";
import { readSession, type SessionUser } from "../lib/session";

type ListedUser = SessionUser & { createdAt: string };

export function UsersAdmin() {
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    phone: "",
    role: "DISPATCHER",
    password: "",
  });
  const actorId = readSession()?.user.id;

  async function load(): Promise<void> {
    const response = await apiRequest("/api/users");
    if (response.status === 403) {
      setError("إدارة المستخدمين متاحة لمالك المنصة فقط.");
      return;
    }
    if (!response.ok) {
      setError(await readError(response, "تعذر تحميل المستخدمين."));
      return;
    }
    const body = (await response.json()) as { items: ListedUser[] };
    setUsers(body.items);
    setError("");
  }

  useEffect(() => {
    void load();
  }, []);

  async function createUser(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setMessage("");
    const response = await apiRequest("/api/users", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setPending(false);
    if (!response.ok) {
      setError(await readError(response, "تعذر إنشاء المستخدم."));
      return;
    }
    setForm({ displayName: "", email: "", phone: "", role: "DISPATCHER", password: "" });
    setMessage("تم إنشاء المستخدم.");
    await load();
  }

  async function disableUser(user: ListedUser): Promise<void> {
    const reason = window.prompt("سبب التعطيل");
    if (!reason || reason.trim().length < 3) {
      return;
    }
    const response = await apiRequest(`/api/users/${user.id}/disable`, {
      method: "POST",
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (!response.ok) {
      setError(await readError(response, "تعذر تعطيل المستخدم."));
      return;
    }
    setMessage("تم تعطيل المستخدم وإبطال جلساته.");
    await load();
  }

  if (error && users.length === 0) {
    return <ErrorState title="المستخدمون" description={error} />;
  }

  return (
    <section className="grid gap-4">
      <header className="fv-page-head">
        <div>
        <h1>المستخدمون</h1>
        <p>
          إنشاء الحسابات وتعطيلها لمالك المنصة. رقم الهاتف مطلوب وفريد، والبريد اختياري. الدخول يتم بالهاتف أو بالبريد. تعطيل الحساب يبطل جلساته فورًا.
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
        <h2 className="m-0 text-lg">حساب جديد</h2>
        <form className="grid gap-4 md:grid-cols-2" onSubmit={(event) => void createUser(event)}>
          <TextField
            label="الاسم"
            name="displayName"
            value={form.displayName}
            onChange={(event) => setForm({ ...form, displayName: event.target.value })}
            required
          />
          <label className="fv-field">
            <span className="fv-label">الدور</span>
            <select
              className="fv-input"
              name="role"
              value={form.role}
              onChange={(event) => setForm({ ...form, role: event.target.value })}
            >
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label="الهاتف"
            name="phone"
            required
            hint="مطلوب وفريد. يمكن تسجيل الدخول به."
            value={form.phone}
            onChange={(event) => setForm({ ...form, phone: event.target.value })}
          />
          <TextField
            label="البريد"
            name="email"
            type="email"
            hint="اختياري. إن أُدخل يمكن تسجيل الدخول به أيضًا."
            value={form.email}
            onChange={(event) => setForm({ ...form, email: event.target.value })}
          />
          <TextField
            label="كلمة المرور"
            name="password"
            type="password"
            hint="8 أحرف على الأقل، ولا تُحفظ في المتصفح."
            value={form.password}
            onChange={(event) => setForm({ ...form, password: event.target.value })}
            required
          />
          <div className="flex items-end">
            <Button type="submit" disabled={pending}>
              {pending ? "جارٍ الحفظ" : "إنشاء الحساب"}
            </Button>
          </div>
        </form>
      </Card>
      <div className="fv-table-wrap">
        <table className="fv-table">
          <thead>
            <tr>
              <th scope="col">الاسم</th>
              <th scope="col">الدور</th>
              <th scope="col">الهاتف</th>
              <th scope="col">البريد</th>
              <th scope="col">الحالة</th>
              <th scope="col">إجراء</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.displayName}</td>
                <td>{roleLabels[user.role] ?? user.role}</td>
                <td>{user.phone ?? "—"}</td>
                <td>{user.email ?? "—"}</td>
                <td>{user.status === "ACTIVE" ? "نشط" : "معطّل"}</td>
                <td>
                  {user.status === "ACTIVE" && user.id !== actorId ? (
                    <Button variant="danger" onClick={() => void disableUser(user)}>
                      تعطيل
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
