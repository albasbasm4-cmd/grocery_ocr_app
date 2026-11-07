import React, { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { createCustomer } from '../../services/customersService';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { ar } from '../../i18n/ar';
import { toLatinDigits } from '../../lib/numbers';
import type { Customer } from '../../types';

interface NewCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (customer: Customer) => void;
}

export const NewCustomerModal: React.FC<NewCustomerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const auth = useAuth() as any;
  const activeStore = auth.store || auth.activeStore;
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeStore) return;

    const cleanName = name.trim();
    if (!cleanName) {
      setError(ar.customerNameRequired);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const newCustomer = await createCustomer({
        storeId: activeStore.id,
        name: cleanName,
        phone: toLatinDigits(phone).trim() || null,
      });

      setName('');
      setPhone('');
      onSuccess(newCustomer);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : ar.addCustomerError);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={ar.addNewCustomer}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-300 p-3 rounded-xl text-xs">
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            {ar.customerName} *
          </label>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            placeholder={ar.customerNameExample}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-emerald-500 text-right"
            autoFocus
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-300 mb-1.5">
            {ar.customerPhoneOptional}
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="05xxxxxxxx"
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-white text-sm outline-none focus:border-emerald-500 text-right"
          />
        </div>

        <div className="flex gap-2 pt-2">
          <Button
            type="submit"
            variant="primary"
            className="flex-1"
            disabled={loading || !name.trim()}
          >
            {loading ? ar.loading : ar.addNewCustomer}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
          >
            {ar.cancel}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
