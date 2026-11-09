# عقود الواجهة البرمجية

فحص الصحة عام. الدخول وتدوير الجلسة عامان ومحدودا المحاولات. إدارة المستخدمين تتطلب رمز دخول وصلاحية `USERS_MANAGE`.

رمز الدخول JWT يُرسل في الترويسة `Authorization: Bearer`. رمز التحديث يُرسل في جسم الطلب ولا يُخزَّن كنص خام في قاعدة البيانات.

## `GET /api/health`

لا يتطلب مصادقة.

الاستجابة عند الاتصال الناجح، الرمز 200:

```json
{
  "status": "ok",
  "service": "flyvan-api",
  "database": "up",
  "phase": "finance"
}
```

إذا تعذر الاستعلام عن قاعدة البيانات، الرمز 503 والحقل `status` يساوي `degraded` والحقل `database` يساوي `down`.

## `POST /api/auth/login`

```json
{ "identifier": "owner@localhost.test", "password": "…" }
```

`identifier` بريد أو هاتف. السائق يدخل بأحدهما. رقم الهاتف مطلوب وفريد عند إنشاء السائق، والبريد اختياري وفريد إن أُدخل. النجاح 200 ويعيد `accessToken` و`refreshToken` و`expiresIn` و`user` من دون بصمة كلمة المرور. الفشل 401 بالرسالة «بيانات الدخول غير صحيحة» سواء كان الحساب غير موجود أو كلمة المرور خاطئة أو الحساب معطّلًا. تجاوز الحد يعيد 429.

## `POST /api/auth/refresh`

```json
{ "refreshToken": "…" }
```

النجاح يبطل الرمز السابق ويعيد زوجًا جديدًا. تقديم رمز سبق إبطاله أو استبداله يبطل بقية جلسات ذلك المستخدم ويعيد 401.

## `POST /api/auth/logout`

نفس جسم التدوير. يعيد 204 ويبطل الرمز إن كان ما زال صالحًا.

## `GET /api/auth/me`

يتطلب رمز دخول لمستخدم نشط. يعيد بيانات المستخدم العامة.

## `/api/users`

يتطلب `USERS_MANAGE`.

- `GET /api/users?page=1&pageSize=20`
- `POST /api/users` ينشئ حسابًا بكلمة مرور من 8 أحرف. رقم الهاتف مطلوب وفريد، والبريد اختياري وفريد إن أُدخل. الدخول يتم بالهاتف أو بالبريد.
- `GET /api/users/:id`
- `PATCH /api/users/:id` للاسم أو الدور أو كلمة المرور. تغيير الدور أو كلمة المرور يبطل جلسات ذلك المستخدم. لا يغيّر المالك دوره بنفسه، ولا يُزال آخر مالك نشط.
- `POST /api/users/:id/disable` مع `{ "reason": "…" }` يعطّل الحساب ويبطل جلساته.
- `POST /api/users/:id/enable`

من دون رمز الدخول تكون الاستجابة 401. بدور لا يملك الصلاحية تكون 403.

## السائقون والمركبات والمناطق

تتطلب رمز دخول. الصلاحية تُفحص على الخادم.

- `GET /api/drivers?page&pageSize&sort=name|createdAt|activity&direction=asc|desc&deleted=true&q=` و`POST /api/drivers` و`GET /api/drivers/:id` و`PATCH /api/drivers/:id` و`POST /api/drivers/:id/password` و`POST /api/drivers/:id/approval` و`POST /api/drivers/:id/archive` و`POST /api/drivers/:id/hold` و`POST /api/drivers/:id/documents` تتطلب `DRIVERS_REVIEW`. الأرشفة تخفي السائق من القائمة النشطة وتبقيه في `deleted=true` دون حذف السجل. اعتماد السائق بلا سبب ويتطلب وثيقة سارية، وإلغاء الاعتماد يتطلب سببًا. إنشاء سائق مع مركبة يرسل `multipart` وصورة مركبة مطلوبة ووثيقة اختيارية، ويحفظ رابطيهما. تعديل السائق يقبل صورة اختيارية. تفاصيله تعرض عدد الرحلات ومجموع العمولات غير المعكوسة والعمولات المترتبة بعد خصم التسويات المعتمدة.
- `GET/PATCH /api/drivers/me` تتطلب `OWN_PROFILE_VIEW`. `POST /api/drivers/me/service-areas` تتطلب `OWN_SERVICE_AREAS_MANAGE` وتنشئ طلب ربط بحالة `PENDING`.
- `POST /api/driver-documents/:id/review` تتطلب `DRIVERS_REVIEW`.
- `GET /api/vehicles?page&pageSize&sort=plate|createdAt|activity&direction=asc|desc&deleted=true&q=` و`POST /api/vehicles` و`GET /api/vehicles/:id` و`PATCH /api/vehicles/:id` و`POST /api/vehicles/:id/archive` و`POST /api/vehicles/:id/approval` و`POST /api/vehicles/:id/assign` و`POST /api/vehicles/:id/documents` تتطلب `VEHICLES_REVIEW`. إنشاء المركبة `multipart` مع `vehicleImage` إلزامي و`vehicleDocument` اختياري، ويُخزن الرابطان. التعديل يبقي صورة المركبة مطلوبة. الأرشفة تخفي المركبة من القائمة النشطة وتغلق إسنادها الحالي دون حذف السجل. الاعتماد بلا سبب ويتطلب صورة، والإلغاء يتطلب سببًا. الإسناد يغلق الإسناد النشط السابق لنفس المركبة. تفاصيل المركبة تعرض عدد الرحلات ومجموع عمولات رحلاتها والعمولات المترتبة بعد خصم التسويات المعتمدة.
- `POST /api/vehicle-documents/:id/review` تتطلب `VEHICLES_REVIEW`.
- `GET/POST /api/service-areas` و`PATCH /api/service-areas/:id` تتطلب `SERVICE_AREAS_MANAGE`.
- `POST /api/driver-service-areas/:id/review` تعتمد الربط أو ترفضه وهو معلّق فقط.
- `POST /api/dispatch/offer-preview` تتطلب `TRIPS_DISPATCH` وتعيد قرار `decideOffer`. لا تنشئ حجزًا ولا عرض رحلة.

تسجيل الوثيقة يحفظ النوع وتاريخ الانتهاء فقط. لا يُرفع ملف.

## الحجوزات والرحلات

تتطلب رمز دخول. الصلاحيات تُفحص على الخادم. عمولة الرحلة تُنشأ فقط عند الإكمال إذا صعد راكب بأجرة.

- `GET /api/bookings?page&pageSize&sort=scheduledAt|createdAt|reference&direction=asc|desc&q=` يتطلب `BOOKINGS_MANAGE` و`TRIPS_VIEW_ALL`.
- `GET/POST /api/destinations` و`PATCH /api/destinations/:id` تتطلب `TRIPS_DISPATCH`. الوجهة اسم وموقع من الخريطة، مع وصف معلم وملاحظة سائق اختياريين.
- `POST /api/trips` يتطلب `TRIPS_DISPATCH`. الجسم: اتجاه `OUTBOUND` أو `RETURN`، و`destinationId`، والموعد. ينشئ رحلة بلا ركاب.
- `GET /api/public/trips` و`GET /api/public/places` و`POST /api/public/bookings` عامة ومحدودة المعدل. الطلب العام ينشئ حجزًا `PENDING` بلا أجرة. الاستجابة رقم الحجز فقط، بلا رمز صعود وبلا بيانات ركاب آخرين.
- `POST /api/bookings/:id/confirm` يتطلب `BOOKINGS_MANAGE` و`FARE_LOCK`. يثبت الأجرة وينقل الطلب إلى `CONFIRMED` ويعيد رموز الصعود مرة واحدة.
- `POST /api/bookings` يتطلب `BOOKINGS_MANAGE` و`FARE_LOCK`. يضيف راكبًا إلى رحلة قائمة. الاتجاه `OUTBOUND` أو `RETURN` أو `ROUND_TRIP`. نقطة الالتقاط إحداثيات. ذهاب وإياب يرسل `outboundTripId` و`returnTripId` وأجرتين، ويُدرج الراكب في الإياب تلقائيًا. العملة دائمًا `SYP` ولا تُرسل في الجسم، ولا تُرسل جهة أو جامعة. الاستجابة تتضمن `boardingCodes` مرة واحدة لكل اتجاه.
- `POST /api/bookings/:id/fare` يتطلب `FARE_ADJUST` مع `tripId` والأجرة وسبب من 3 أحرف. يعدّل أجرة مقعد الراكب في تلك الرحلة ويبقي العملة `SYP`.
- `POST /api/bookings/:id/cancel` يتطلب `BOOKINGS_MANAGE` وسببًا. يلغي مقاعد الراكب ويعيد ترتيب أوقات الالتقاط، ولا يلغي الرحلة.
- `GET /api/trips` بنفس ترقيم الحجوزات، والترتيب `scheduledAt` أو `status`، مع `leg` و`bookable=true` لرحلات ما زالت تقبل ركابًا. السائق بلا `TRIPS_VIEW_ALL` يرى الرحلة إذا كان سائقها الأساسي أو من مركباتها المرتبطة أو لديه عرض معلّق. وجهة الرحلة ظاهرة، وتُخفى هواتف الركاب ونقاط التقاطهم وأوقات الالتقاط حتى الإسناد.
- `GET /api/trips/candidates` يتطلب `TRIPS_DISPATCH` ويعيد حتى 100 سائق معتمد غير موقوف ولديهم مركبة معتمدة.
- `POST /api/trips/:id/origin` يتطلب `TRIPS_DISPATCH` وإحداثيات موقع انطلاق السائق. ليست تتبعًا حيًا. زر «موقعي الحالي» يقرأ موقع المتصفح مرة واحدة ولا يحفظ مسارًا.
- `POST /api/locations/expand` لمستخدم مسجّل. يوسّع رابط `maps.app.goo.gl` أو `goo.gl` فقط، ويرفض أي نطاق آخر. الإحداثيات الظاهرة في النص تُقرأ في الواجهة دون هذا الطلب.
- `GET /api/trips/:id/route` يعيد هندسة الطريق ومسافته بالامتار وزمنه بالثواني من موقع الانطلاق إلى الركاب ثم الوجهة. السائق غير المسند لا يرى مسار الركاب. بدون موقع انطلاق تكون الاستجابة 400.
- `POST /api/trips/:id/assign` يتطلب `TRIPS_DISPATCH` و`driverProfileId`. المصدر `MANUAL_DISPATCH`. يربط مركبة السائق ويجعلها الأساسية. لا يمنع الإسناد لأن مقاعد مركبة واحدة أقل من عدد الركاب. يمنع الإسناد إذا لم يوجد حد ائتماني بالليرة السورية، أو إذا كان الرصيد المتوقع بعد العمولة يتجاوز الحد. الاستثناء الموثق على الرحلة يتجاوز هذا الفحص لذلك السائق فقط.
- `POST /api/trips/:id/vehicles` يتطلب `TRIPS_DISPATCH` و`driverProfileId`. يربط مركبة إضافية دون استبدال الأساسية. إذا لم توجد مركبة بعد، يسند الرحلة كالمسار اليدوي.
- `DELETE /api/trips/:id/vehicles/:vehicleId` يتطلب `TRIPS_DISPATCH`. يفك المركبة قبل بدء الرحلة إذا بقيت المقاعد كافية للركاب الحاليين، ويبقي مركبة واحدة على الأقل بعد الإسناد.
- `POST /api/trips/:id/offers` يتطلب `TRIPS_DISPATCH`. ينشئ عرضًا مدته 15 دقيقة إذا سمح القرب أو منطقة الخدمة، وإلا 409 بسبب القرار. `straightLineMeters` اختياري وليس زمن طريق.
- `POST /api/trip-offers/:id/respond` يتطلب `TRIPS_OPERATE_OWN` و`decision` بقيمة `ACCEPT` أو `REJECT`، وللسائق صاحب العرض فقط. القبول يفحص حد المديونية مثل الإسناد اليدوي.
- `POST /api/trips/:id/status` ينقل الحالة وفق جدول الانتقالات. السائق المعيّن يضبط الوصول والبدء والإكمال وعدم الحضور. بدء السائق يُرفض إذا بقي على موعد الانطلاق أكثر من ساعة، ويُسمح عند الساعة الأخيرة أو بعدها. الكونترول يستطيع البدء والإلغاء والنزاع مع سبب دون هذا الحد. `COMPLETED` ينشئ عمولة واحدة للسائق الأساسي إذا كانت هناك مقاعد `BOARDED` بأجرة، مع قيد مدين `commission:{tripId}`. الإعادة لا تكرر القيد، والإلغاء لا ينشئ عمولة.
- `POST /api/trips/:id/passengers/:passengerId/boarding` بحالات `BOARDED` أو `NO_SHOW` أو `CANCELLED` أثناء الإسناد أو الوصول أو التنفيذ. الرمز الاختياري من 4 خانات يُفحص ببصمته.
- `POST /api/trips/:id/fare-collected` يسجّل استلام أجرة الراكب النقدية أثناء التنفيذ أو بعد الإكمال. ليس قيد عمولة ولا تسوية.
- `POST /api/trips/:id/credit-exception` يتطلب `CREDIT_EXCEPTION_GRANT` وسببًا. يسري على هذه الرحلة فقط.

## المالية

- `GET /api/finance/summary` يتطلب `FINANCE_VIEW`. يعيد السياسة السارية وأرصدة السائقين والتسويات الأخيرة. `companyOutstanding` تقرير تجميعي.
- `GET /api/finance/me` يتطلب `OWN_FINANCE_VIEW` ويعيد عمولات السائق الحالي وتسديداته وحد مديونيته. أجرة الراكب النقدية مذكورة في `cashFareNote` وليست من هذا الرصيد. `creditNotice` يظهر عند غياب الحد أو بلوغه.
- `POST /api/finance/policy` يتطلب `COMMISSION_POLICY_MANAGE`. جسم: `ratePercent` و`effectiveFrom` و`reason`. يغلق السياسة المفتوحة ولا يغيّر العمولات المثبتة.
- `POST /api/finance/drivers/:id/commission` يتطلب `DRIVER_COMMISSION_MANAGE` وبالجسم نفسه.
- `POST /api/finance/drivers/:id/credit-limit` يتطلب `CREDIT_LIMIT_MANAGE`. الجسم: `amount` و`reason` بالليرة السورية.
- `POST /api/finance/settlements` يتطلب `FINANCE_RECORD_PAYMENT`. الجسم: السائق والمبلغ وطريقة الاستلام ووقت الاستلام ورقم الإيصال ومفتاح منع التكرار. الحالة `RECORDED` بلا قيد دفتر.
- `POST /api/finance/settlements/:id/review` يتطلب `FINANCE_REVIEW_SETTLEMENT`. القرار `PENDING_REVIEW` أو `REJECTED`.
- `POST /api/finance/settlements/:id/approve` يتطلب `FINANCE_APPROVE_SETTLEMENT`. ينشئ قيدًا دائنًا ويوزّع المبلغ على أقدم العمولات. الزيادة تبقى رصيدًا دائنًا.

وثائق OpenAPI التفاعلية على `/api/docs`.
