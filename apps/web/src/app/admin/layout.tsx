import { AdminShell } from "../../components/admin-shell";
import { BreakdownNotice } from "../../components/breakdown-notice";
import { RequireSession } from "../../components/require-session";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireSession>
      <AdminShell>
        <BreakdownNotice />
        {children}
      </AdminShell>
    </RequireSession>
  );
}
