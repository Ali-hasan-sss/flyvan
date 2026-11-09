import type { Metadata } from "next";
import { PublicBooking } from "../../components/public-booking";

export const metadata: Metadata = {
  title: "حجز رحلة — فلاي فان",
  description: "أرسل طلب حجز بالاسم والهاتف والرحلة وعدد المقاعد وموقع الالتقاط. الكونترول يثبت الأجرة قبل التأكيد.",
};

export default function BookPage() {
  return <PublicBooking />;
}
