import { ModulePage } from "../../../components/module-page";

export default function AuditPage() {
  return (
    <ModulePage
      title="سجل التدقيق"
      description="التغييرات الحساسة على الأجرة ونسبة العمولة وحد الائتمان وحالة الرحلة والدفعات ستُكتب في سجل غير قابل للتعديل. السجل فارغ لأن هذه العمليات لم تُنفَّذ بعد."
      columns={["الوقت", "المستخدم", "الإجراء", "الكيان", "السبب"]}
    />
  );
}
