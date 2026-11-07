import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, CalendarDays, Download, FileSpreadsheet, FileText, Package, RefreshCw, TrendingDown, TrendingUp, Wallet, AlertTriangle, CalendarClock, ArrowDownUp } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { useToast } from '../contexts/ToastContext';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { ar } from '../i18n/ar';
import { exportReportsCsv, exportReportsWorkbook, fetchStoreReports, shareReportPdf, shareOrDownloadReport } from '../services/reportsService';
import type { ReportFilter } from '../services/reportsService';
import Decimal from 'decimal.js';

function dateString(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function presetDates(preset: string): { from: string; to: string } {
  const today = new Date(); const to = dateString(today); const start = new Date(today);
  if (preset === 'yesterday') start.setDate(start.getDate() - 1);
  else if (preset === '7days') start.setDate(start.getDate() - 6);
  else if (preset === 'month') start.setDate(1);
  return { from: dateString(start), to: preset === 'yesterday' ? dateString(start) : to };
}
function formatAmount(value: string | number, currency: string, formatter: (n: number | string) => string): string { return `${formatter(value)} ${currency}`; }
function movementLabel(type: string): string { return ({ sale: ar.reports.sale, return: ar.reports.return, purchase: ar.reports.purchase, adjustment: ar.reports.adjustment, damage: ar.reports.damage, void: ar.reports.void } as Record<string, string>)[type] ?? type; }

export default function ReportsPage() {
  const { store, role } = useAuth();
  const { formatNumber } = useSettings();
  const { showToast } = useToast();
  const isOwner = role === 'owner';
  const t = ar.reports;
  const initial = presetDates('today');
  const [preset, setPreset] = useState('today');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [expiryDays, setExpiryDays] = useState(30);
  const [productId, setProductId] = useState('');
  const [movementType, setMovementType] = useState('');
  const filter = useMemo<ReportFilter>(() => ({ from, to, expiryDays, productId: productId || null, movementType: movementType || null }), [from, to, expiryDays, productId, movementType]);
  const { data: productOptions = [] } = useQuery({
    queryKey: ['report-products', store?.id],
    queryFn: async () => {
      const { data: rows, error } = await supabase.from('products').select('id,name').eq('store_id', store!.id).order('name').limit(2000);
      if (error) throw error;
      return rows ?? [];
    },
    enabled: Boolean(store?.id),
    staleTime: 60_000,
  });
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['store-reports', store?.id, filter],
    queryFn: () => fetchStoreReports(store!.id, filter),
    enabled: Boolean(store?.id && from && to && from <= to),
    staleTime: 30_000,
  });
  const currency = store?.currency_symbol || 'ر.س';
  const totalRevenue = useMemo(() => (data?.sales_daily ?? []).reduce((sum, row) => sum.plus(row.revenue), new Decimal(0)), [data?.sales_daily]);
  const invoiceCount = useMemo(() => (data?.sales_daily ?? []).reduce((sum, row) => sum + Number(row.invoice_count), 0), [data?.sales_daily]);
  const averageInvoice = invoiceCount > 0 ? totalRevenue.div(invoiceCount) : new Decimal(0);
  const chartData = (data?.sales_daily ?? []).map((row) => ({ ...row, shortDay: new Date(`${row.day}T00:00:00`).toLocaleDateString('ar', { day: 'numeric', month: 'short' }), revenueCents: new Decimal(row.revenue).times(100).toNumber() }));

  const choosePreset = (value: string) => {
    setPreset(value);
    if (value !== 'custom') { const dates = presetDates(value); setFrom(dates.from); setTo(dates.to); }
  };
  const exportExcel = async () => { if (!data) return; try { await shareOrDownloadReport(exportReportsWorkbook(data), `تقارير-${from}-${to}.xlsx`, 'تقارير المتجر Excel'); } catch { showToast(t.exportError, 'error'); } };
  const exportCsv = async () => { if (!data) return; try { await shareOrDownloadReport(exportReportsCsv(data), `مبيعات-${from}-${to}.csv`, 'تقرير المبيعات CSV'); } catch { showToast(t.exportError, 'error'); } };
  const exportPdf = async () => {
    if (!data) return;
    try { await shareReportPdf(data, 'تقارير المتجر'); }
    catch { showToast(t.pdfError, 'error'); }
  };

  return (
    <div className="space-y-4 pb-4" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div><h1 className="text-xl font-extrabold text-white">{ar.reportsTitle}</h1><p className="mt-1 text-xs text-slate-400">{t.subtitle}</p></div>
        <Button variant="secondary" size="sm" onClick={() => void refetch()} isLoading={isFetching} icon={<RefreshCw className="h-4 w-4" />}>{t.refresh}</Button>
      </div>

      <Card className="space-y-3">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-200"><CalendarDays className="h-4 w-4 text-emerald-400" />{t.period}</div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {([['today',t.today],['yesterday',t.yesterday],['7days',t.days7],['month',t.thisMonth],['custom',t.custom]] as const).map(([value,label]) => (
            <button key={value} type="button" onClick={() => choosePreset(value)} className={`rounded-xl border px-2 py-2 text-xs font-bold ${preset === value ? 'border-emerald-400 bg-emerald-500/15 text-emerald-300' : 'border-slate-700 bg-slate-800 text-slate-300'}`}>{label}</button>
          ))}
        </div>
        {preset === 'custom' && <div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-400">{t.from}<input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></label><label className="text-xs text-slate-400">{t.to}<input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-sm text-white" /></label></div>}
      </Card>

      {isError && <Card className="border-rose-500/30 text-sm text-rose-300">{t.loadError}</Card>}
      {isLoading ? <Card className="py-12 text-center text-sm text-slate-400">{t.loading}</Card> : data && <>
        <section className="grid grid-cols-2 gap-3">
          <Metric icon={<TrendingUp className="h-4 w-4" />} title={t.totalSales} value={formatAmount(totalRevenue.toFixed(2), currency, formatNumber)} tone="emerald" />
          <Metric icon={<FileText className="h-4 w-4" />} title={t.invoiceCount} value={formatNumber(invoiceCount, { decimals: 0 })} tone="sky" />
          <Metric icon={<Wallet className="h-4 w-4" />} title={t.averageInvoice} value={formatAmount(averageInvoice.toFixed(2), currency, formatNumber)} tone="indigo" />
          <Metric icon={<AlertTriangle className="h-4 w-4" />} title={t.lowStock} value={formatNumber(data.low_stock.length, { decimals: 0 })} tone={data.low_stock.length ? 'amber' : 'slate'} />
        </section>

        <Card>
          <div className="mb-4 flex items-center justify-between"><h2 className="font-bold text-white">{t.dailySales}</h2><BarChart3 className="h-5 w-5 text-emerald-400" /></div>
          {chartData.length ? <div className="h-64 w-full" dir="ltr"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}><CartesianGrid stroke="#334155" strokeDasharray="3 3" /><XAxis dataKey="shortDay" reversed tick={{ fill: '#cbd5e1', fontSize: 11 }} /><YAxis orientation="right" tick={{ fill: '#94a3b8', fontSize: 10 }} /><Tooltip formatter={(value) => [`${formatNumber(new Decimal(String(value)).div(100).toFixed(2))} ${currency}`, t.sales]} contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 12, direction: 'rtl' }} /><Bar dataKey="revenueCents" fill="#34d399" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div> : <Empty text={t.noSales} />}
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          <ReportList title={t.mostSold} icon={<TrendingUp className="h-4 w-4 text-emerald-400" />} rows={data.products_top.map((row) => ({ name: row.name, value: `${formatNumber(row.quantity_sold)} ${row.revenue ? `· ${formatNumber(row.revenue)} ${currency}` : ''}` }))} />
          <ReportList title={t.leastMovement} icon={<TrendingDown className="h-4 w-4 text-amber-400" />} rows={data.products_slow.map((row) => ({ name: row.name, value: `${formatNumber(row.quantity_sold)} · ${formatNumber(row.revenue)} ${currency}` }))} />
        </div>

        {isOwner && data.profit_summary && <>
          <Card className="border-emerald-500/20">
            <h2 className="mb-3 font-bold text-white">{t.profitTitle}</h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <SummaryItem label={t.revenue} value={`${formatNumber(data.profit_summary.revenue)} ${currency}`} />
              <SummaryItem label={t.cost} value={`${formatNumber(data.profit_summary.cost)} ${currency}`} />
              <SummaryItem label={t.grossProfit} value={`${formatNumber(data.profit_summary.profit)} ${currency}`} highlight />
              <SummaryItem label={t.invoices} value={formatNumber(data.profit_summary.invoice_count, { decimals: 0 })} />
            </div>
            <div className="mt-4 space-y-3"><ReportList title={t.profitByProduct} rows={(data.profit_products ?? []).slice(0, 8).map((row) => ({ name: row.name, value: `${formatNumber(row.profit)} ${currency}` }))} /><ReportList title={t.profitByCategory} rows={(data.profit_categories ?? []).map((row) => ({ name: row.name, value: `${formatNumber(row.profit)} ${currency}` }))} /><ReportList title={t.inventoryValue} rows={(data.inventory_by_category ?? []).map((row) => ({ name: row.category_name, value: `${formatNumber(row.inventory_value)} ${currency}` }))} /></div>
          </Card>
        </>}

        <Card className="border-amber-500/20">
          <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold text-white"><Package className="h-4 w-4 text-amber-400" />{t.lowStock}</h2><span className="rounded-full bg-amber-500/15 px-2 py-1 text-xs text-amber-300">{data.low_stock.length}</span></div>
          {data.low_stock.length ? <div className="space-y-2">{data.low_stock.slice(0, 30).map((row) => <div key={row.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/70 p-3"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-100">{row.name}</p><p className="text-[11px] text-slate-400">{row.category_name ?? t.categoryNone}</p></div><div className="shrink-0 text-left text-xs"><span className="font-bold text-amber-300">{formatNumber(row.stock_quantity)} / {formatNumber(row.min_stock)}</span><p className="text-slate-500">{t.quantityMin}</p></div></div>)}</div> : <Empty text={t.noLowStock} />}
        </Card>

        <Card className="border-rose-500/20">
          <div className="mb-3 flex items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-bold text-white"><CalendarClock className="h-4 w-4 text-rose-400" />{t.expiry}</h2><label className="flex items-center gap-2 text-xs text-slate-400">{t.within}<input type="number" min="1" max="365" value={expiryDays} onChange={(event) => setExpiryDays(Math.min(365, Math.max(1, Number(event.target.value) || 1)))} className="w-16 rounded-lg border border-slate-700 bg-slate-950 p-2 text-center text-white" />{t.days}</label></div>
          {data.expiring.length ? <div className="space-y-2">{data.expiring.slice(0, 30).map((row) => { const expired = row.days_remaining < 0; return <div key={row.id} className={`flex items-center justify-between gap-2 rounded-xl p-3 ${expired ? 'bg-rose-950/60' : 'bg-slate-950/70'}`}><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-100">{row.name}</p><p className="text-[11px] text-slate-400">{row.category_name ?? t.categoryNone} · {row.expiry_date}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${expired ? 'bg-rose-500/20 text-rose-300' : 'bg-amber-500/15 text-amber-300'}`}>{expired ? `${t.expiredSince} ${Math.abs(row.days_remaining)} ${t.day}` : `${t.remaining} ${row.days_remaining} ${t.day}`}</span></div>; })}</div> : <Empty text={t.noExpiry} />}
        </Card>

        <Card>
          <div className="mb-3 flex items-center gap-2"><ArrowDownUp className="h-4 w-4 text-sky-400" /><h2 className="font-bold text-white">{t.stockMovements}</h2></div>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <select value={productId} onChange={(event) => setProductId(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white"><option value="">{t.allProducts}</option>{productOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
            <select value={movementType} onChange={(event) => setMovementType(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white"><option value="">{t.allMovements}</option>{[['sale',t.sale],['return',t.return],['purchase',t.purchase],['adjustment',t.adjustment],['damage',t.damage],['void',t.void]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
          {data.movements.length ? <div className="max-h-96 space-y-2 overflow-auto">{data.movements.slice(0, 80).map((row) => <div key={row.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/70 p-3 text-xs"><div className="min-w-0"><p className="truncate font-bold text-slate-100">{row.product_name}</p><p className="mt-1 text-slate-500">{movementLabel(row.type)} · {new Date(row.created_at).toLocaleString('ar')}</p>{row.note && <p className="text-slate-400">{row.note}</p>}</div><span className={`shrink-0 font-bold ${Number(row.quantity_delta) < 0 ? 'text-rose-300' : 'text-emerald-300'}`}>{Number(row.quantity_delta) > 0 ? '+' : ''}{formatNumber(row.quantity_delta)}</span></div>)}</div> : <Empty text={t.noMovements} />}
        </Card>

        <Card className="border-sky-500/20">
          <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold text-white"><Wallet className="h-4 w-4 text-sky-400" />{t.debts}</h2><span className="font-extrabold text-sky-300">{formatNumber(data.debts.total)} {currency}</span></div>
          {data.debts.customers.length ? <div className="space-y-2">{data.debts.customers.slice(0, 20).map((customer) => <div key={customer.id} className="flex items-center justify-between rounded-xl bg-slate-950/70 p-3"><span className="text-sm font-bold text-slate-100">{customer.name}</span><span className="text-sm font-bold text-amber-300">{formatNumber(customer.balance)} {currency}</span></div>)}</div> : <Empty text={t.noDebts} />}
        </Card>

        <Card>
          <h2 className="mb-3 font-bold text-white">{t.exportTitle}</h2>
          <div className="grid grid-cols-3 gap-2">
            <Button variant="secondary" size="sm" onClick={() => void exportExcel()} icon={<FileSpreadsheet className="h-4 w-4" />}>{t.excel}</Button>
            <Button variant="secondary" size="sm" onClick={() => void exportCsv()} icon={<Download className="h-4 w-4" />}>{t.csv}</Button>
            <Button variant="secondary" size="sm" onClick={() => void exportPdf()} icon={<FileText className="h-4 w-4" />}>{t.pdf}</Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{t.exportNote}</p>
        </Card>
      </>}
    </div>
  );
}

function Metric({ icon, title, value, tone }: { icon: React.ReactNode; title: string; value: string; tone: 'emerald'|'sky'|'indigo'|'amber'|'slate' }) {
  const color = { emerald: 'text-emerald-300 bg-emerald-500/10', sky: 'text-sky-300 bg-sky-500/10', indigo: 'text-indigo-300 bg-indigo-500/10', amber: 'text-amber-300 bg-amber-500/10', slate: 'text-slate-300 bg-slate-500/10' }[tone];
  return <Card className="p-3"><div className="flex items-center gap-2"><span className={`rounded-lg p-2 ${color}`}>{icon}</span><span className="text-[11px] text-slate-400">{title}</span></div><p className="mt-2 truncate text-base font-black text-white">{value}</p></Card>;
}
function SummaryItem({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) { return <div className="rounded-xl bg-slate-950/70 p-3"><p className="text-xs text-slate-500">{label}</p><p className={`mt-1 font-bold ${highlight ? 'text-emerald-300' : 'text-slate-100'}`}>{value}</p></div>; }
function Empty({ text }: { text: string }) { return <p className="py-6 text-center text-xs text-slate-500">{text}</p>; }
function ReportList({ title, icon, rows }: { title: string; icon?: React.ReactNode; rows: Array<{ name: string; value: string }> }) { return <div><h3 className="mb-2 flex items-center gap-2 text-sm font-bold text-slate-200">{icon}{title}</h3>{rows.length ? <div className="space-y-2">{rows.map((row, index) => <div key={`${row.name}-${index}`} className="flex items-center justify-between gap-2 rounded-xl bg-slate-950/70 px-3 py-2"><span className="truncate text-xs text-slate-300">{index + 1}. {row.name}</span><span className="shrink-0 text-xs font-bold text-emerald-300">{row.value}</span></div>)}</div> : <Empty text="لا توجد بيانات للفترة المحددة." />}</div>; }
