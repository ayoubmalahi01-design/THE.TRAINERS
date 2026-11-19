# THE TRAINERS — Database Requirements (2026-11-19)

المشروع مرتبط بقاعدة Supabase الحالية `rxkyryaplszuklagvidi`. لا تنشئ قاعدة بديلة ولا تشغّل Baseline على الإنتاج.

## الحالة الحية

- 28 جدولًا في `public`.
- RLS مفعّل على 28/28 جدولًا.
- أربعة Storage Buckets خاصة.
- سجل Supabase يحتوي على 28 Migration؛ مجلد `supabase/migrations` يحتوي على نفس الإصدارات.

## الجداول الحالية (28)

| Table | Purpose |
|---|---|
| `institutions` | المؤسسات وإعداداتها |
| `profiles` | حسابات المستخدمين وأدوارهم وحالاتهم |
| `classes` | الأقسام |
| `students` | التلاميذ |
| `academic_years` | السنوات الدراسية |
| `student_academic_enrollments` | تسجيل التلميذ في السنة الدراسية |
| `student_medical_records` | السجلات الطبية/الإصابات/الإعفاءات (Manager/Admin فقط) |
| `coach_shifts` | حصص/فترات عمل المدربين |
| `attendance_records` | حضور التلاميذ حسب الجلسة |
| `absence_followups` | متابعة الغياب المتتالي والعودة |
| `daily_reports` | التقارير اليومية ومسار المسودة/الإرسال/المراجعة |
| `report_details` | تفاصيل التلاميذ داخل التقرير |
| `report_templates` | قوالب Word حسب المؤسسة |
| `report_exports` | سجل تصدير التقارير |
| `student_notes` | ملاحظات التلاميذ والمتابعة |
| `coach_notebooks` | كراس خاص بكل مدرب |
| `admin_notices` | التعاميم |
| `notice_reads` | من قرأ كل تعميم ومتى |
| `notifications` | إشعارات داخل التطبيق |
| `conversations` | المحادثات الفردية والجماعية |
| `conversation_members` | أعضاء المحادثة وحالة آخر قراءة |
| `messages` | الرسائل ومرفقاتها |
| `message_reads` | إيصال قراءة كل رسالة لكل قارئ |
| `invitations` | دعوات البريد/الهاتف (الواجهة الحالية بريد فقط) |
| `otp_codes` | مخطط OTP للوظائف المستقبلية؛ غير مستخدم في واجهة الدعوات الحالية |
| `audit_logs` | سجل تغييرات المنصة والمؤسسات |
| `push_subscriptions` | جدول قديم لاشتراكات المتصفح؛ لا يوجد VAPID sender فعلي في الإصدار الحالي |

- واجهة `get_active_student_restrictions(date)` تعرض للمدرب والإدارة نوع الرخصة/الإعفاء وتواريخه فقط؛ التنفيذ الحساس داخل `app_private` غير المعروض عبر Data API.

## ضوابط الأمان الرئيسية

- جميع جداول `public` عليها RLS.
- القراءة والكتابة مقيدة بالمؤسسة النشطة والعضوية والدور.
- كراس المدرب مقيد بمالك الكراس `coach_id`.
- Platform Owner لا يقرأ تقارير المدربين أو تفاصيلها أو سجلاتها التشغيلية؛ سجل التدقيق الذي يراه على مستوى المنصة يقتصر على أحداث المؤسسات.
- التقارير: Coach يقرأ تقريره فقط؛ Manager/Admin يقرآن التقارير النهائية فقط؛ Coach يحذف مسودته غير المرسلة فقط؛ Manager يحذف التقرير النهائي؛ Admin يحذف التقرير النهائي بعد مراجعته فقط.
- الملفات الطبية والسجلات الطبية: Manager/Admin فقط. لا Coach ولا Platform Owner.
- التعاميم: Manager/Admin ينشران ويحذفان؛ Manager/Admin فقط يقرآن قائمة قارئي/غير قارئي التعميم.
- إيصالات قراءة الرسائل: القارئ أو مرسل الرسالة فقط، بشرط أن يكون المستخدم عضوًا في المحادثة.
- دعوات الفريق تُنشأ عبر Edge Function service role فقط؛ لا كتابة مباشرة من المتصفح.

## تشغيل SQL

- `supabase/THE_TRAINERS_SETUP.sql`: Baseline لمشروع جديد وفارغ فقط.
- `supabase/INVITATIONS_OTP_INCREMENTAL.sql`: تكملة مخطط الدعوات/OTP بعد Baseline لمشروع جديد.
- `supabase/migrations/*.sql`: ترحيلات إصدار؛ لا تعِد تنفيذ أي إصدار موجود في سجل Supabase.
- `supabase/manual-applied/`: مراجع SQL قديمة أو نُفذت يدويًا؛ لا تُشغّل تلقائيًا.
- `supabase/pending/`: ملفات غير معتمدة للتنفيذ.

راجع `docs/RELEASE_STATUS_2026-11-19_FINAL_REPAIR.md` قبل أي تعديل على الإنتاج.
