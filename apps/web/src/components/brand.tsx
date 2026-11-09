import Link from "next/link";

export function Brand({ href = "/" }: { href?: string }) {
  return (
    <Link href={href} className="fv-brand inline-flex items-center gap-2.5 font-semibold text-ink no-underline">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-primary-strong text-sm text-white">
        FV
      </span>
      <span className="grid leading-tight">
        <span>فلاي فان</span>
        <span className="text-xs font-medium text-muted">Fly Van</span>
      </span>
    </Link>
  );
}
