import { useState } from 'react';
import { Plus } from 'lucide-react';
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from '../components/charts';
import { Button, EmptyState, Field, KpiCard, Modal, PageHeader, Pagination, Select, TextInput, useFetch, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { formatDate, methodLabel, money } from '../lib/format';

interface Purchase {
  id: number;
  purchase_date: string;
  supplier: string;
  quantity: string;
  measurement_unit: string;
  cost_per_unit: string;
  total_cost: string;
  payment_method: string;
  reference_number: string | null;
  notes: string | null;
}

interface Summary {
  waterBilled: number;
  waterCollected: number;
  waterOutstanding: number;
  waterPurchased: number;
  waterSupplyCost: number;
  averagePurchaseCost: number;
  collectionRate: number;
  surplusDeficit: number;
  surplus: boolean;
  currency: string;
}

interface MonthlyRow {
  month: number;
  monthName: string;
  waterBilled: number;
  waterCollected: number;
  waterOutstanding: number;
  waterPurchased: number;
  waterSupplyCost: number;
  surplusDeficit: number;
  collectionRate: number;
  currency: string;
}

const SUPPLIERS_HINT = 'e.g. Nairobi Water, borehole operator, water vendor';

export default function WaterSupply() {
  const { toast } = useToast();
  const now = new Date();
  const [edit, setEdit] = useState<Purchase | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  const { data, loading, error } = useFetch(
    () => api.list<Purchase>(`/api/water/purchases${qs({ page, limit: 20 })}`),
    [page, refreshKey]
  );
  const { data: summary } = useFetch<Summary>(
    () => api.get<{ data: Summary }>(`/api/water/summary${qs({ year: now.getFullYear() })}`).then((r) => r.data),
    [refreshKey]
  );
  const { data: monthly } = useFetch<MonthlyRow[]>(
    () => api.get<{ data: MonthlyRow[] }>(`/api/water/monthly?year=${now.getFullYear()}`).then((r) => r.data),
    [refreshKey]
  );

  const refresh = () => setRefreshKey((k) => k + 1);

  return (
    <div>
      <PageHeader
        title="Water Supply Costs"
        subtitle="What you spend buying water for the building — Water Collected − Supply Cost = Surplus or Deficit"
        actions={<Button onClick={() => { setEdit(null); setShowForm(true); }}><Plus size={16} strokeWidth={2} aria-hidden /> Record Water Purchase</Button>}
      />

      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard label="Water purchased" value={`${summary.waterPurchased} units`} sub={`avg ${money(summary.averagePurchaseCost, summary.currency)}/unit`} />
          <KpiCard label="Total supply cost" value={money(summary.waterSupplyCost, summary.currency)} tone="warn" />
          <KpiCard label="Water collected" value={money(summary.waterCollected, summary.currency)} sub={`${summary.collectionRate}% of billed`} tone="good" />
          <KpiCard
            label={summary.surplus ? 'Water surplus' : 'Water deficit'}
            value={money(Math.abs(summary.surplusDeficit), summary.currency)}
            tone={summary.surplus ? 'good' : 'bad'}
          />
        </div>
      )}

      {loading && <div className="text-sm text-gray-500">Loading…</div>}
      {error && <div className="text-sm text-red-600">{error}</div>}
      {!loading && !error && data && (
        <>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Supplier</th><th>Quantity</th><th>Cost / Unit</th>
                  <th>Total Cost</th><th>Method</th><th>Reference</th><th>Notes</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.purchase_date)}</td>
                    <td className="font-semibold text-gray-900">{p.supplier}</td>
                    <td>{Number(p.quantity)} {p.measurement_unit}</td>
                    <td>{money(p.cost_per_unit)}</td>
                    <td className="font-medium">{money(p.total_cost)}</td>
                    <td>{methodLabel(p.payment_method)}</td>
                    <td className="text-xs">{p.reference_number ?? '—'}</td>
                    <td className="text-xs text-gray-500">{p.notes ?? '—'}</td>
                    <td>
                      <div className="flex gap-1">
                        <Button variant="ghost" className="!px-2 !py-1 text-xs" onClick={() => { setEdit(p); setShowForm(true); }}>Edit</Button>
                        <Button variant="ghost" className="!px-2 !py-1 text-xs text-red-600" onClick={async () => {
                          if (!window.confirm(`Delete purchase from ${p.supplier} of ${money(p.total_cost)}?`)) return;
                          try { await api.del(`/api/water/purchases/${p.id}`); toast('success', 'Purchase deleted.'); refresh(); }
                          catch (err) { toast('error', (err as Error).message); }
                        }}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.data.length === 0 && <div className="p-6"><EmptyState message="No water purchases recorded yet — add your first supply cost." /></div>}
          </div>
          <Pagination page={data.pagination.page} totalPages={data.pagination.totalPages} onChange={setPage} />
        </>
      )}

      {monthly && (
        <div className="mt-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-gray-700">Monthly supply cost vs water collected ({now.getFullYear()})</h2>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={monthly.map((r) => ({ month: r.monthName.slice(0, 3), 'Supply cost': r.waterSupplyCost, Collected: r.waterCollected }))}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v: any) => money(v)} />
              <Bar dataKey="Supply cost" fill="#f59e0b" />
              <Bar dataKey="Collected" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <PurchaseForm
        open={showForm}
        purchase={edit}
        onClose={() => setShowForm(false)}
        onSaved={(msg) => { setShowForm(false); refresh(); toast('success', msg); }}
      />
    </div>
  );
}

function PurchaseForm({ open, purchase, onClose, onSaved }: { open: boolean; purchase: Purchase | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const { toast } = useToast();
  const now = new Date();
  const [purchaseDate, setPurchaseDate] = useState(purchase?.purchase_date?.slice(0, 10) ?? now.toISOString().slice(0, 10));
  const [supplier, setSupplier] = useState(purchase?.supplier ?? '');
  const [quantity, setQuantity] = useState(purchase ? Number(purchase.quantity) : 0);
  const [measurementUnit, setMeasurementUnit] = useState(purchase?.measurement_unit ?? 'units');
  const [costPerUnit, setCostPerUnit] = useState(purchase ? Number(purchase.cost_per_unit) : 0);
  const [paymentMethod, setPaymentMethod] = useState(purchase?.payment_method ?? 'M_PESA');
  const [referenceNumber, setReferenceNumber] = useState(purchase?.reference_number ?? '');
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const totalCost = Math.round(quantity * costPerUnit * 100) / 100;

  async function save() {
    if (!supplier.trim()) { toast('error', 'Supplier is required.'); return; }
    if (quantity <= 0) { toast('error', 'Quantity must be greater than zero.'); return; }
    setBusy(true);
    try {
      const body = {
        purchaseDate, supplier: supplier.trim(), quantity, measurementUnit,
        costPerUnit, paymentMethod, referenceNumber: referenceNumber || undefined, notes: notes || undefined,
      };
      if (purchase) await api.put(`/api/water/purchases/${purchase.id}`, body);
      else await api.post('/api/water/purchases', body);
      onSaved(`Water purchase of ${money(totalCost)} from ${supplier.trim()} saved.`);
    } catch (err) {
      toast('error', (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={purchase ? 'Edit Water Purchase' : 'Record Water Purchase'} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Purchase Date"><TextInput type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} /></Field>
          <Field label="Supplier" hint={SUPPLIERS_HINT}><TextInput value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
          <Field label="Quantity"><TextInput type="number" min={0} step={0.5} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} /></Field>
          <Field label="Measurement Unit"><TextInput value={measurementUnit} onChange={(e) => setMeasurementUnit(e.target.value)} /></Field>
          <Field label="Cost per Unit (KSh)"><TextInput type="number" min={0} step={0.5} value={costPerUnit} onChange={(e) => setCostPerUnit(Number(e.target.value))} /></Field>
          <Field label="Payment Method">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
              <option value="CASH">Cash</option><option value="M_PESA">M-Pesa</option>
              <option value="BANK">Bank</option><option value="OTHER">Other</option>
            </Select>
          </Field>
          <Field label="Reference"><TextInput value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} /></Field>
          <Field label="Notes"><TextInput value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
        <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
          Total cost: <b>{money(totalCost)}</b> (quantity × cost per unit — calculated automatically).
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Purchase'}</Button>
        </div>
      </div>
    </Modal>
  );
}
