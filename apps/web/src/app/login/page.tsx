import Link from "next/link";
import { Card } from "@flyvan/ui";
import { Brand } from "../../components/brand";
import { LoginForm } from "../../components/login-form";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-8">
      <Card className="grid w-full max-w-md gap-5 p-6 md:p-8">
        <Brand />
        <div className="grid gap-2">
          <h1 className="m-0 text-2xl">تسجيل الدخول</h1>
          <p className="m-0 text-muted">للموظفين والسائقين. الراكب لا يحتاج حسابًا ليحجز عبر الكونترول.</p>
        </div>
        <LoginForm />
        <Link href="/" className="text-sm font-semibold text-primary-strong no-underline">
          العودة إلى الصفحة الرئيسية
        </Link>
      </Card>
    </main>
  );
}
