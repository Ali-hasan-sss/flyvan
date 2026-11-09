import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="grid max-w-md gap-3 text-center">
        <h1 className="m-0 text-2xl">الصفحة غير موجودة</h1>
        <p className="m-0 text-muted">هذا المسار ليس جزءًا من فلاي فان.</p>
        <Link className="fv-button fv-button-primary no-underline" href="/">
          الصفحة الرئيسية
        </Link>
      </div>
    </main>
  );
}
