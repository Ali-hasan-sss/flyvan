"use client";

import { EmptyState } from "@flyvan/ui";

type ModulePageProps = {
  title: string;
  description: string;
  columns: string[];
};

export function ModulePage({ title, description, columns }: ModulePageProps) {
  return (
    <section className="grid gap-4">
      <header className="fv-page-head">
        <div>
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
      </header>
      <EmptyState
        title="لا توجد سجلات مرتبطة بعد"
        description="هذه الشاشة لا تعرض أرقامًا تشغيلية لأن الوحدة لم تُربط باستعلام في الخادم."
      />
      <article className="fv-card grid gap-2 p-4">
        <h2 className="m-0 text-base">الحقول المخططة</h2>
        <ul className="m-0 flex flex-wrap gap-2 p-0">
          {columns.map((column) => (
            <li key={column} className="rounded-full border border-line bg-page px-3 py-1 text-sm text-muted">
              {column}
            </li>
          ))}
        </ul>
      </article>
    </section>
  );
}
