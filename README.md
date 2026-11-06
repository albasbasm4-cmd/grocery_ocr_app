# تطبيق إدارة مخزون ونقاط بيع البقالة (Grocery POS & Inventory Mobile App)

تطبيق ويب مخصص للهواتف المحمولة يُحزَّم كتطبيق Android (APK) عبر Capacitor، بواجهة عربية بالكامل (RTL). صُمم خصيصاً لأصحاب وموظفي محلات البقالة والمتاجر لتسريع عمليات البيع، وإدارة المخزون بدقة، ومسح الباركود بالكاميرا أو إدخال الرمز يدوياً.

---

## 📱 مميزات التطبيق الأساسية (خارطة الطريق)
- **قراءة الباركود السريعة**: عبر الكاميرا باستخدام Capacitor ML Kit Barcode Scanning على أجهزة أندرويد، ومكتبة ZXing كحل احتياطي لبيئة الويب.
- **إدخال SKU يدوي**: شاشة سريعة للإدخال اليدوي للأرقام الصغيرة تحت الباركود.
- **إدارة التصنيفات والمنتجات**: بحث حي، وترتيب أبجدي عربي، وتعطيل المنتجات دون حذفها للحفاظ على سجل الفواتير.
- **سلة بيع آمنة (POS)**: عمليات بيع فورية تخصم من المخزون بأمان عبر معاملات ذرية (Database RPC Transactions).
- **أمان وصلاحيات متعددة المتاجر**: عزل تام بين المتاجر عبر `store_id` وسياسات Row Level Security (RLS)، مع نظام أدوار (مالك / موظف).
- **مساعد ذكاء اصطناعي (AI Assistant)**: للإجابة عن أسئلة المخزون والمبيعات عبر Supabase Edge Functions.
- **تصدير كود Java**: تصدير بيانات المنتجات إلى كود Java لدمجها مع الأنظمة الأخرى.

---

## 🛠️ المكدس التقني (Tech Stack)
- **الواجهة الأمامية**: React 18 + Vite + TypeScript + Tailwind CSS
- **إدارة الحسابات والبيانات**: Supabase (PostgreSQL + RLS + RPC + Auth)
- **المنطق الخلفي**: Supabase Edge Functions (Deno / TypeScript)
- **الحسابات المالية**: `decimal.js` (تجنب أخطاء float في JavaScript)
- **مسح الباركود**: Capacitor ML Kit Barcode Scanning + ZXing Fallback
- **التحزيم المحمول**: Capacitor + GitHub Actions CI/CD لبناء حزم APK

---

## 📂 بنية المجلدات
```text
.
├── docs/
│   └── ARCHITECTURE.md       # وثيقة القرارات المعمارية الصارمة
├── src/
│   ├── components/           # المكونات القابلة لإعادة الاستخدام
│   ├── pages/                # شاشات التطبيق الرئيسية
│   ├── hooks/                # الخطافات المخصصة (Custom Hooks)
│   ├── lib/                  # إعدادات المكتبات (Supabase Client, etc.)
│   ├── services/             # خدمات البيانات واستدعاء دوال RPC
│   ├── types/                # تعريفات TypeScript الصارمة
│   ├── i18n/                 # نصوص الواجهة المترجمة مركزياً
│   ├── App.tsx               # المكون الجذري للتطبيق
│   ├── index.css             # إعدادات Tailwind ودعم RTL
│   └── main.tsx              # نقطة الدخول
├── supabase/
│   ├── functions/            # دوال Edge Functions (الذكاء الاصطناعي وغيرها)
│   ├── migrations/           # مخططات وتحديثات قاعدة البيانات SQL
│   └── config.toml           # إعدادات بيئة Supabase المحلية
├── .env.example              # نموذج متغيرات البيئة الآمنة
├── package.json              # الاعتماديات وأوامر التشغيل
├── tailwind.config.js        # إعدادات Tailwind والخطوط
├── tsconfig.json             # إعدادات TypeScript الصارمة
└── vite.config.ts            # إعدادات Vite
```

---

## 🚀 تشغيل المشروع محلياً

### المتطلبات:
- Node.js (الإصدار 18 أو أحدث)
- npm أو pnpm أو yarn

### خطوات التثبيت والتشغيل:
1. استنسخ المستودع:
   ```bash
   git clone https://github.com/albasbasm4-cmd/grocery_ocr_app.git
   cd grocery_ocr_app
   ```
2. ثبّت الحزم:
   ```bash
   npm install
   ```
3. أنشئ ملف البيئة:
   ```bash
   cp .env.example .env.local
   ```
4. شغّل خادم التطوير:
   ```bash
   npm run dev
   ```

---

## 📌 سجل المراحل (Milestones)
- [x] **المرحلة 0: الهيكل التأسيسي (Phase 0)**
  - تأسيس بيئة Vite + React + TypeScript + Tailwind CSS.
  - إعداد الخط العربي (Cairo) والاتجاه RTL والتصميم المناسب للهواتف.
  - وثيقة القرارات المعمارية `docs/ARCHITECTURE.md`.
  - تجهيز نموذج البيئة `.env.example`.
  - إعداد مجلدات `supabase/` للـ migrations والـ functions.
- [ ] **المرحلة 1**: (قيد الانتظار حسب أوامر المرحلة التالية)
