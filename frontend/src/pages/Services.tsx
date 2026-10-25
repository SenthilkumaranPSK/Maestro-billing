import { useState } from 'react';
import { Plus, Pencil, Trash2, ArrowUpDown, ChevronUp, ChevronDown, Check } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { servicesApi } from '@/api/services';
import { useToast } from '@/hooks/use-toast';
import type { Service } from '@/types';

const EMPTY: Partial<Service> = { name: '', isActive: true };

export default function ServicesPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Partial<Service> | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  // Rearrange mode reorders the FULL active list, so it forces search off
  // and inactive-hidden while on — see Products.tsx for the same reasoning.
  const [rearranging, setRearranging] = useState(false);

  const { data: services, isLoading } = useQuery({
    queryKey: ['services', search, showInactive],
    queryFn: () => servicesApi.list({ search, active: !showInactive }),
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Service>) => servicesApi.create(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); setEditing(null); toast({ title: 'Service created', variant: 'success' }); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Service> }) => servicesApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); setEditing(null); toast({ title: 'Service updated', variant: 'success' }); },
  });

  const deleteMutation = useMutation({
    mutationFn: servicesApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['services'] }); toast({ title: 'Service deactivated' }); },
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: number[]) => servicesApi.reorder(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['services'] }),
    onError: (err: Error) => toast({ title: 'Could not reorder', description: err.message, variant: 'destructive' }),
  });

  const moveService = (index: number, direction: -1 | 1) => {
    if (!services) return;
    const target = index + direction;
    if (target < 0 || target >= services.length) return;
    const ids = services.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderMutation.mutate(ids);
  };

  const toggleRearranging = () => {
    if (!rearranging) {
      setSearch('');
      setShowInactive(false);
    }
    setRearranging((r) => !r);
  };

  const handleSave = () => {
    if (!editing?.name?.trim()) { toast({ title: 'Name is required', variant: 'destructive' }); return; }
    if (isNew) createMutation.mutate(editing);
    else updateMutation.mutate({ id: editing.id!, data: editing });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Services</h2>
          <p className="text-sm text-muted-foreground">
            Reusable descriptions (e.g. "Wedding Videography") suggested when filling in Service Details on an A4 invoice.
          </p>
        </div>
        <Button onClick={() => { setEditing({ ...EMPTY }); setIsNew(true); }}>
          <Plus className="h-4 w-4 mr-1" /> Add Service
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex gap-3 items-center justify-between">
            <div className="flex gap-3 items-center">
              <Input
                placeholder="Search services…"
                className="w-72"
                value={search}
                disabled={rearranging}
                onChange={(e) => setSearch(e.target.value)}
              />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={showInactive} disabled={rearranging} onChange={(e) => setShowInactive(e.target.checked)} />
                Show inactive
              </label>
            </div>
            <Button variant={rearranging ? 'default' : 'outline'} size="sm" onClick={toggleRearranging}>
              {rearranging ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <ArrowUpDown className="h-3.5 w-3.5 mr-1.5" />}
              {rearranging ? 'Done' : 'Rearrange'}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full bg-white">
            <thead>
              <tr className="border-b bg-slate-50/80">
                {['Service Name', 'Status', 'Actions'].map((h) => (
                  <th key={h} className="text-left py-2.5 px-4 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="stagger-children">
              {isLoading && <tr><td colSpan={3} className="py-10 text-center text-sm text-muted-foreground">Loading…</td></tr>}
              {!isLoading && services?.length === 0 && <tr><td colSpan={3} className="py-10 text-center text-sm text-muted-foreground">No services found</td></tr>}
              {services?.map((s, i) => (
                <tr key={s.id} className="border-b last:border-b-0 hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-4 font-medium text-sm">{s.name}</td>
                  <td className="py-3 px-4">
                    <Badge variant={s.isActive ? 'success' : 'secondary'}>{s.isActive ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td className="py-3 px-4">
                    {rearranging ? (
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Move up"
                          disabled={i === 0 || reorderMutation.isPending}
                          onClick={() => moveService(i, -1)}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          title="Move down"
                          disabled={i === services.length - 1 || reorderMutation.isPending}
                          onClick={() => moveService(i, 1)}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditing(s); setIsNew(false); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => { if (confirm('Deactivate this service?')) deleteMutation.mutate(s.id); }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isNew ? 'Add Service' : 'Edit Service'}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Service Name *</Label>
                <Input
                  placeholder="e.g. Wedding Videography"
                  value={editing.name ?? ''}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              {!isNew && (
                <div className="flex items-center gap-2 pt-1.5">
                  <input
                    type="checkbox"
                    id="service-is-active"
                    checked={editing.isActive ?? false}
                    onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500 cursor-pointer"
                  />
                  <Label htmlFor="service-is-active" className="cursor-pointer">Active</Label>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={createMutation.isPending || updateMutation.isPending}>
              {isNew ? 'Create' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
