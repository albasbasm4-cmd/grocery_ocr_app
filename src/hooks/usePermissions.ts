import { useAuth } from '../contexts/AuthContext';

export function usePermissions() {
  const { role, permission, canSell, pinExpiresAt } = useAuth();
  const pinActive = Boolean(pinExpiresAt && new Date(pinExpiresAt).getTime() > Date.now());
  const isOwner = role === 'owner';
  const isStaff = role === 'staff';
  const hasWritePermission = isOwner || permission === 'write';

  return {
    isOwner,
    isStaff,
    permission,
    canSell,
    pinActive,

    // رؤية سعر التكلفة والأرباح للمالك فقط
    canSeeCost: isOwner,

    // إدارة المنتجات والتصنيفات
    canEditProducts: hasWritePermission,
    canAddProducts: hasWritePermission,
    canDeleteProducts: isOwner,
    canToggleProductActive: isOwner,
    canAdjustStock: hasWritePermission,

    // إدارة المتجر والموظفين
    canManageStaff: isOwner,
    canManageJoinRequests: isOwner,
    canRegenerateJoinCode: isOwner,
    canChangePin: isOwner,

    // عمليات البيع الحساسة (للمالك بدون PIN)
    canVoidSale: isOwner,
    canReturnSale: isOwner,
    canImportProducts: isOwner,
    canExportBackup: isOwner,

    // للتوافق مع الشيفرات السابقة
    canEdit: hasWritePermission,
    canDelete: isOwner,
  };
}
