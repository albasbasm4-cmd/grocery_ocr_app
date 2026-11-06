import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, FolderOpen } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Modal } from '../components/ui/Modal';
import { PinPromptModal } from '../components/PinPromptModal';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useToast } from '../contexts/ToastContext';
import { ar } from '../i18n/ar';
import { createCategory, deleteCategory, fetchCategories, updateCategory, countProductsInCategory } from '../services/categoriesService';
import { compareArabic } from '../lib/arabic';
import type { Category } from '../types';

export default function CategoriesPage() {
  const { store } = useAuth();
  const { isOwner } = usePermissions();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [pinOpen, setPinOpen] = useState(false);
  const [pinAction, setPinAction] = useState<null | (() => Promise<void>)>(null);
  const [deleting, setDeleting] = useState<Category | null>(null);
  const [deleteProductCount, setDeleteProductCount] = useState(0);

  const categoriesQuery = useQuery({
    queryKey: ['categories', store?.id],
    queryFn: () => fetchCategories(store!.id),
    enabled: Boolean(store?.id),
    staleTime: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!store) throw new Error(ar.genericError);
      return editingCategory
        ? updateCategory(editingCategory.id, categoryName)
        : createCategory(store.id, categoryName);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['categories', store?.id] });
      setEditorOpen(false);
      setEditingCategory(null);
      setCategoryName('');
      showToast(ar.categorySaved, 'success');
    },
    onError: (error) => showToast(error.message, 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (category: Category) => deleteCategory(category.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['categories', store?.id] });
      await queryClient.invalidateQueries({ queryKey: ['products', store?.id] });
      setDeleting(null);
      showToast(ar.categoryDeleted, 'success');
    },
    onError: (error) => showToast(error.message, 'error'),
  });

  const openNew = () => {
    setEditingCategory(null);
    setCategoryName('');
    setEditorOpen(true);
  };

  const openEdit = (category: Category) => {
    setEditingCategory(category);
    setCategoryName(category.name);
    setEditorOpen(true);
  };

  const handleSave = () => {
    if (!categoryName.trim()) {
      showToast(ar.categoryNameRequired, 'error');
      return;
    }
    if (editingCategory) {
      setPinAction(() => async () => { await saveMutation.mutateAsync(); });
      setPinOpen(true);
    } else {
      setPinAction(() => async () => { await saveMutation.mutateAsync(); });
      setPinOpen(true);
    }
  };

  const handleDeleteRequest = async (category: Category) => {
    try {
      const count = await countProductsInCategory(category.id);
      if (count > 0) {
        setDeleteProductCount(count);
        setDeleting(category);
        return;
      }
      setDeleting(category);
      setDeleteProductCount(0);
    } catch (error) {
      showToast(error instanceof Error ? error.message : ar.genericError, 'error');
    }
  };

  const sortedCategories = [...(categoriesQuery.data || [])].sort((a, b) => compareArabic(a.name, b.name));

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-white">{ar.manageCategories}</h1>
          <p className="mt-1 text-xs text-slate-400">{ar.noCategories}</p>
        </div>
        {isOwner && <Button icon={<Plus className="h-4 w-4" />} onClick={openNew}>{ar.addCategory}</Button>}
      </div>

      {categoriesQuery.isLoading ? (
        <Card className="text-center text-sm text-slate-400">{ar.loading}</Card>
      ) : categoriesQuery.isError ? (
        <Card className="text-center text-sm text-rose-300">{categoriesQuery.error.message}</Card>
      ) : sortedCategories.length === 0 ? (
        <Card className="py-10 text-center text-sm text-slate-400">
          <FolderOpen className="mx-auto mb-3 h-8 w-8 text-slate-500" />{ar.noCategories}
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedCategories.map((category) => (
            <Card key={category.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <h2 className="truncate font-bold text-white">{category.name}</h2>
                <p className="mt-1 text-xs text-slate-500">{category.name_normalized}</p>
              </div>
              {isOwner && (
                <div className="flex shrink-0 items-center gap-2">
                  <Button size="sm" variant="outline" icon={<Pencil className="h-4 w-4" />} onClick={() => openEdit(category)}>{ar.editProduct}</Button>
                  <Button size="sm" variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => void handleDeleteRequest(category)}>{ar.deleteCategory}</Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={editorOpen} onClose={() => setEditorOpen(false)} title={editingCategory ? ar.editCategory : ar.addCategory}>
        <div className="space-y-4">
          <label className="block text-sm font-semibold text-slate-300">{ar.categoryName}
            <input autoFocus className="field mt-2" value={categoryName} onChange={(event) => setCategoryName(event.target.value)} />
          </label>
          <div className="flex gap-2">
            <Button className="flex-1" isLoading={saveMutation.isPending} onClick={handleSave}>{ar.save}</Button>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>{ar.cancel}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={Boolean(deleting)} onClose={() => setDeleting(null)} title={ar.deleteCategory}>
        {deleting && (
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              {deleteProductCount > 0
                ? `${ar.categoryDeleteBlocked} (${deleteProductCount})`
                : `${`${ar.categoryDeleteConfirm} ${deleting.name}`}`}
            </p>
            {deleteProductCount === 0 && (
              <div className="flex gap-2">
                <Button variant="danger" isLoading={deleteMutation.isPending} onClick={() => { setPinAction(() => async () => deleteMutation.mutateAsync(deleting)); setPinOpen(true); }}>{ar.deleteCategory}</Button>
                <Button variant="outline" onClick={() => setDeleting(null)}>{ar.cancel}</Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      <PinPromptModal isOpen={pinOpen} onClose={() => setPinOpen(false)} onSuccess={() => { if (pinAction) void pinAction().catch((error: unknown) => showToast(error instanceof Error ? error.message : ar.genericError, 'error')); }} />
    </div>
  );
}
