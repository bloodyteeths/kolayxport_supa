import React, { useState } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import {
  Users,
  ShoppingCart,
  Truck,
  TrendingUp,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Shield,
  Activity,
  UserCheck,
  Clock,
  AlertCircle,
  Check,
  X,
  Edit3,
  RotateCcw,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

const fetcher = (url: string) => fetch(url).then((r) => {
  if (r.status === 403) throw new Error('forbidden');
  if (!r.ok) throw new Error('error');
  return r.json();
});

function StatCard({ icon: Icon, label, value, sub, color }: any) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-start gap-4">
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  );
}

function PlanBadge({ plan }: { plan: string | null }) {
  const colors: Record<string, string> = {
    trial: 'bg-yellow-100 text-yellow-800',
    starter: 'bg-blue-100 text-blue-800',
    growth: 'bg-green-100 text-green-800',
    enterprise: 'bg-purple-100 text-purple-800',
    none: 'bg-gray-100 text-gray-600',
  };
  const p = plan || 'none';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[p] || colors.none}`}>
      {p}
    </span>
  );
}

function StatusBadge({ status }: { status: string | null }) {
  const colors: Record<string, string> = {
    active: 'bg-green-100 text-green-800',
    trialing: 'bg-yellow-100 text-yellow-800',
    past_due: 'bg-red-100 text-red-800',
    canceled: 'bg-gray-100 text-gray-600',
    none: 'bg-gray-100 text-gray-600',
  };
  const s = status || 'none';
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[s] || colors.none}`}>
      {s}
    </span>
  );
}

function SyncStatusBadge({ status }: { status: string }) {
  const color = status === 'success' ? 'text-green-600' : status === 'error' ? 'text-red-600' : 'text-yellow-600';
  return <span className={`text-xs font-medium ${color}`}>{status}</span>;
}

function EditUserModal({ user, onClose, onSaved }: any) {
  const t = useTranslations('admin');
  const [form, setForm] = useState({
    role: user.role || 'user',
    subscriptionPlan: user.subscriptionPlan || '',
    subscriptionStatus: user.subscriptionStatus || '',
    orderSyncCount: user.orderSyncCount || 0,
    labelCount: user.labelCount || 0,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error();
      toast.success(t('userUpdated'));
      onSaved();
      onClose();
    } catch {
      toast.error(t('error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">{t('editUser')}</h3>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X className="w-5 h-5" />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">{user.email}</p>

        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('role')}</label>
            <select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="user">{t('user')}</option>
              <option value="admin">{t('admin')}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('plan')}</label>
            <select
              value={form.subscriptionPlan}
              onChange={(e) => setForm({ ...form, subscriptionPlan: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('none')}</option>
              <option value="trial">{t('trial')}</option>
              <option value="starter">{t('starter')}</option>
              <option value="growth">{t('growth')}</option>
              <option value="enterprise">{t('enterprise')}</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('status')}</label>
            <select
              value={form.subscriptionStatus}
              onChange={(e) => setForm({ ...form, subscriptionStatus: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">{t('none')}</option>
              <option value="trialing">{t('trialing')}</option>
              <option value="active">{t('active')}</option>
              <option value="past_due">{t('pastDue')}</option>
              <option value="canceled">{t('canceled')}</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('syncCount')}</label>
              <input
                type="number"
                value={form.orderSyncCount}
                onChange={(e) => setForm({ ...form, orderSyncCount: parseInt(e.target.value) || 0 })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">{t('labelCount')}</label>
              <input
                type="number"
                value={form.labelCount}
                onChange={(e) => setForm({ ...form, labelCount: parseInt(e.target.value) || 0 })}
                className="w-full border rounded-lg px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg text-sm hover:bg-gray-50">
            {t('none') === 'None' ? 'Cancel' : 'İptal'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '...' : t('saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const t = useTranslations('admin');
  const router = useRouter();
  const { data, error, mutate, isLoading } = useSWR('/api/admin/dashboard', fetcher, {
    revalidateOnFocus: false,
  });
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'activity'>('overview');
  const [editingUser, setEditingUser] = useState<any>(null);
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  if (error?.message === 'forbidden') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Shield className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">{t('forbidden')}</h1>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900">{t('error')}</h1>
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  const { stats, usersByPlan, usersByStatus, ordersByMarketplace, recentSyncOps, users } = data;

  const resetUserUsage = async (userId: string) => {
    try {
      await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderSyncCount: 0,
          labelCount: 0,
          usageResetAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }),
      });
      toast.success(t('userUpdated'));
      mutate();
    } catch {
      toast.error(t('error'));
    }
  };

  const formatDate = (d: string | null) => {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatDateTime = (d: string | null) => {
    if (!d) return '-';
    return new Date(d).toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <>
      <Head>
        <title>{t('title')} | KolayXport</title>
      </Head>
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield className="w-6 h-6 text-blue-600" />
              <h1 className="text-xl font-bold text-gray-900">{t('title')}</h1>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => mutate()}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4 text-gray-600" />
              </button>
              <button
                onClick={() => router.push('/app')}
                className="px-3 py-1.5 text-sm bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                ← Dashboard
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white border-b">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1">
            {(['overview', 'users', 'activity'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700'
                }`}
              >
                {t(tab)}
              </button>
            ))}
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Stat Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <StatCard icon={Users} label={t('totalUsers')} value={stats.totalUsers} sub={`+${stats.recentUsers} (30d)`} color="bg-blue-500" />
                <StatCard icon={ShoppingCart} label={t('totalOrders')} value={stats.totalOrders.toLocaleString()} sub={`+${stats.recentOrders} (7d)`} color="bg-green-500" />
                <StatCard icon={Truck} label={t('totalShipments')} value={stats.totalShipments.toLocaleString()} color="bg-purple-500" />
                <StatCard icon={UserCheck} label={t('usersByPlan')} value={usersByPlan.length} color="bg-orange-500" />
                <StatCard icon={Activity} label={t('recentSyncs')} value={recentSyncOps.length} color="bg-cyan-500" />
              </div>

              {/* Distribution Cards */}
              <div className="grid md:grid-cols-3 gap-4">
                {/* By Plan */}
                <div className="bg-white rounded-xl border p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('usersByPlan')}</h3>
                  <div className="space-y-2">
                    {usersByPlan.map((g: any) => (
                      <div key={g.plan} className="flex items-center justify-between">
                        <PlanBadge plan={g.plan} />
                        <span className="text-sm font-bold text-gray-900">{g.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By Status */}
                <div className="bg-white rounded-xl border p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('usersByStatus')}</h3>
                  <div className="space-y-2">
                    {usersByStatus.map((g: any) => (
                      <div key={g.status} className="flex items-center justify-between">
                        <StatusBadge status={g.status} />
                        <span className="text-sm font-bold text-gray-900">{g.count}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* By Marketplace */}
                <div className="bg-white rounded-xl border p-5">
                  <h3 className="text-sm font-semibold text-gray-700 mb-3">{t('ordersByMarketplace')}</h3>
                  <div className="space-y-2">
                    {ordersByMarketplace.map((g: any) => (
                      <div key={g.marketplace} className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">{g.marketplace}</span>
                        <span className="text-sm font-bold text-gray-900">{g.count}</span>
                      </div>
                    ))}
                    {ordersByMarketplace.length === 0 && (
                      <p className="text-sm text-gray-400">{t('none')}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Users Tab */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">{t('userManagement')}</h2>

              {/* Desktop Table */}
              <div className="hidden md:block bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">{t('email')}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">{t('plan')}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">{t('status')}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">{t('role')}</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">{t('orders')}</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">{t('syncCount')}</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">{t('labelCount')}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">{t('joined')}</th>
                      <th className="text-center px-4 py-3 font-medium text-gray-600">{t('actions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {users.map((u: any) => (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-gray-900">{u.email || '-'}</p>
                            {u.name && <p className="text-xs text-gray-400">{u.name}</p>}
                          </div>
                        </td>
                        <td className="px-4 py-3"><PlanBadge plan={u.subscriptionPlan} /></td>
                        <td className="px-4 py-3"><StatusBadge status={u.subscriptionStatus} /></td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium ${u.role === 'admin' ? 'text-red-600' : 'text-gray-500'}`}>
                            {u.role || 'user'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">{u._count?.orders || 0}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{u.orderSyncCount}</td>
                        <td className="px-4 py-3 text-right text-gray-700">{u.labelCount}</td>
                        <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(u.createdAt)}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => setEditingUser(u)}
                              className="p-1.5 hover:bg-blue-50 rounded text-blue-600"
                              title={t('editUser')}
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => resetUserUsage(u.id)}
                              className="p-1.5 hover:bg-orange-50 rounded text-orange-600"
                              title={t('resetUsage')}
                            >
                              <RotateCcw className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {users.map((u: any) => (
                  <div key={u.id} className="bg-white rounded-xl border p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <p className="font-medium text-gray-900 text-sm">{u.email || '-'}</p>
                        {u.name && <p className="text-xs text-gray-400">{u.name}</p>}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => setEditingUser(u)} className="p-1.5 hover:bg-blue-50 rounded text-blue-600">
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button onClick={() => resetUserUsage(u.id)} className="p-1.5 hover:bg-orange-50 rounded text-orange-600">
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 mb-2">
                      <PlanBadge plan={u.subscriptionPlan} />
                      <StatusBadge status={u.subscriptionStatus} />
                      {u.role === 'admin' && (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">admin</span>
                      )}
                    </div>
                    <button
                      onClick={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
                      className="text-xs text-blue-600 flex items-center gap-1"
                    >
                      {expandedUser === u.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {expandedUser === u.id ? 'Less' : 'More'}
                    </button>
                    {expandedUser === u.id && (
                      <div className="mt-2 pt-2 border-t text-xs text-gray-600 space-y-1">
                        <p>{t('orders')}: <b>{u._count?.orders || 0}</b></p>
                        <p>{t('shops')}: <b>{u._count?.etsyShops || 0}</b></p>
                        <p>{t('syncCount')}: <b>{u.orderSyncCount}</b></p>
                        <p>{t('labelCount')}: <b>{u.labelCount}</b></p>
                        <p>{t('joined')}: <b>{formatDate(u.createdAt)}</b></p>
                        <p>{t('lastSync')}: <b>{formatDateTime(u.lastSyncedAt)}</b></p>
                        {u.trialExpiresAt && <p>{t('trialExpires')}: <b>{formatDate(u.trialExpiresAt)}</b></p>}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {users.length === 0 && (
                <div className="text-center py-12 text-gray-400">
                  <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                  <p>{t('noUsers')}</p>
                </div>
              )}
            </div>
          )}

          {/* Activity Tab */}
          {activeTab === 'activity' && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900">{t('recentSyncs')}</h2>

              {/* Desktop Table */}
              <div className="hidden md:block bg-white rounded-xl border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">{t('email')}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">{t('marketplace')}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">{t('syncStatus')}</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">{t('created')}</th>
                      <th className="text-right px-4 py-3 font-medium text-gray-600">{t('updated')}</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-600">{t('startedAt')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {recentSyncOps.map((op: any) => {
                      const m = typeof op.metrics === 'object' && op.metrics ? op.metrics : {};
                      return (
                        <tr key={op.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-700">{op.user?.email || '-'}</td>
                          <td className="px-4 py-3 text-gray-700">{op.type}</td>
                          <td className="px-4 py-3"><SyncStatusBadge status={op.status} /></td>
                          <td className="px-4 py-3 text-right text-gray-700">{m.created || m.ordersCreated || 0}</td>
                          <td className="px-4 py-3 text-right text-gray-700">{m.updated || m.ordersUpdated || 0}</td>
                          <td className="px-4 py-3 text-gray-500 text-xs">{formatDateTime(op.createdAt)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden space-y-3">
                {recentSyncOps.map((op: any) => {
                  const m = typeof op.metrics === 'object' && op.metrics ? op.metrics : {};
                  return (
                    <div key={op.id} className="bg-white rounded-xl border p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-900">{op.type}</span>
                        <SyncStatusBadge status={op.status} />
                      </div>
                      <p className="text-xs text-gray-500 mb-1">{op.user?.email || '-'}</p>
                      <div className="flex gap-4 text-xs text-gray-600">
                        <span>+{m.created || m.ordersCreated || 0} {t('created').toLowerCase()}</span>
                        <span>~{m.updated || m.ordersUpdated || 0} {t('updated').toLowerCase()}</span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">{formatDateTime(op.createdAt)}</p>
                    </div>
                  );
                })}
                {recentSyncOps.length === 0 && (
                  <div className="text-center py-8 text-gray-400">
                    <Activity className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">{t('none')}</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {editingUser && (
          <EditUserModal
            user={editingUser}
            onClose={() => setEditingUser(null)}
            onSaved={() => mutate()}
          />
        )}
      </div>
    </>
  );
}

export async function getStaticProps({ locale }: any) {
  return {
    props: {
      messages: (await import(`../../messages/${locale || 'tr'}.json`)).default,
    },
  };
}
