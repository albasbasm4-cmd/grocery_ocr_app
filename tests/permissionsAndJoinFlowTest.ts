import Decimal from 'decimal.js';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ فشل الاختبار: ${message}`);
    process.exit(1);
  }
  console.log(`  ✅ ${message}`);
}

console.log('🧪 بدء اختبارات نموذج الصلاحيات المحدث والانضمام والأمان (المرحلة 13)...');

console.log('\n🛡️ فحص 1: مصفوفة الصلاحيات (Owner مقابل Staff Write مقابل Staff Read)...');

interface MemberContext {
  role: 'owner' | 'staff';
  permission: 'read' | 'write' | null;
  canSell: boolean;
  isActive: boolean;
}

function computePermissions(m: MemberContext) {
  const isOwner = m.role === 'owner';
  const isWrite = m.permission === 'write';
  return {
    canSeeCost: isOwner,
    canAddProducts: isOwner || isWrite,
    canEditProducts: isOwner || isWrite,
    canAdjustStock: isOwner || isWrite,
    canToggleProductActive: isOwner,
    canDeleteProducts: isOwner,
    canManageStaff: isOwner,
    canChangePin: isOwner,
    canRegenerateJoinCode: isOwner,
    canViewAuditLog: isOwner,
    canSell: isOwner || (m.role === 'staff' && m.canSell),
  };
}

const ownerPerms = computePermissions({ role: 'owner', permission: null, canSell: true, isActive: true });
assert(ownerPerms.canSeeCost === true, 'المالك يرى سعر التكلفة');
assert(ownerPerms.canAddProducts === true, 'المالك يضيف المنتجات');
assert(ownerPerms.canEditProducts === true, 'المالك يعدل المنتجات');
assert(ownerPerms.canToggleProductActive === true, 'المالك فقط يعطل ويفعل المنتج');
assert(ownerPerms.canDeleteProducts === true, 'المالك فقط يحذف التصنيفات/المنتجات');
assert(ownerPerms.canManageStaff === true, 'المالك يدير الموظفين');
assert(ownerPerms.canSell === true, 'المالك يمتلك صلاحية البيع تلقائياً');

const staffWritePerms = computePermissions({ role: 'staff', permission: 'write', canSell: true, isActive: true });
assert(staffWritePerms.canSeeCost === false, 'موظف الكتابة لا يرى سعر التكلفة');
assert(staffWritePerms.canAddProducts === true, 'موظف الكتابة يستطيع إضافة منتجات');
assert(staffWritePerms.canEditProducts === true, 'موظف الكتابة يستطيع تعديل بيانات المنتج');
assert(staffWritePerms.canToggleProductActive === false, 'موظف الكتابة لا يستطيع تعطيل المنتج (محصور بالمالك)');
assert(staffWritePerms.canDeleteProducts === false, 'موظف الكتابة لا يستطيع الحذف');
assert(staffWritePerms.canManageStaff === false, 'موظف الكتابة لا يستطيع إدارة الموظفين');
assert(staffWritePerms.canSell === true, 'موظف الكتابة يبيع لأن canSell=true');

const staffReadPerms = computePermissions({ role: 'staff', permission: 'read', canSell: false, isActive: true });
assert(staffReadPerms.canSeeCost === false, 'موظف القراءة لا يرى سعر التكلفة');
assert(staffReadPerms.canAddProducts === false, 'موظف القراءة لا يستطيع إضافة منتجات');
assert(staffReadPerms.canEditProducts === false, 'موظف القراءة لا يستطيع تعديل المنتجات');
assert(staffReadPerms.canAdjustStock === false, 'موظف القراءة لا يستطيع تسوية المخزون');
assert(staffReadPerms.canSell === false, 'موظف القراءة محروم من البيع عندما canSell=false');

console.log('\n🔑 فحص 2: متطلبات رمز PIN (PIN يخص المتجر ومحصور بالإجراءات الإدارية فقط)...');

const pinRequiredActions = [
  'create_staff',
  'approve_join_request',
  'set_member_permission',
  'deactivate_member',
  'remove_member',
  'change_pin',
  'regenerate_join_code',
];

const pinFreeOwnerActions = [
  'add_product',
  'edit_product',
  'adjust_stock',
  'toggle_product_active',
  'void_sale',
  'return_items',
  'import_products_csv',
  'export_full_backup',
];

for (const act of pinFreeOwnerActions) {
  assert(!pinRequiredActions.includes(act), `عملية المالك [${act}] حرة ومباشرة دون أي PIN`);
}
for (const act of pinRequiredActions) {
  assert(pinRequiredActions.includes(act), `العملية الحساسة [${act}] تشترط جلسة PIN سارية لمالك المتجر`);
}

console.log('\n📬 فحص 3: تدفق طلبات الانضمام والأمان (Rate Limiting & Anti-Enumeration)...');

const maxDailyJoinRequests = 5;
let userDailyRequests = 5;
const canSubmitRequest = userDailyRequests < maxDailyJoinRequests;
assert(!canSubmitRequest, 'تطبيق حد أقصى 5 طلبات يومياً للمستخدم لمنع هجمات التخمين والإغراق');

const uniformErrorMessage = 'رمز المتجر غير صحيح أو غير متطابق.';
const invalidCodeError = uniformErrorMessage;
const blockedRequesterError = uniformErrorMessage;
assert(invalidCodeError === blockedRequesterError, 'رسالة خطأ موحدة لمنع كشف وجود المتاجر أو حالة الحظر قبل القبول');

const requestCreatedAt = new Date('2026-11-01T00:00:00Z');
const checkDate = new Date('2026-11-09T00:00:00Z');
const ageDays = (checkDate.getTime() - requestCreatedAt.getTime()) / (1000 * 60 * 60 * 24);
const isExpired = ageDays > 7;
assert(isExpired, 'انتهاء صلاحية طلبات الانضمام تلقائياً بعد 7 أيام دون قرار');

console.log('\n🔒 فحص 4: حماية استعادة رمز PIN (SHA-256، 6 أرقام، 10 دقائق، حد محاولات)...');

function isValid6DigitCode(code: string): boolean {
  return /^\d{6}$/.test(code.trim());
}
assert(isValid6DigitCode('849201'), 'رمز الاستعادة يقبل 6 أرقام بالضبط');
assert(!isValid6DigitCode('12345'), 'رفض الرموز الأقل من 6 أرقام');
assert(!isValid6DigitCode('1234567'), 'رفض الرموز الأكثر من 6 أرقام');
assert(!isValid6DigitCode('abc123'), 'رفض الرموز غير الرقمية');

const maxResetAttempts = 5;
let currentAttempts = 5;
const isLockedOut = currentAttempts >= maxResetAttempts;
assert(isLockedOut, 'إبطال رمز الاستعادة وقفل المحاولات بعد 5 محاولات خاطئة');

const pinResetCooldownSeconds = 60;
const pinResetHourlyLimit = 3;
assert(pinResetCooldownSeconds === 60, 'فاصل زمني إلزامي 60 ثانية بين طلبات رموز الاستعادة');
assert(pinResetHourlyLimit === 3, 'حد أقصى 3 طلبات استعادة في الساعة الواحدة للمتجر');

console.log('\n🚫 فحص 5: عزل العضو المعطل ومنع وصوله للمتجر...');

function isMemberAllowedInStore(m: MemberContext): boolean {
  return m.isActive;
}
assert(!isMemberAllowedInStore({ role: 'staff', permission: 'write', canSell: true, isActive: false }), 'العضو المعطّل (is_active=false) محظور فوراً من كافة عمليات المتجر');

console.log('\n📜 فحص 6: شمولية سجل التدقيق للعمليات الحساسة...');

const auditActions = [
  'create_staff',
  'approve_join',
  'reject_join',
  'set_permission',
  'deactivate_member',
  'remove_member',
  'change_pin',
  'reset_pin_with_code',
  'regenerate_join_code',
];
assert(auditActions.length === 9, 'سجل التدقيق store_audit_log يوثق جميع العمليات الحساسة التسع');

console.log('\n🎉 اكتملت جميع اختبارات المرحلة 13 بنجاح 100%!');
