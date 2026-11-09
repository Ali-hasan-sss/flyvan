"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, TextField } from "@flyvan/ui";
import { loginRequest } from "../lib/api";

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      await loginRequest(identifier, password);
      router.replace("/admin");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر تسجيل الدخول.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-4" onSubmit={(event) => void submit(event)}>
      <TextField
        label="البريد أو الهاتف"
        name="identifier"
        autoComplete="username"
        value={identifier}
        onChange={(event) => setIdentifier(event.target.value)}
        required
      />
      <TextField
        label="كلمة المرور"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        required
      />
      {error ? (
        <p className="m-0 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="teal" disabled={pending}>
        {pending ? "جارٍ الدخول" : "تسجيل الدخول"}
      </Button>
    </form>
  );
}
