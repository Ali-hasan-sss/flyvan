export const roleLabels: Record<string, string> = {
  PLATFORM_OWNER: "مالك المنصة",
  ADMIN: "مدير العمليات",
  DISPATCHER: "الكونترول",
  FINANCE: "المالية",
  DRIVER: "سائق",
  PASSENGER: "راكب",
};

export const roleOptions = Object.entries(roleLabels).map(([value, label]) => ({ value, label }));
