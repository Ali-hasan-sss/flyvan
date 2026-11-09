import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Brand } from "../components/brand";

export const metadata: Metadata = {
  title: "فلاي فان — نقل الركاب إلى الجامعات",
  description:
    "فلاي فان تنسّق نقل الركاب من نقاط الالتقاط إلى الجامعات والوجهات. الحجز عبر الكونترول، والأجرة نقدًا للسائق، وكل اتجاه رحلة مستقل.",
};

const facts = [
  { title: "بلا اشتراك", text: "كل اتجاه رحلة حجز مستقل وأجرة مستقلة." },
  { title: "نقدًا للسائق", text: "استلام الأجرة ليس تسديدًا لعمولة الشركة." },
  { title: "شركة واحدة", text: "السائق يتعاقد مع الشركة مباشرة، بلا مكاتب مستقلة." },
];

const steps = [
  { title: "تسجيل الحجز", text: "الكونترول يدخل اسم الراكب وهاتفه ونقطة الالتقاط والوجهة والموعد والاتجاه." },
  { title: "تثبيت الأجرة", text: "تُحدَّد الأجرة قبل التأكيد وتُحفظ مع الحجز، حتى لو تغيّرت سياسة التسعير لاحقًا." },
  { title: "إسناد الرحلة", text: "سائق معتمد ومركبة معتمدة، من الطلبات القريبة أو مناطق الخدمة أو الإسناد اليدوي." },
  { title: "العمولة بعد التنفيذ", text: "إنشاء الحجز أو إسناده لا ينشئ عمولة. الاستحقاق بعد اعتماد تنفيذ النقل." },
];

const features: { title: string; text: string; icon: ReactNode }[] = [
  {
    title: "الراكب بلا تطبيق",
    text: "يستطيع الكونترول إنشاء الحجز نيابة عن الراكب. الحساب اختياري وليس شرطًا للرحلة.",
    icon: (
      <>
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
  },
  {
    title: "مطابقة بثلاثة مصادر",
    text: "قرب من موقع السائق، أو منطقة خدمة وافق عليها، أو إسناد يدوي مع سبب السماح أو التحذير.",
    icon: (
      <>
        <circle cx="6" cy="7" r="2.2" />
        <circle cx="17" cy="8" r="2.2" />
        <circle cx="12" cy="17" r="2.2" />
        <path d="M8 8.2 15 9" />
        <path d="M7.2 9 10.5 15" />
        <path d="M15.5 10 13.2 15" />
      </>
    ),
  },
  {
    title: "حد لكل سائق",
    text: "مديونية السائق تُفحص قبل إسناد رحلة جديدة. إجمالي مستحقات الشركة لا يوقف بقية السائقين.",
    icon: (
      <>
        <path d="M12 3v18" />
        <path d="M7 8h7a3 3 0 0 1 0 6H9a3 3 0 0 0 0 6h8" />
      </>
    ),
  },
  {
    title: "بيانات بقدر الحاجة",
    text: "عنوان الراكب الكامل لا يُعرض لكل السائقين. التفاصيل الدقيقة للسائق المعيّن وعند الحاجة التشغيلية.",
    icon: (
      <>
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
];

const roles = [
  {
    title: "الراكب",
    text: "يتواصل مع الكونترول، يعرف موعده ووجهته، ويدفع أجرة رحلته نقدًا للسائق بعد التنفيذ.",
  },
  {
    title: "السائق",
    text: "يرى الرحلات المعروضة عليه، ويحدّث حالتها، ويطلع على عمولته وحدّه من دون تعديل القيود المالية.",
  },
  {
    title: "الكونترول",
    text: "ينشئ الحجز، يثبّت الأجرة، يسند الرحلة، ويتابع الصعود والتأخير والرحلات النشطة.",
  },
];

const stops = [
  { title: "نقطة الالتقاط", detail: "اسم الراكب وموقعه" },
  { title: "السائق المعيّن", detail: "بعد المطابقة أو الإسناد" },
  { title: "الجامعة أو الوجهة", detail: "اتجاه واحد، أجرة واحدة" },
];

function Icon({ children }: { children: ReactNode }) {
  return (
    <span className="fv-home-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </span>
  );
}

export default function HomePage() {
  return (
    <div className="fv-home">
      <header className="fv-home-header">
        <div className="fv-home-inner fv-home-bar">
          <Brand />
          <nav aria-label="روابط الصفحة" className="fv-home-nav">
            <a href="#path">كيف تعمل الرحلة</a>
            <a href="#roles">لمن المنصة</a>
            <Link className="fv-button fv-button-secondary no-underline" href="/login">
              تسجيل الدخول
            </Link>
            <Link className="fv-button fv-button-primary no-underline" href="/book">
              احجز رحلة
            </Link>
            <Link className="fv-button fv-button-secondary no-underline" href="/admin">
              لوحة التشغيل
            </Link>
          </nav>
        </div>
      </header>
      <main className="fv-home-inner">
        <section className="fv-hero" aria-labelledby="home-title">
          <div>
            <p className="fv-kicker">نقل جامعي من شركة واحدة</p>
            <h1 id="home-title">من نقطة الالتقاط إلى الجامعة، بمسار واضح وأجرة مثبتة.</h1>
            <p className="fv-hero-copy">
              فلاي فان منصة تشغيل للسائقين المتعاقدين مع الشركة. الراكب يرسل طلب الحجز من الرابط العام دون حساب، والكونترول يثبّت الأجرة قبل التأكيد. الدفع نقدًا للسائق، وكل اتجاه رحلة مستقل.
            </p>
            <div className="fv-hero-actions">
              <Link className="fv-button fv-button-primary no-underline" href="/book">
                احجز رحلة
              </Link>
              <Link className="fv-button fv-button-secondary no-underline" href="/admin">
                دخول لوحة التشغيل
              </Link>
              <Link className="fv-button fv-button-secondary no-underline" href="/login">
                حساب الموظف أو السائق
              </Link>
            </div>
          </div>
          <aside className="fv-route" aria-label="مثال على مسار رحلة">
            <div className="fv-route-top">
              <span>مثال تشغيلي</span>
              <span className="fv-pill">الأجرة تُثبَّت قبل التأكيد</span>
            </div>
            {stops.map((stop, index) => (
              <div key={stop.title} className="fv-stop">
                <i aria-hidden="true">{index + 1}</i>
                <div>
                  <strong>{stop.title}</strong>
                  <span>{stop.detail}</span>
                </div>
              </div>
            ))}
            <p className="fv-route-note">استلام الراكب للأجرة نقدًا حدث تشغيلي. عمولة الشركة تُستحق بعد اعتماد التنفيذ.</p>
          </aside>
        </section>

        <ul className="fv-facts" aria-label="قواعد مختصرة">
          {facts.map((fact) => (
            <li key={fact.title}>
              <strong>{fact.title}</strong>
              <span>{fact.text}</span>
            </li>
          ))}
        </ul>

        <section id="path" className="fv-section" aria-labelledby="path-title">
          <div className="fv-section-head">
            <h2 id="path-title">كيف تعمل الرحلة</h2>
            <p>أربع خطوات ثابتة، من تسجيل الحجز حتى استحقاق العمولة.</p>
          </div>
          <ol className="fv-steps">
            {steps.map((step, index) => (
              <li key={step.title}>
                <span aria-hidden="true">{index + 1}</span>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="fv-section" aria-labelledby="features-title">
          <div className="fv-section-head">
            <h2 id="features-title">ما يميز التشغيل</h2>
            <p>قواعد واضحة للكونترول والسائق والمالية، من دون خلط الأجرة بالعمولة.</p>
          </div>
          <div className="fv-home-grid">
            {features.map((feature) => (
              <article key={feature.title} className="fv-home-card">
                <Icon>{feature.icon}</Icon>
                <h3>{feature.title}</h3>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="roles" className="fv-section" aria-labelledby="roles-title">
          <div className="fv-section-head">
            <h2 id="roles-title">لكل طرف مسار واحد</h2>
            <p>الراكب لا يرى بيانات غيره، والسائق لا يعدّل الأجرة أو حد المديونية.</p>
          </div>
          <div className="fv-roles">
            {roles.map((role) => (
              <article key={role.title}>
                <h3>{role.title}</h3>
                <p>{role.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="fv-close" aria-labelledby="close-title">
          <div>
            <h2 id="close-title">التشغيل اليومي يبدأ من لوحة واحدة.</h2>
            <p>الحجوزات، والإسناد، والسائقون، والمناطق، والمتابعة المالية في مكان واحد للموظفين المخولين.</p>
          </div>
          <Link className="fv-button fv-button-primary no-underline" href="/login">
            تسجيل الدخول
          </Link>
        </section>
      </main>
      <footer className="fv-home-footer">
        <div className="fv-home-inner">
          <Brand />
          <p>فلاي فان. نقل الركاب إلى الجامعات والوجهات المحددة، من الشركة مباشرة.</p>
        </div>
      </footer>
    </div>
  );
}
