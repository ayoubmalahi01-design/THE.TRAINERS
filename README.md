# THE TRAINERS — تدريب

تطبيق مؤسسي متعدد المؤسسات لإدارة التلاميذ والحضور والحصص والتقارير والتعاميم والمحادثات والملفات الإدارية. يعمل كـPWA على الهاتف والحاسوب، ويدعم العربية RTL والفرنسية والإنجليزية.

> **مصدر الحقيقة لحالة الإصدار:** `docs/RELEASE_STATUS_2026-11-19.md`. لا تعتمد على تقارير التنفيذ القديمة الموجودة في الأرشيف.

## التقنيات والبنية

- React + TypeScript + Vite.
- Supabase Auth + PostgreSQL + RLS + Realtime + Storage + Edge Functions.
- Cloudflare Workers Static Assets / Pages.
- مشروع Supabase الحالي: `rxkyryaplszuklagvidi` (`https://rxkyryaplszuklagvidi.supabase.co`).
- كل مؤسسة تعمل داخل نفس المنصة مع عزل البيانات حسب `institution_id`.

## الأدوار والصلاحيات الأساسية

- **Platform Owner:** ينشئ المؤسسات ويدير حسابات المنصة؛ لا يطّلع على تقارير المدربين، ولا على سجلات التدقيق التشغيلية للمؤسسات. يرى أحداث المؤسسات على مستوى المنصة فقط.
- **Manager:** يدير مؤسسته وفريقها، ويراجع التقارير النهائية، وله صلاحية حذف التقارير النهائية وفق قواعد المشروع.
- **Admin:** يدير التلاميذ والملفات الطبية والتعاميم والتقارير داخل مؤسسته. يستطيع حذف التقارير التي تمت مراجعتها فقط.
- **Coach:** يسجل الحضور والحصص ويكتب تقاريره وكراسته الخاصة. لا يقرأ تقارير المدربين الآخرين ولا الملفات الطبية، ولا يحذف إلا مسودته غير المرسلة.

مصفوفة الدعوات: Owner يدعو Manager/Admin/Coach؛ Manager يدعو Admin/Coach داخل مؤسسته؛ Admin يدعو Coach داخل مؤسسته؛ Coach لا يدعو أحدًا. الدعوات الحالية بالبريد الإلكتروني فقط، والحساب الجديد يبقى Pending حتى المراجعة الإدارية.

## الإعداد المحلي

يتطلب Node.js 20 أو أحدث.

```bash
npm ci
cp .env.example .env.local
npm run verify
npm test
npm run build
npm run dev
```

يحتوي `.env.example` على رابط Supabase والمفتاح العام Publishable Key الخاص بالمشروع الحالي. هذا المفتاح مخصص للمتصفح ومحمي بسياسات RLS؛ **لا تضع مطلقًا `service_role` أو كلمة مرور قاعدة البيانات في أي متغير `VITE_*`.**

## Supabase: مهم قبل أي SQL

- قاعدة الإنتاج الحالية هي `rxkyryaplszuklagvidi`، وليست مشروعًا جديدًا.
- سجل `supabase/migrations` يحتوي على نسخ SQL مطابقة لإصدارات الترحيلات المسجلة في Supabase. لا تعِد تنفيذ ترحيل موجود في السجل.
- ملفات `supabase/manual-applied/legacy` توثّق SQL قديمًا نُفّذ يدويًا أو لم يكن ضمن سجل الترحيلات؛ لا تشغّلها على الإنتاج.
- `supabase/THE_TRAINERS_SETUP.sql` هو Baseline لمشروع Supabase جديد وفارغ فقط. **ممنوع تشغيله على قاعدة الإنتاج الحالية** لأنه يعيد تعريف الجداول والسياسات.
- `supabase/INVITATIONS_OTP_INCREMENTAL.sql` مخصص لتجهيز مخطط الدعوات/OTP عند إنشاء مشروع جديد بعد الـBaseline. واجهة التطبيق الحالية تستخدم دعوات البريد فقط؛ قنوات SMS/WhatsApp غير مفعّلة في الواجهة.
- `supabase/pending/` يحتوي ملفات مراجعة لم تُطبّق؛ لا تشغّلها تلقائيًا.

## نشر الواجهة على Cloudflare

إعدادات البناء:

- Build command: `npm run build`
- Output directory: `dist`
- ملف `wrangler.toml` يضبط اسم Worker على `the-trainers` وملفات Static Assets.
- أضف إلى Cloudflare Production وPreview:
  - `VITE_SUPABASE_URL=https://rxkyryaplszuklagvidi.supabase.co`
  - `VITE_SUPABASE_PUBLISHABLE_KEY` بالقيمة الموجودة في `.env.example` أو من Supabase API settings.

لا تضع `SUPABASE_SERVICE_ROLE_KEY` في Cloudflare أو GitHub أو ملفات الواجهة.

## نشر دعوات البريد (Edge Function)

مصدر `supabase/functions/invite-user` هو النسخة المعتمدة في المشروع، لكن النسخة المنشورة حاليًا على Supabase أقدم من المصدر. قبل نشرها يجب ضبط Secrets في Supabase:

- `SUPABASE_SERVICE_ROLE_KEY`
- `APP_URL` = عنوان HTTPS النهائي للتطبيق على Cloudflare
- `ALLOWED_ORIGINS` = نفس أصل الموقع، ويمكن إضافة أصول Preview المسموح بها بفواصل

ثم:

```bash
npx supabase login
npx supabase link --project-ref rxkyryaplszuklagvidi
npx supabase functions deploy invite-user
```

لا ترسل مفاتيح الأسرار إلى المحادثة. لا تنشر الدالة قبل معرفة عنوان Cloudflare النهائي وضبط Secrets. الدالة ترفض العمل إذا لم يكن `APP_URL` مضبوطًا، ولا تستخدم localhost كتحويل إنتاجي.

## الإشعارات

الإشعارات داخل التطبيق وتحديثات Realtime وإشعارات المتصفح أثناء بقاء التطبيق مفتوحًا أو في الخلفية مدعومة. خدمة Web Push التي توصل الإشعار بعد إغلاق التطبيق غير مفعّلة في هذا الإصدار؛ لا توجد VAPID sender function منشورة.

## ما الذي يجب اختباره قبل الإطلاق العام؟

1. `npm ci` ثم `npm run build` و`npm run typecheck` على بيئة فيها اتصال npm.
2. نشر `invite-user` بعد إعداد Secrets واختبار إرسال وقبول دعوة بريد حقيقية.
3. اختبار RLS بحساب Owner وManager وAdmin وCoach، مع مؤسستين مختلفتين، خصوصًا التقارير والملفات الطبية والكراسات والمحادثات.
4. اختبار PWA وتسجيل الحضور والتقارير ورفع الملفات على Android وiPhone والحاسوب.
5. اختبار Realtime وإيصالات قراءة الرسائل وقوائم قارئي التعاميم وغير القارئين بحسابات حقيقية.

انظر `docs/RELEASE_STATUS_2026-11-19.md` للتفاصيل الدقيقة لما تم التحقق منه وما لم يتم.
