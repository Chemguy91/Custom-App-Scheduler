'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ApprovalRequest, CapacityRule, DayOff, Profile, Truck } from '@/lib/types'
import { format, parseISO } from 'date-fns'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS = [1, 2, 3, 4, 5]

export default function AdminPanel({ profile }: { profile: Profile }) {
  const supabase = createClient()
  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [capacityRules, setCapacityRules] = useState<CapacityRule[]>([])
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [daysOffRequests, setDaysOffRequests] = useState<DayOff[]>([])
  const [defaultCapacity, setDefaultCapacity] = useState('5')
  const [savingCapacity, setSavingCapacity] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'requests' | 'daysoff' | 'trucks' | 'capacity' | 'users' | 'settings'>('requests')
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [reqRes, profRes, rulesRes, trucksRes, daysOffRes, settingsRes] = await Promise.all([
      supabase
        .from('approval_requests')
        .select(`*, profiles!approval_requests_salesman_id_fkey(full_name)`)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('capacity_rules').select('*').order('created_at', { ascending: false }),
      supabase.from('trucks_with_details').select('*').order('name'),
      supabase.from('days_off').select(`*, profiles!days_off_applicator_id_fkey(full_name), trucks(name)`).order('date'),
      supabase.from('settings').select('value').eq('key', 'default_daily_capacity').single(),
    ])

    if (reqRes.data) {
      setRequests(reqRes.data.map((r: Record<string, unknown>) => ({
        ...r,
        salesman_name: (r.profiles as { full_name: string } | null)?.full_name ?? 'Unknown',
      })) as ApprovalRequest[])
    }
    if (profRes.data) setProfiles(profRes.data as Profile[])
    if (rulesRes.data) setCapacityRules(rulesRes.data as CapacityRule[])
    if (trucksRes.data) setTrucks(trucksRes.data as Truck[])
    if (daysOffRes.data) {
      setDaysOffRequests(daysOffRes.data.map((d: Record<string, unknown>) => ({
        ...d,
        applicator_name: (d.profiles as { full_name: string } | null)?.full_name ?? 'Unknown',
        truck_name: (d.trucks as { name: string } | null)?.name ?? null,
      })) as DayOff[])
    }
    if (settingsRes.data) setDefaultCapacity(settingsRes.data.value)
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleApprovalAction(req: ApprovalRequest, action: 'approved' | 'rejected', note?: string) {
    const supabaseClient = createClient()

    if (action === 'approved') {
      const { data: appt } = await supabaseClient
        .from('appointments')
        .insert({
          date: req.date,
          salesman_id: req.salesman_id,
          customer_name: req.customer_name,
          notes: req.notes,
          status: 'approved',
        })
        .select()
        .single()

      await supabaseClient
        .from('approval_requests')
        .update({
          status: 'approved',
          admin_note: note ?? null,
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
          appointment_id: appt?.id ?? null,
        })
        .eq('id', req.id)
    } else {
      await supabaseClient
        .from('approval_requests')
        .update({
          status: 'rejected',
          admin_note: note ?? null,
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', req.id)
    }
    fetchData()
  }

  async function saveDefaultCapacity() {
    setSavingCapacity(true)
    await supabase
      .from('settings')
      .update({ value: defaultCapacity })
      .eq('key', 'default_daily_capacity')
    setSavingCapacity(false)
  }

  async function deleteRule(id: string) {
    if (!confirm('Delete this capacity rule?')) return
    await supabase.from('capacity_rules').delete().eq('id', id)
    fetchData()
  }

  const pendingRequests = requests.filter(r => r.status === 'pending')
  const reviewedRequests = requests.filter(r => r.status !== 'pending')

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Admin Panel</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage requests, capacity rules, users, and settings</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 flex-wrap">
        {([
          { id: 'requests',  label: 'Requests' },
          { id: 'daysoff',   label: 'Days Off' },
          { id: 'trucks',    label: 'Trucks' },
          { id: 'capacity',  label: 'Capacity' },
          { id: 'users',     label: 'Users' },
          { id: 'settings',  label: 'Settings' },
        ] as const).map(tab => {
          const pending = tab.id === 'requests' ? pendingRequests.length
            : tab.id === 'daysoff' ? daysOffRequests.filter(d => d.status === 'pending').length
            : 0
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {pending > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">{pending}</span>
              )}
            </button>
          )
        })}
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : (
        <>
          {/* REQUESTS TAB */}
          {activeTab === 'requests' && (
            <div className="space-y-4">
              {pendingRequests.length === 0 && (
                <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-200">
                  No pending approval requests
                </div>
              )}
              {pendingRequests.map(req => (
                <RequestCard key={req.id} req={req} onAction={handleApprovalAction} />
              ))}
              {reviewedRequests.length > 0 && (
                <>
                  <h3 className="text-sm font-medium text-gray-500 pt-2">Previously reviewed</h3>
                  {reviewedRequests.map(req => (
                    <RequestCard key={req.id} req={req} onAction={handleApprovalAction} readonly />
                  ))}
                </>
              )}
            </div>
          )}

          {/* DAYS OFF TAB */}
          {activeTab === 'daysoff' && (
            <DaysOffTab
              requests={daysOffRequests}
              adminId={profile.id}
              supabase={supabase}
              onRefresh={fetchData}
            />
          )}

          {/* TRUCKS TAB */}
          {activeTab === 'trucks' && (
            <TrucksTab
              trucks={trucks}
              profiles={profiles}
              adminId={profile.id}
              supabase={supabase}
              onRefresh={fetchData}
            />
          )}

          {/* CAPACITY TAB */}
          {activeTab === 'capacity' && (
            <div className="space-y-6">
              {/* Create new rule */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Add Capacity Rule</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Set how many applications are allowed per day within a date range. The most recently created rule wins if ranges overlap.
                </p>
                <CapacityRuleForm
                  adminId={profile.id}
                  supabase={supabase}
                  onSaved={fetchData}
                />
              </div>

              {/* Existing rules */}
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Active Rules</h3>
                {capacityRules.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 bg-white rounded-xl border border-gray-200">
                    No rules yet — the default capacity applies to all weekdays.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {capacityRules.map(rule => (
                      <div key={rule.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                        {editingRuleId === rule.id ? (
                          <div className="p-4">
                            <p className="text-sm font-semibold text-gray-700 mb-3">Editing rule</p>
                            <CapacityRuleForm
                              adminId={profile.id}
                              supabase={supabase}
                              existingRule={rule}
                              onSaved={() => { setEditingRuleId(null); fetchData() }}
                              onCancel={() => setEditingRuleId(null)}
                            />
                          </div>
                        ) : (
                          <div className="p-4 flex items-start justify-between gap-4">
                            <div>
                              {rule.name && (
                                <p className="font-medium text-gray-900 mb-1">{rule.name}</p>
                              )}
                              <p className="text-sm text-gray-700">
                                <span className="font-medium">{format(parseISO(rule.start_date), 'MMM d, yyyy')}</span>
                                {' → '}
                                <span className="font-medium">{format(parseISO(rule.end_date), 'MMM d, yyyy')}</span>
                              </p>
                              <div className="flex items-center gap-2 mt-2 flex-wrap">
                                <div className="flex gap-1">
                                  {[0,1,2,3,4,5,6].map(d => (
                                    <span
                                      key={d}
                                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                        rule.days_of_week.includes(d)
                                          ? 'bg-blue-100 text-blue-700'
                                          : 'bg-gray-100 text-gray-400'
                                      }`}
                                    >
                                      {DAY_LABELS[d]}
                                    </span>
                                  ))}
                                </div>
                                <span className="text-sm font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                                  {rule.max_applications} application{rule.max_applications !== 1 ? 's' : ''}/day
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 shrink-0">
                              <button
                                onClick={() => setEditingRuleId(rule.id)}
                                className="text-blue-500 hover:text-blue-700 text-sm font-medium"
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => deleteRule(rule.id)}
                                className="text-red-400 hover:text-red-600 text-sm"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Default fallback */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Default (Fallback) Capacity</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Used on any weekday not covered by a rule above. Weekends not in any rule require admin approval.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={defaultCapacity}
                    onChange={e => setDefaultCapacity(e.target.value)}
                    className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <span className="text-sm text-gray-500">applications per day</span>
                  <button
                    onClick={saveDefaultCapacity}
                    disabled={savingCapacity}
                    className="ml-auto bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                  >
                    {savingCapacity ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Role</th>
                      <th className="text-left px-4 py-3 font-medium text-gray-500">Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profiles.map(p => (
                      <tr key={p.id} className="border-b border-gray-50 last:border-0">
                        <td className="px-4 py-3 font-medium text-gray-900">{p.full_name}</td>
                        <td className="px-4 py-3">
                          {p.id === profile.id ? (
                            <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
                              Admin (you)
                            </span>
                          ) : (
                            <RoleSelect
                              userId={p.id}
                              currentRole={p.role}
                              supabase={supabase}
                              onChanged={fetchData}
                            />
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {format(parseISO(p.created_at), 'MMM d, yyyy')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <AddUserForm onSuccess={fetchData} />
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Override Capacity for a Specific Date</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Set an exact application count for one specific date — overrides all rules.
                </p>
                <CapacityOverride supabase={supabase} adminId={profile.id} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ─── Add User Form ────────────────────────────────────────────────────────────

function AddUserForm({ onSuccess }: { onSuccess: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole]         = useState('sales_manager')
  const [saving, setSaving]     = useState(false)
  const [msg, setMsg]           = useState('')
  const [isError, setIsError]   = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setMsg(''); setIsError(false)

    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, full_name: fullName, role }),
    })
    const data = await res.json()
    setSaving(false)

    if (!res.ok) {
      setIsError(true)
      setMsg(data.error ?? 'Something went wrong.')
    } else {
      setMsg(`${fullName} added successfully!`)
      setFullName(''); setEmail(''); setPassword(''); setRole('sales_manager')
      onSuccess()
      setTimeout(() => setMsg(''), 3000)
    }
  }

  const ROLE_DESCRIPTIONS: Record<string, string> = {
    sales_manager: 'Can schedule and edit their own appointments',
    applicator:    'Can view calendar and request days off',
    viewer:        'Read-only access to the calendar',
    admin:         'Full access to everything',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-900 mb-4">Add New User</h3>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Full Name</label>
          <input
            type="text"
            required
            value={fullName}
            onChange={e => setFullName(e.target.value)}
            placeholder="John Smith"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="john@example.com"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Temporary Password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Min. 6 characters"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="sales_manager">Sales Manager</option>
            <option value="applicator">Applicator</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">{ROLE_DESCRIPTIONS[role]}</p>
        </div>

        {msg && (
          <p className={`text-sm rounded-lg px-3 py-2 ${isError ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
            {msg}
          </p>
        )}

        <button
          type="submit"
          disabled={saving}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          {saving ? 'Creating user…' : 'Add User'}
        </button>
      </form>
    </div>
  )
}

// ─── Role Select ─────────────────────────────────────────────────────────────

function RoleSelect({
  userId,
  currentRole,
  supabase,
  onChanged,
}: {
  userId: string
  currentRole: string
  supabase: ReturnType<typeof createClient>
  onChanged: () => void
}) {
  const [role, setRole] = useState(currentRole)
  const [saving, setSaving] = useState(false)

  const ROLE_COLORS: Record<string, string> = {
    admin:         'bg-purple-100 text-purple-700 border-purple-200',
    sales_manager: 'bg-blue-100 text-blue-700 border-blue-200',
    applicator:    'bg-green-100 text-green-700 border-green-200',
    viewer:        'bg-gray-100 text-gray-600 border-gray-200',
  }

  async function handleChange(newRole: string) {
    setRole(newRole)
    setSaving(true)
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId)
    setSaving(false)
    onChanged()
  }

  return (
    <select
      value={role}
      onChange={e => handleChange(e.target.value)}
      disabled={saving}
      className={`text-xs font-medium rounded-full px-2 py-0.5 border cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500 ${ROLE_COLORS[role] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}
    >
      <option value="sales_manager">Sales Manager</option>
      <option value="applicator">Applicator</option>
      <option value="viewer">Viewer</option>
      <option value="admin">Admin</option>
    </select>
  )
}

// ─── Days Off Tab ─────────────────────────────────────────────────────────────

function DaysOffTab({
  requests,
  adminId,
  supabase,
  onRefresh,
}: {
  requests: DayOff[]
  adminId: string
  supabase: ReturnType<typeof createClient>
  onRefresh: () => void
}) {
  const [note, setNote] = useState<Record<string, string>>({})
  const pending  = requests.filter(r => r.status === 'pending')
  const reviewed = requests.filter(r => r.status !== 'pending')

  async function respond(id: string, status: 'approved' | 'rejected') {
    await supabase.from('days_off').update({
      status,
      admin_note: note[id] || null,
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
    }).eq('id', id)
    onRefresh()
  }

  return (
    <div className="space-y-4">
      {pending.length === 0 && (
        <div className="text-center py-12 text-gray-400 bg-white rounded-xl border border-gray-200">
          No pending day-off requests
        </div>
      )}
      {pending.map(req => (
        <div key={req.id} className="bg-white rounded-xl border border-yellow-200 p-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="font-medium text-gray-900">{req.applicator_name}</p>
              <p className="text-sm text-gray-500">
                {format(parseISO(req.date), 'EEE, MMM d, yyyy')}
                {req.truck_name && <span className="ml-2 text-blue-600">· {req.truck_name}</span>}
              </p>
              {req.reason && <p className="text-sm text-gray-600 mt-1">{req.reason}</p>}
            </div>
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-medium">Pending</span>
          </div>
          <input
            type="text"
            placeholder="Optional note to applicator…"
            value={note[req.id] ?? ''}
            onChange={e => setNote(prev => ({ ...prev, [req.id]: e.target.value }))}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button onClick={() => respond(req.id, 'rejected')} className="flex-1 border border-gray-200 text-gray-700 text-sm font-medium py-1.5 rounded-lg hover:bg-gray-50 transition-colors">Deny</button>
            <button onClick={() => respond(req.id, 'approved')} className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-1.5 rounded-lg transition-colors">Approve</button>
          </div>
        </div>
      ))}

      {reviewed.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-gray-500 pt-2">Previously reviewed</h3>
          {reviewed.map(req => (
            <div key={req.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between">
              <div>
                <p className="font-medium text-gray-900">{req.applicator_name}</p>
                <p className="text-sm text-gray-500">
                  {format(parseISO(req.date), 'EEE, MMM d, yyyy')}
                  {req.truck_name && <span className="ml-2 text-blue-600">· {req.truck_name}</span>}
                </p>
                {req.reason && <p className="text-sm text-gray-600 mt-1">{req.reason}</p>}
                {req.admin_note && <p className="text-xs text-gray-400 italic mt-1">Note: {req.admin_note}</p>}
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                req.status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>{req.status}</span>
            </div>
          ))}
        </>
      )}
    </div>
  )
}

// ─── Trucks Tab ───────────────────────────────────────────────────────────────

function TrucksTab({
  trucks,
  profiles,
  adminId,
  supabase,
  onRefresh,
}: {
  trucks: Truck[]
  profiles: Profile[]
  adminId: string
  supabase: ReturnType<typeof createClient>
  onRefresh: () => void
}) {
  const [name, setName]           = useState('')
  const [applicatorId, setApplicatorId] = useState('')
  const [activeFrom, setActiveFrom] = useState('')
  const [activeTo, setActiveTo]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)

  const applicators = profiles.filter(p => p.role === 'applicator')

  async function saveTruck() {
    if (!name) { setMsg('Truck name is required.'); return }
    setSaving(true); setMsg('')
    const payload = {
      name,
      applicator_id: applicatorId || null,
      active_from: activeFrom || null,
      active_to: activeTo || null,
    }
    let error
    if (editingId) {
      const res = await supabase.from('trucks').update(payload).eq('id', editingId)
      error = res.error
    } else {
      const res = await supabase.from('trucks').insert({ ...payload, created_by: adminId })
      error = res.error
    }
    setSaving(false)
    if (error) { setMsg(`Error: ${error.message}`); return }
    setName(''); setApplicatorId(''); setActiveFrom(''); setActiveTo(''); setEditingId(null)
    setMsg(editingId ? 'Updated!' : 'Truck added!')
    onRefresh()
    setTimeout(() => setMsg(''), 2000)
  }

  function startEdit(t: Truck) {
    setEditingId(t.id)
    setName(t.name)
    setApplicatorId(t.applicator_id ?? '')
    setActiveFrom(t.active_from ?? '')
    setActiveTo(t.active_to ?? '')
  }

  async function deleteTruck(id: string) {
    if (!confirm('Delete this truck?')) return
    await supabase.from('trucks').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div className="space-y-6">
      {/* Form */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4">{editingId ? 'Edit Truck' : 'Add Truck'}</h3>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Truck Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder='e.g. "Truck 1" or "Blue Kenworth"'
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Assigned Applicator</label>
            <select
              value={applicatorId}
              onChange={e => setApplicatorId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— Unassigned —</option>
              {applicators.map(p => (
                <option key={p.id} value={p.id}>{p.full_name}</option>
              ))}
            </select>
            {applicators.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">No applicators yet. Add users with the "applicator" role first.</p>
            )}
          </div>

          <div className="flex gap-3 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Available From</label>
              <input
                type="date"
                value={activeFrom}
                onChange={e => setActiveFrom(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Available To</label>
              <input
                type="date"
                value={activeTo}
                onChange={e => setActiveTo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {msg && <p className={`text-sm ${msg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>{msg}</p>}

          <div className="flex gap-2">
            {editingId && (
              <button
                onClick={() => { setEditingId(null); setName(''); setApplicatorId(''); setActiveFrom(''); setActiveTo('') }}
                className="border border-gray-200 text-gray-600 text-sm font-medium px-4 py-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={saveTruck}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
            >
              {saving ? 'Saving…' : editingId ? 'Update Truck' : 'Add Truck'}
            </button>
          </div>
        </div>
      </div>

      {/* Truck list */}
      <div>
        <h3 className="font-semibold text-gray-900 mb-3">All Trucks</h3>
        {trucks.length === 0 ? (
          <div className="text-center py-8 text-gray-400 bg-white rounded-xl border border-gray-200">
            No trucks yet — add one above.
          </div>
        ) : (
          <div className="space-y-2">
            {trucks.map(t => (
              <div key={t.id} className="bg-white rounded-xl border border-gray-200 p-4 flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium text-gray-900">{t.name}</p>
                  <p className="text-sm text-gray-500 mt-0.5">
                    {t.applicator_name ? `Assigned: ${t.applicator_name}` : 'Unassigned'}
                  </p>
                  {(t.active_from || t.active_to) && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      Available: {t.active_from ? format(parseISO(t.active_from), 'MMM d, yyyy') : 'always'}
                      {' → '}
                      {t.active_to ? format(parseISO(t.active_to), 'MMM d, yyyy') : 'no end'}
                    </p>
                  )}
                </div>
                <div className="flex gap-3 shrink-0">
                  <button onClick={() => startEdit(t)} className="text-blue-500 hover:text-blue-700 text-sm font-medium">Edit</button>
                  <button onClick={() => deleteTruck(t.id)} className="text-red-400 hover:text-red-600 text-sm">Delete</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Capacity Rule Form ───────────────────────────────────────────────────────

function CapacityRuleForm({
  adminId,
  supabase,
  existingRule,
  onSaved,
  onCancel,
}: {
  adminId: string
  supabase: ReturnType<typeof createClient>
  existingRule?: CapacityRule
  onSaved: () => void
  onCancel?: () => void
}) {
  const isEditing = !!existingRule
  const [name, setName] = useState(existingRule?.name ?? '')
  const [startDate, setStartDate] = useState(existingRule?.start_date ?? '')
  const [endDate, setEndDate] = useState(existingRule?.end_date ?? '')
  const [selectedDays, setSelectedDays] = useState<number[]>(existingRule?.days_of_week ?? [...WEEKDAYS])
  const [maxApps, setMaxApps] = useState(existingRule?.max_applications ?? 2)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  function toggleDay(day: number) {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  function setPreset(preset: 'weekdays' | 'weekends' | 'all') {
    if (preset === 'weekdays') setSelectedDays([1, 2, 3, 4, 5])
    if (preset === 'weekends') setSelectedDays([0, 6])
    if (preset === 'all') setSelectedDays([0, 1, 2, 3, 4, 5, 6])
  }

  async function save() {
    if (!startDate || !endDate || selectedDays.length === 0) {
      setMsg('Please fill in all fields and select at least one day.')
      return
    }
    setSaving(true)
    setMsg('')

    let error
    if (isEditing && existingRule) {
      // Update existing rule — bump created_at so it becomes the newest (highest priority)
      const result = await supabase
        .from('capacity_rules')
        .update({
          name: name || null,
          start_date: startDate,
          end_date: endDate,
          days_of_week: selectedDays,
          max_applications: maxApps,
          created_at: new Date().toISOString(),
        })
        .eq('id', existingRule.id)
      error = result.error
    } else {
      const result = await supabase.from('capacity_rules').insert({
        name: name || null,
        start_date: startDate,
        end_date: endDate,
        days_of_week: selectedDays,
        max_applications: maxApps,
        created_by: adminId,
      })
      error = result.error
    }

    setSaving(false)
    if (error) {
      setMsg(`Error: ${error.message}`)
    } else {
      setMsg('Rule saved!')
      if (!isEditing) {
        setName('')
        setStartDate('')
        setEndDate('')
        setSelectedDays([...WEEKDAYS])
        setMaxApps(2)
      }
      onSaved()
      setTimeout(() => setMsg(''), 2000)
    }
  }

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">
          Rule Name <span className="text-gray-400">(optional)</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder='e.g. "Summer 2026"'
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Date range */}
      <div className="flex gap-3 flex-wrap">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Days of week */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-gray-600">Days of Week</label>
          <div className="flex gap-2">
            {(['weekdays', 'weekends', 'all'] as const).map(p => (
              <button
                key={p}
                type="button"
                onClick={() => setPreset(p)}
                className="text-xs text-blue-600 hover:underline capitalize"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex gap-2">
          {[0,1,2,3,4,5,6].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => toggleDay(d)}
              className={`w-10 h-10 rounded-lg text-xs font-medium transition-colors ${
                selectedDays.includes(d)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {DAY_LABELS[d]}
            </button>
          ))}
        </div>
      </div>

      {/* Max applications */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">
          Max Applications Per Day
        </label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMaxApps(n => Math.max(0, n - 1))}
              className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-lg flex items-center justify-center"
            >
              −
            </button>
            <span className="w-8 text-center font-semibold text-gray-900 text-lg">{maxApps}</span>
            <button
              type="button"
              onClick={() => setMaxApps(n => Math.min(50, n + 1))}
              className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-lg flex items-center justify-center"
            >
              +
            </button>
          </div>
          {/* Quick select buttons */}
          <div className="flex gap-1 ml-2">
            {[1,2,3,4,5,6,8,10].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setMaxApps(n)}
                className={`w-7 h-7 rounded text-xs font-medium transition-colors ${
                  maxApps === n
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {msg && (
        <p className={`text-sm ${msg.startsWith('Error') ? 'text-red-600' : 'text-green-600'}`}>
          {msg}
        </p>
      )}

      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="border border-gray-200 text-gray-600 font-medium px-5 py-2 rounded-lg text-sm hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          onClick={save}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium px-5 py-2 rounded-lg text-sm transition-colors"
        >
          {saving ? 'Saving…' : isEditing ? 'Update Rule' : 'Save Rule'}
        </button>
      </div>
    </div>
  )
}

// ─── Request Card ─────────────────────────────────────────────────────────────

function RequestCard({
  req,
  onAction,
  readonly = false,
}: {
  req: ApprovalRequest
  onAction: (req: ApprovalRequest, action: 'approved' | 'rejected', note?: string) => void
  readonly?: boolean
}) {
  const [note, setNote] = useState('')

  return (
    <div className={`bg-white rounded-xl border p-4 ${
      req.status === 'pending' ? 'border-yellow-200' : 'border-gray-200'
    }`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium text-gray-900">{req.customer_name}</p>
          <p className="text-sm text-gray-500">
            {req.salesman_name} · {format(parseISO(req.date), 'EEE, MMM d, yyyy')}
          </p>
          {req.notes && <p className="text-sm text-gray-600 mt-1">{req.notes}</p>}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
          req.status === 'pending'
            ? 'bg-yellow-100 text-yellow-700'
            : req.status === 'approved'
            ? 'bg-green-100 text-green-700'
            : 'bg-red-100 text-red-700'
        }`}>
          {req.status}
        </span>
      </div>

      {!readonly && req.status === 'pending' && (
        <div className="mt-3 space-y-2">
          <input
            type="text"
            placeholder="Optional note to salesman…"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => onAction(req, 'rejected', note)}
              className="flex-1 border border-gray-200 text-gray-700 text-sm font-medium py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Decline
            </button>
            <button
              onClick={() => onAction(req, 'approved', note)}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-1.5 rounded-lg transition-colors"
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {req.admin_note && (
        <p className="mt-2 text-xs text-gray-500 italic">Admin note: {req.admin_note}</p>
      )}
    </div>
  )
}

// ─── Capacity Override (exact date) ──────────────────────────────────────────

function CapacityOverride({ supabase, adminId }: { supabase: ReturnType<typeof createClient>, adminId: string }) {
  const [date, setDate] = useState('')
  const [max, setMax] = useState('5')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  async function save() {
    if (!date) return
    setSaving(true)
    setMsg('')
    const { error } = await supabase
      .from('daily_capacity')
      .upsert({ date, max_trucks: parseInt(max), set_by: adminId }, { onConflict: 'date' })
    setSaving(false)
    setMsg(error ? `Error: ${error.message}` : `Saved: ${date} → ${max} applications`)
    if (!error) { setDate(''); setMax('5') }
  }

  return (
    <div className="flex items-end gap-3 flex-wrap">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Max Applications</label>
        <input
          type="number"
          min={0}
          max={50}
          value={max}
          onChange={e => setMax(e.target.value)}
          className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>
      <button
        onClick={save}
        disabled={saving || !date}
        className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
      >
        {saving ? 'Saving…' : 'Set override'}
      </button>
      {msg && <p className="text-sm text-gray-600 w-full">{msg}</p>}
    </div>
  )
}
