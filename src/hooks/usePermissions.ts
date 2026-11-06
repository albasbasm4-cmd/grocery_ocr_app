import { useAuth } from '../contexts/AuthContext';

export function usePermissions() {
  const { role, pinExpiresAt } = useAuth();
  const pinActive = Boolean(pinExpiresAt && new Date(pinExpiresAt).getTime() > Date.now());
  const isOwner = role === 'owner';
  return {
    canEdit: isOwner && pinActive,
    canDelete: isOwner && pinActive,
    canManageStaff: isOwner && pinActive,
    isOwner,
    isStaff: role === 'staff',
    pinActive,
  };
}
