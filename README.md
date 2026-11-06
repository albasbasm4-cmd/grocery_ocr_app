# تطبيق إدارة مخزون ونقاط بيع البقالة (Grocery POS & Inventory Mobile App)

تطبيق ويب مخصص للهواتف المحمولة يُحزَّم كتطبيق Android (APK) عبر Capacitor، بواجهة عربية بالكامل (RTL). صُمم خصيصاً لأصحاب وموظفي محلات البقالة والمتاجر لتسريع عمليات البيع، وإدارة المخزون بدقة، ومسح الباركود بالكاميرا أو إدخال الرمز يدوياً.

---

## 📱 مميزات التطبيق الأساسية (خارطة الطريق)
- **قراءة الباركود السريعة**: عبر الكاميرا باستخدام Capacitor ML Kit Barcode Scanning على أجهزة أندرويد، ومكتبة ZXing كحل احتياطي لبيئة الويب.
- **إدخال SKU يدوي**: شاشة سريعة للإدخال اليدوي للأرقام الصغيرة تحت الباركود.
- **إدارة التصنيفات والمنتجات**: بحث حي وترتيب أبجدي عربي، تطبيع عربي ذكي (`normalize_arabic`)، وتعطيل المنتجات دون حذفها للحفاظ على سجل الفواتير.
- **سلة بيع آمنة (POS)**: عمليات بيع فورية تخصم من المخزون بأمان عبر معاملات ذرية (Database RPC Transactions) تدعم خاصية منع التكرار (Idempotency).
- **أمان وصلاحيات متعددة المتاجر**: عزل تام بين المتاجر عبر `store_id` وسياسات Row Level Security (RLS)، مع نظام أدوار (مالك / موظف) وحماية بالـ Admin PIN.
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
│   ├── migrations/           # مخططات وتحديثات قاعدة البيانات SQL المرتبة
│   │   ├── 20261107000001_core_schema.sql
│   │   ├── 20261107000002_security_rls.sql
│   │   ├── 20261107000003_rpc_functions.sql
│   │   └── 20261107000004_reports_and_views.sql
│   ├── tests/                # سيناريوهات اختبارات قاعدة البيانات المؤتمتة
│   │   └── database_test.sql
│   └── config.toml           # إعدادات بيئة Supabase المحلية
├── .env.example              # نموذج متغيرات البيئة الآمنة
├── package.json              # الاعتماديات وأوامر التشغيل
├── tailwind.config.js        # إعدادات Tailwind والخطوط
├── tsconfig.json             # إعدادات TypeScript الصارمة
└── vite.config.ts            # إعدادات Vite
```

---

## 🗄️ تفاصيل قاعدة البيانات (المرحلة 1)

### 1. الجداول الأساسية
1. **`stores`**: معرّف المتجر، الاسم، رمز العملة واسمها.
2. **`store_members`**: العزل والأدوار (`owner` و `staff`) مع مفتاح مركب `(store_id, user_id)`.
3. **`admin_pins`**: تجزئة رمز PIN للمدير بـ bcrypt ومتابعة المحاولات الخاطئة والقفل المؤقت (15 دقيقة).
4. **`admin_sessions`**: جلسات التحقق من الـ PIN بصلاحية 10 دقائق لتنفيذ العمليات الإدارية الحساسة.
5. **`categories`**: التصنيفات مع قيد فريد على `(store_id, name_normalized)`.
6. **`products`**: المنتجات مع أسعار `numeric(14,2)` وكمية مخزون `numeric(14,3)`، وقيد فريد للباركود لكل متجر، مع الحذف المنطقي (`is_active = false`).
7. **`customers`**: سجل العملاء ورصيد الديون المستحقة (`balance`).
8. **`sales`**: الفواتير، طرق الدفع (`cash` أو `credit`)، ومعرّف العميل، وحقل `client_uuid` لمنع التكرار (Idempotency).
9. **`sale_items`**: عناصر الفاتورة مع لقطات تاريخية للأسعار والتكلفة (`product_name_snapshot`, `unit_price_snapshot`, `cost_price_snapshot`).
10. **`stock_movements`**: سجل حركات المخزون للتدقيق لجميع الحالات (`sale`, `return`, `purchase`, `adjustment`, `damage`, `void`).
11. **`customer_payments`**: تسديدات ديون العملاء وخصمها من الرصيد.

### 2. التطبيع العربي والبحث السريع
- **`normalize_arabic(text)`**: دالة مدمجة تزيل التشكيل، التطويل، وتوحد الألف والتاء المربوطة والألف المقصورة، وتحول الأرقام الهندية للاتينية، مع اختزال المسافات.
- تريجرات تلقائية عند الإضافة أو التعديل لملء `name_normalized`.
- فهارس ثلاثية الأحرف **`pg_trgm`** (GIN) للبحث الحي الفوري.

### 3. سياسات الأمان (Row Level Security - RLS)
- RLS مفعل على كل الجداول.
- القراءة محصورة في أعضاء المتجر الحالي فقط (`is_store_member`).
- التعديل الإداري للمالك فقط، ويشترط جلسة PIN فعالة (`has_active_admin_session`) لتعديل الأسعار والتعطيل وتعديل المخزون.
- المبيعات وحركات المخزون محظورة من أي إدراج أو تعديل مباشر من العميل وتتم حصراً عبر دوال الـ RPC.

### 4. دوال RPC الذرية (Atomic Database Transactions)
- `create_store(name, currency_code, currency_symbol)`: إنشاء متجر وتعيين المنشئ كمالك.
- `set_admin_pin(store_id, new_pin, old_pin)`: تعيين أو تحديث الـ PIN للمالك.
- `verify_admin_pin(store_id, pin)`: التحقق بـ bcrypt، وقفل 15 دقيقة بعد 5 أخطاء، وإصدار جلسة صالحة لـ 10 دقائق.
- `process_sale(...)`: قفل الصفوف (`FOR UPDATE`)، التحقق من المخزون، خصمه، إنشاء الفاتورة وعناصرها، وحركات المخزون، وتحديث رصيد العميل الآجل، ودعم الـ Idempotency.
- `void_sale(sale_id, reason)`: إلغاء الفاتورة بالكامل وإعادة المخزون ورصيد العميل.
- `return_items(sale_id, items, reason)`: إرجاع جزئي/كلي مع التحقق من عدم تجاوز الكمية المباعة.
- `adjust_stock(product_id, new_quantity, reason)`: تسوية يدوية مع تسجيل الحركة.
- `record_customer_payment(customer_id, amount)`: تسجيل سداد وتخفيض الدين.
- `bulk_upsert_products(store_id, rows, mode)`: استيراد وتحديث جماعي مع تقرير بالصفوف المقبولة والمرفوضة وسبب كل رفض.

### 5. التقارير الإحصائية (Views & Analytics)
- `view_low_stock`: المنتجات التي وصلت للحد الأدنى أو أقل.
- `view_expiring_soon`: المنتجات التي تنتهي صلاحيتها خلال 30 يوماً.
- `get_daily_sales(store_id, days)`: إجمالي المبيعات اليومية ونسب الكاش والآجل.
- `get_top_products(store_id, limit)`: أكثر المنتجات مبيعاً من حيث الكمية والإيراد.
- `get_profit_summary(store_id, from_date, to_date)`: ملخص الأرباح وهوامش الربح استناداً إلى لقطات التكلفة التاريخية.

### 6. تشغيل الاختبارات البرمجية لقاعدة البيانات
يمكنك تشغيل ملف الاختبارات داخل محرّر SQL في لوحة تحكم Supabase أو عبر Supabase CLI:
```bash
supabase db test
# أو تنفيذ الملف المباشر:
# supabase/tests/database_test.sql
```

---

## 🚀 تشغيل المشروع محلياً

### المتطلبات:
- Node.js (الإصدار 18 أو أحدث)
- npm أو pnpm أو yarn
- Supabase CLI (اختياري للتشغيل المحلي لقاعدة البيانات)

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
- [x] **المرحلة 1: قاعدة البيانات فقط (Phase 1)**
  - المخطط الشامل للجداول مع القيود والفهارس.
  - التطبيع العربي والتريجرات وفهارس `pg_trgm`.
  - سياسات RLS الكاملة والدوال المساعدة (`is_store_member`, `is_store_owner`, `has_active_admin_session`).
  - دوال RPC الذرية لعمليات البيع، الإرجاع، الإلغاء، تسوية المخزون، وإدارة الـ PIN.
  - عروض وتقارير المنتجات منخفضة المخزون، منتهية الصلاحية، والمبيعات والأرباح.
  - حزمة الاختبارات المؤتمتة `supabase/tests/database_test.sql`.
- [ ] **المرحلة 2**: (قيد الانتظار حسب أوامر المرحلة التالية)
