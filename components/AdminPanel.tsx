'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ApprovalRequest, BlackoutDay, CapacityRule, Profile, Truck } from '@/lib/types'
import { format, parseISO } from 'date-fns'
import { useDemoProfile, useDemoPersonas } from './DemoWrapper'

// Safe date formatter — returns '—' for null/empty/invalid dates instead of throwing
function safeDate(d: string | null | undefined, fmt: string): string {
  if (!d) return '—'
  try { return format(parseISO(d), fmt) } catch { return '—' }
}

const ALL_PRODUCTS = ['Smart Block', '1,4 Zap', 'DMN', 'Storox / Perox AG', 'Purogene Pro', 'CIPC', 'Amplify', 'Fresh Pack 100']

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const WEEKDAYS = [1, 2, 3, 4, 5]

export default function AdminPanel({ profile: serverProfile }: { profile: Profile }) {
  const profile = useDemoProfile(serverProfile)
  const supabase = createClient()
  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [capacityRules, setCapacityRules] = useState<CapacityRule[]>([])
  const [trucks, setTrucks] = useState<Truck[]>([])
  const [blackoutDays, setBlackoutDays] = useState<BlackoutDay[]>([])
  const [defaultCapacity, setDefaultCapacity] = useState('5')
  const [savingCapacity, setSavingCapacity] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'requests' | 'trucks' | 'capacity' | 'users' | 'settings' | 'demo'>('requests')
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null)
  const [newAlert, setNewAlert]           = useState<{ count: number; name: string } | null>(null)
  const alertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Ask for browser notification permission once
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [reqRes, profRes, rulesRes, trucksRes, blackoutRes, settingsRes] = await Promise.all([
      supabase
        .from('approval_requests')
        .select(`*, profiles!approval_requests_salesman_id_fkey(full_name)`)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('capacity_rules').select('*').order('created_at', { ascending: false }),
      supabase.from('trucks_with_details').select('*').order('name'),
      supabase.from('blackout_days').select('*').order('date'),
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
    if (blackoutRes?.data) setBlackoutDays(blackoutRes.data as BlackoutDay[])
    if (settingsRes.data) setDefaultCapacity(settingsRes.data.value)
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  // Supabase Realtime — notify admin instantly when a salesman submits a request
  useEffect(() => {
    const channel = supabase
      .channel('admin_new_requests')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'approval_requests' },
        (payload) => {
          const req = payload.new as { status: string; customer_name: string; job_type: string }
          if (req.status !== 'pending') return

          const label = req.customer_name ?? 'Unknown customer'
          const isDisinfect = req.job_type === 'stg_disinfect'
          const body = isDisinfect ? `${label} · Stg Disinfect` : label

          // OS-level browser notification
          if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('New Approval Request', { body, icon: '/favicon.ico' })
          }

          // In-app alert toast
          setNewAlert(prev => ({ count: (prev?.count ?? 0) + 1, name: label }))
          if (alertTimerRef.current) clearTimeout(alertTimerRef.current)
          alertTimerRef.current = setTimeout(() => setNewAlert(null), 10_000)

          // Pull fresh data so the badge + list update immediately
          fetchData()
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [supabase, fetchData])

  async function handleApprovalAction(
    req: ApprovalRequest,
    action: 'approved' | 'rejected',
    note?: string,
    deductSlots?: number,
  ) {
    const supabaseClient = createClient()

    if (action === 'approved') {
      // slot_count on the appointment IS the capacity usage.
      // We store the admin's chosen deductSlots directly on the appointment
      // so that deleting it automatically restores capacity — no daily_capacity
      // override needed (which would persist after deletion).
      const slotCount = deductSlots ?? (req.job_type === 'stg_disinfect' ? 0 : 1)

      const { data: appt, error: apptError } = await supabaseClient
        .from('appointments')
        .insert({
          date:             req.date,
          salesman_id:      req.salesman_id,
          job_type:         req.job_type ?? 'application',
          customer_name:    req.customer_name,
          storage_name:     req.storage_name ?? null,
          storage_capacity: req.storage_capacity ?? null,
          notes:            req.notes,
          products:         [],
          status:           'approved',
          slot_count:       slotCount,
        })
        .select()
        .single()

      if (apptError) {
        console.error('Failed to create appointment on approval:', apptError)
      }

      await supabaseClient
        .from('approval_requests')
        .update({
          status:         'approved',
          admin_note:     note ?? null,
          reviewed_by:    profile.id,
          reviewed_at:    new Date().toISOString(),
          appointment_id: appt?.id ?? null,
        })
        .eq('id', req.id)
    } else {
      await supabaseClient
        .from('approval_requests')
        .update({
          status:      'rejected',
          admin_note:  note ?? null,
          reviewed_by: profile.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', req.id)
    }
    fetchData()
  }

  // Retroactively create the calendar appointment for an already-approved request
  // whose insert previously failed (e.g. before the RLS fix was deployed).
  async function fixMissingAppointment(req: ApprovalRequest) {
    const supabaseClient = createClient()
    const { data: appt, error } = await supabaseClient
      .from('appointments')
      .insert({
        date:             req.date,
        salesman_id:      req.salesman_id,
        job_type:         req.job_type ?? 'application',
        customer_name:    req.customer_name,
        storage_name:     req.storage_name ?? null,
        storage_capacity: req.storage_capacity ?? null,
        notes:            req.notes,
        products:         [],
        status:           'approved',
        slot_count:       req.job_type === 'stg_disinfect' ? 0 : 1,
      })
      .select()
      .single()

    if (!error && appt) {
      await supabaseClient
        .from('approval_requests')
        .update({ appointment_id: appt.id })
        .eq('id', req.id)
      fetchData()
    } else {
      console.error('Fix failed:', error)
      alert('Failed to add to calendar: ' + error?.message)
    }
  }

  async function deductDailySlots(
    supabaseClient: ReturnType<typeof createClient>,
    date: string,
    adminId: string,
    count: number,
  ) {
    // 1. Check for an existing exact-date override
    const { data: existing } = await supabaseClient
      .from('daily_capacity')
      .select('max_trucks')
      .eq('date', date)
      .single()

    if (existing) {
      await supabaseClient
        .from('daily_capacity')
        .update({ max_trucks: Math.max(0, existing.max_trucks - count), set_by: adminId })
        .eq('date', date)
      return
    }

    // 2. Resolve current effective max from rules / default
    const [rulesRes, settingsRes] = await Promise.all([
      supabaseClient.from('capacity_rules').select('*'),
      supabaseClient.from('settings').select('value').eq('key', 'default_daily_capacity').single(),
    ])

    const rules = (rulesRes.data ?? []) as { start_date: string; end_date: string; days_of_week: number[]; max_applications: number; created_at: string }[]
    const defaultMax = parseInt((settingsRes.data as { value: string } | null)?.value ?? '5')

    const dayOfWeek = new Date(date + 'T12:00:00').getDay()
    const covering = rules
      .filter(r => r.start_date <= date && r.end_date >= date)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    let currentMax = defaultMax
    if (covering.length > 0 && covering[0].days_of_week.includes(dayOfWeek)) {
      currentMax = covering[0].max_applications
    }

    // 3. Insert override with currentMax - count
    await supabaseClient.from('daily_capacity').insert({
      date,
      max_trucks: Math.max(0, currentMax - count),
      set_by: adminId,
    })
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

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Admin Panel</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Manage requests, capacity rules, users, and settings</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 flex-wrap">
        {([
          { id: 'requests',  label: 'Requests' },
          { id: 'trucks',    label: 'Trucks' },
          { id: 'capacity',  label: 'Capacity' },
          { id: 'users',     label: 'Users' },
          { id: 'settings',  label: 'Settings' },
          { id: 'demo',      label: '🎯 Demo Mode' },
        ] as const).map(tab => {
          const pending = tab.id === 'requests' ? pendingRequests.length : 0
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
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
            </div>
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
                  trucks={trucks}
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
                              trucks={trucks}
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
                                <span className="font-medium">{safeDate(rule.start_date, 'MMM d, yyyy')}</span>
                                {' → '}
                                <span className="font-medium">{safeDate(rule.end_date, 'MMM d, yyyy')}</span>
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
                                {rule.truck_ids && rule.truck_ids.length > 0 && (
                                  <span className="text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                                    {rule.truck_ids.length === 1
                                      ? `1 truck: ${trucks.find(t => t.id === rule.truck_ids![0])?.name ?? '?'}`
                                      : `${rule.truck_ids.length} trucks: ${rule.truck_ids.map(id => trucks.find(t => t.id === id)?.name ?? '?').join(', ')}`
                                    }
                                  </span>
                                )}
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

              {/* Blackout Days */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Blackout Days</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Block specific dates for holidays or closures. Salesmen cannot schedule applications on blacked-out days.
                </p>
                <BlackoutDaysManager
                  supabase={supabase}
                  adminId={profile.id}
                  blackoutDays={blackoutDays}
                  onRefresh={fetchData}
                />
              </div>
            </div>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <UsersTab
              profiles={profiles}
              currentUserId={profile.id}
              supabase={supabase}
              onRefresh={fetchData}
            />
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

          {/* DEMO MODE TAB */}
          {activeTab === 'demo' && (
            <DemoModeTab supabase={supabase} adminId={profile.id} profiles={profiles} trucks={trucks} />
          )}


        </>
      )}

      {/* ── New-request toast ── */}
      {newAlert && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 bg-gray-900 text-white rounded-xl px-4 py-3 shadow-2xl">
          <div>
            <p className="text-sm font-semibold leading-tight">
              {newAlert.count === 1 ? 'New approval request' : `${newAlert.count} new requests`}
            </p>
            <p className="text-xs text-gray-300 mt-0.5 truncate max-w-[200px]">{newAlert.name}</p>
          </div>
          <button
            onClick={() => { setActiveTab('requests'); setNewAlert(null) }}
            className="shrink-0 bg-white text-gray-900 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            View
          </button>
          <button
            onClick={() => setNewAlert(null)}
            className="shrink-0 text-gray-400 hover:text-white text-xl leading-none"
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Users Tab ────────────────────────────────────────────────────────────────

const ROLE_LABELS_MAP: Record<string, string> = {
  admin:         'Admin',
  sales_manager: 'Account Manager',
  applicator:    'Applicator',
  viewer:        'Viewer',
}

const ROLE_COLORS_MAP: Record<string, string> = {
  admin:         'bg-purple-100 text-purple-700',
  sales_manager: 'bg-blue-100 text-blue-700',
  applicator:    'bg-green-100 text-green-700',
  viewer:        'bg-gray-100 text-gray-600',
}

function UsersTab({
  profiles,
  currentUserId,
  supabase,
  onRefresh,
}: {
  profiles: Profile[]
  currentUserId: string
  supabase: ReturnType<typeof createClient>
  onRefresh: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName]   = useState('')
  const [editRole, setEditRole]   = useState('')
  const [editPass, setEditPass]   = useState('')
  const [saving, setSaving]       = useState(false)
  const [msg, setMsg]             = useState('')
  const [isError, setIsError]     = useState(false)

  function startEdit(p: Profile) {
    setEditingId(p.id)
    setEditName(p.full_name)
    setEditRole(p.role)
    setEditPass('')
    setMsg('')
  }

  function cancelEdit() {
    setEditingId(null)
    setMsg('')
  }

  async function saveEdit() {
    setSaving(true); setMsg(''); setIsError(false)
    const body: Record<string, string> = { userId: editingId! }
    if (editName.trim()) body.full_name = editName.trim()
    body.role = editRole
    if (editPass) body.password = editPass

    const res = await fetch('/api/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setIsError(true)
      setMsg(data.error ?? 'Something went wrong.')
    } else {
      setMsg('Saved!')
      setEditingId(null)
      onRefresh()
      setTimeout(() => setMsg(''), 2000)
    }
  }

  return (
    <div className="space-y-4">
      {msg && !editingId && (
        <p className={`text-sm px-3 py-2 rounded-lg ${isError ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {msg}
        </p>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left px-4 py-3 font-medium text-gray-500">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Role</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">Joined</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {profiles.map(p => {
              const isMe = p.id === currentUserId
              const isEditing = editingId === p.id
              return (
                <tr key={p.id} className={`border-b border-gray-50 last:border-0 ${isEditing ? 'bg-blue-50' : ''}`}>
                  {isEditing ? (
                    /* ── Edit row ── */
                    <td colSpan={4} className="px-4 py-4">
                      <div className="space-y-3">
                        <div className="flex gap-3 flex-wrap">
                          <div className="flex-1 min-w-[160px]">
                            <label className="block text-xs font-medium text-gray-500 mb-1">Full Name</label>
                            <input
                              type="text"
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Role</label>
                            <select
                              value={editRole}
                              onChange={e => setEditRole(e.target.value)}
                              disabled={isMe}
                              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                            >
                              <option value="sales_manager">Account Manager</option>
                              <option value="applicator">Applicator</option>
                              <option value="viewer">Viewer</option>
                              <option value="admin">Admin</option>
                            </select>
                          </div>
                          <div className="flex-1 min-w-[160px]">
                            <label className="block text-xs font-medium text-gray-500 mb-1">New Password <span className="text-gray-400">(leave blank to keep)</span></label>
                            <input
                              type="password"
                              value={editPass}
                              onChange={e => setEditPass(e.target.value)}
                              placeholder="Min. 6 characters"
                              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                          </div>
                        </div>
                        {msg && isEditing && (
                          <p className={`text-xs ${isError ? 'text-red-600' : 'text-green-700'}`}>{msg}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            onClick={saveEdit}
                            disabled={saving}
                            className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-medium px-4 py-1.5 rounded-lg transition-colors"
                          >
                            {saving ? 'Saving…' : 'Save'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="text-gray-500 hover:text-gray-700 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </td>
                  ) : (
                    /* ── Normal row ── */
                    <>
                      <td className="px-4 py-3 font-medium text-gray-900">{p.full_name}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_COLORS_MAP[p.role] ?? 'bg-gray-100 text-gray-600'}`}>
                          {ROLE_LABELS_MAP[p.role] ?? p.role}{isMe ? ' (you)' : ''}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{safeDate(p.created_at, 'MMM d, yyyy')}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={() => startEdit(p)}
                          className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                        >
                          Edit
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <AddUserForm onSuccess={onRefresh} />
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
            <option value="sales_manager">Account Manager</option>
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
      <option value="sales_manager">Account Manager</option>
      <option value="applicator">Applicator</option>
      <option value="viewer">Viewer</option>
      <option value="admin">Admin</option>
    </select>
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
                      Available: {t.active_from ? safeDate(t.active_from, 'MMM d, yyyy') : 'always'}
                      {' → '}
                      {t.active_to ? safeDate(t.active_to, 'MMM d, yyyy') : 'no end'}
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
  trucks,
  onSaved,
  onCancel,
}: {
  adminId: string
  supabase: ReturnType<typeof createClient>
  existingRule?: CapacityRule
  trucks: Truck[]
  onSaved: () => void
  onCancel?: () => void
}) {
  const isEditing = !!existingRule
  const [name, setName] = useState(existingRule?.name ?? '')
  const [startDate, setStartDate] = useState(existingRule?.start_date ?? '')
  const [endDate, setEndDate] = useState(existingRule?.end_date ?? '')
  const [selectedDays, setSelectedDays] = useState<number[]>(existingRule?.days_of_week ?? [...WEEKDAYS])
  const [maxApps, setMaxApps] = useState(existingRule?.max_applications ?? 2)
  // null = all trucks; otherwise array of selected truck IDs
  const [selectedTruckIds, setSelectedTruckIds] = useState<string[] | null>(existingRule?.truck_ids ?? null)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')

  function toggleDay(day: number) {
    setSelectedDays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    )
  }

  function toggleTruck(id: string) {
    if (selectedTruckIds === null) {
      // switching from "all trucks" to specific selection — start with all checked except this one
      setSelectedTruckIds(trucks.map(t => t.id).filter(tid => tid !== id))
    } else if (selectedTruckIds.includes(id)) {
      const next = selectedTruckIds.filter(tid => tid !== id)
      // if nothing left selected, go back to "all trucks"
      setSelectedTruckIds(next.length === 0 ? null : next)
    } else {
      const next = [...selectedTruckIds, id]
      // if every truck is now checked, revert to null (all trucks)
      setSelectedTruckIds(next.length === trucks.length ? null : next)
    }
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
          truck_ids: selectedTruckIds,
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
        truck_ids: selectedTruckIds,
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
        setSelectedTruckIds(null)
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

      {/* Trucks */}
      {trucks.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-gray-600">Applies to Trucks</label>
            <button
              type="button"
              onClick={() => setSelectedTruckIds(null)}
              className="text-xs text-blue-600 hover:underline"
            >
              All trucks
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {trucks.map(t => {
              const checked = selectedTruckIds === null || selectedTruckIds.includes(t.id)
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTruck(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    checked
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {t.name}
                  {t.applicator_name && (
                    <span className={checked ? 'opacity-75' : 'opacity-50'}>· {t.applicator_name}</span>
                  )}
                </button>
              )
            })}
          </div>
          {selectedTruckIds !== null && (
            <p className="text-xs text-amber-600 mt-1.5">
              Rule only applies to {selectedTruckIds.length} of {trucks.length} trucks
            </p>
          )}
        </div>
      )}

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
  onFix,
  readonly = false,
}: {
  req: ApprovalRequest
  onAction: (req: ApprovalRequest, action: 'approved' | 'rejected', note?: string, deductSlots?: number) => void
  onFix?: (req: ApprovalRequest) => void
  readonly?: boolean
}) {
  const [note, setNote]             = useState('')
  const [deductSlots, setDeductSlots] = useState(0)
  const [fixing, setFixing]         = useState(false)
  const isDisinfect = req.job_type === 'stg_disinfect'
  const missingAppointment = req.status === 'approved' && !req.appointment_id

  return (
    <div className={`bg-white rounded-xl border p-4 ${
      req.status === 'pending' ? (isDisinfect ? 'border-green-200' : 'border-yellow-200') : 'border-gray-200'
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-medium text-gray-900">{req.customer_name}</p>
            {isDisinfect && (
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Stg Disinfect</span>
            )}
          </div>
          <p className="text-sm text-gray-500 mt-0.5">
            {req.salesman_name} · {safeDate(req.date, 'EEE, MMM d, yyyy')}
          </p>
          {req.storage_name && (
            <p className="text-xs text-gray-500 mt-0.5">Storage: {req.storage_name}</p>
          )}
          {isDisinfect && req.storage_capacity && (
            <p className="text-xs text-gray-500">Capacity: {req.storage_capacity.toLocaleString()} CWT</p>
          )}
          {req.notes && <p className="text-sm text-gray-600 mt-1">{req.notes}</p>}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize shrink-0 ${
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
            placeholder="Optional note to account manager…"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />

          {/* Slot deduction — number of truck slots this job will occupy */}
          <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-sm text-gray-700">
              Deduct truck slots from{' '}
              <span className="font-medium">{safeDate(req.date, 'MMM d')}</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setDeductSlots(n => Math.max(0, n - 1))}
                className="w-7 h-7 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 font-bold flex items-center justify-center text-lg leading-none"
              >
                −
              </button>
              <span className="w-5 text-center font-semibold text-gray-900 text-sm">{deductSlots}</span>
              <button
                type="button"
                onClick={() => setDeductSlots(n => Math.min(10, n + 1))}
                className="w-7 h-7 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 font-bold flex items-center justify-center text-lg leading-none"
              >
                +
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onAction(req, 'rejected', note)}
              className="flex-1 border border-gray-200 text-gray-700 text-sm font-medium py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Decline
            </button>
            <button
              onClick={() => onAction(req, 'approved', note, deductSlots)}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white text-sm font-medium py-1.5 rounded-lg transition-colors"
            >
              {isDisinfect ? 'Approve & Schedule' : 'Approve'}
            </button>
          </div>
        </div>
      )}

      {req.admin_note && (
        <p className="mt-2 text-xs text-gray-500 italic">Admin note: {req.admin_note}</p>
      )}

      {/* Repair button: approved but appointment_id is null (insert previously failed) */}
      {missingAppointment && onFix && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-amber-600">Not on calendar yet</span>
          <button
            onClick={async () => {
              setFixing(true)
              await onFix(req)
              setFixing(false)
            }}
            disabled={fixing}
            className="text-xs bg-amber-50 border border-amber-300 text-amber-700 hover:bg-amber-100 px-2.5 py-1 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {fixing ? 'Adding…' : 'Add to Calendar'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── US Federal Holiday Calculator ───────────────────────────────────────────

function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  // month: 0-based. weekday: 0=Sun…6=Sat. n: 1-based (1=first, -1=last)
  if (n > 0) {
    const first = new Date(year, month, 1)
    const offset = (weekday - first.getDay() + 7) % 7
    return fmt(new Date(year, month, 1 + offset + (n - 1) * 7))
  } else {
    // last occurrence
    const last = new Date(year, month + 1, 0)
    const offset = (last.getDay() - weekday + 7) % 7
    return fmt(new Date(year, month, last.getDate() - offset))
  }
}

function observed(year: number, month: number, day: number): string {
  const d = new Date(year, month, day)
  const dow = d.getDay()
  if (dow === 6) return fmt(new Date(year, month, day - 1)) // Sat → Fri
  if (dow === 0) return fmt(new Date(year, month, day + 1)) // Sun → Mon
  return fmt(d)
}

function fmt(d: Date): string {
  return d.toISOString().split('T')[0]
}

function getUSHolidays(year: number): { date: string; reason: string }[] {
  return [
    { date: observed(year,  0,  1), reason: "New Year's Day"            },
    { date: nthWeekday(year, 0, 1, 3), reason: 'Martin Luther King Jr. Day' },
    { date: nthWeekday(year, 1, 1, 3), reason: "Presidents' Day"            },
    { date: nthWeekday(year, 4, 1,-1), reason: 'Memorial Day'               },
    { date: observed(year,  5, 19), reason: 'Juneteenth'                 },
    { date: observed(year,  6,  4), reason: 'Independence Day'           },
    { date: nthWeekday(year, 8, 1, 1), reason: 'Labor Day'                   },
    { date: nthWeekday(year, 9, 1, 2), reason: 'Columbus Day'                },
    { date: observed(year, 10, 11), reason: 'Veterans Day'               },
    { date: nthWeekday(year,10, 4, 4), reason: 'Thanksgiving Day'            },
    { date: observed(year, 11, 25), reason: 'Christmas Day'              },
  ]
}

// ─── Blackout Days Manager ────────────────────────────────────────────────────

function BlackoutDaysManager({
  supabase,
  adminId,
  blackoutDays,
  onRefresh,
}: {
  supabase: ReturnType<typeof createClient>
  adminId: string
  blackoutDays: BlackoutDay[]
  onRefresh: () => void
}) {
  const [date, setDate]     = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg]       = useState('')

  const [importYear, setImportYear]   = useState(new Date().getFullYear())
  const [importing, setImporting]     = useState(false)
  const [importMsg, setImportMsg]     = useState('')

  async function importHolidays() {
    setImporting(true)
    setImportMsg('')
    const holidays = getUSHolidays(importYear).map(h => ({
      date: h.date,
      reason: h.reason,
      created_by: adminId,
    }))
    const { data, error } = await supabase
      .from('blackout_days')
      .upsert(holidays, { onConflict: 'date', ignoreDuplicates: true })
      .select()
    setImporting(false)
    if (error) {
      setImportMsg(`Error: ${error.message}`)
    } else {
      const added = data?.length ?? 0
      const skipped = holidays.length - added
      setImportMsg(
        skipped > 0
          ? `Added ${added} holiday${added !== 1 ? 's' : ''}; ${skipped} already existed.`
          : `Added ${added} US federal holiday${added !== 1 ? 's' : ''} for ${importYear}.`
      )
      onRefresh()
      setTimeout(() => setImportMsg(''), 4000)
    }
  }

  async function addBlackout() {
    if (!date) return
    setSaving(true)
    setMsg('')
    const { error } = await supabase
      .from('blackout_days')
      .insert({ date, reason: reason.trim() || null, created_by: adminId })
    setSaving(false)
    if (error) {
      setMsg(error.code === '23505' ? 'That date is already blocked.' : `Error: ${error.message}`)
    } else {
      setMsg('Day blocked.')
      setDate('')
      setReason('')
      onRefresh()
      setTimeout(() => setMsg(''), 2000)
    }
  }

  async function removeBlackout(id: string) {
    await supabase.from('blackout_days').delete().eq('id', id)
    onRefresh()
  }

  return (
    <div className="space-y-4">
      {/* Add form */}
      <div className="flex gap-3 flex-wrap items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Reason <span className="text-gray-400">(optional)</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder='e.g. "Thanksgiving"'
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={addBlackout}
          disabled={!date || saving}
          className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Block Day'}
        </button>
      </div>

      {msg && (
        <p className={`text-sm ${msg.startsWith('Error') || msg.includes('already') ? 'text-red-600' : 'text-green-600'}`}>
          {msg}
        </p>
      )}

      {/* Import US federal holidays */}
      <div className="border border-blue-200 bg-blue-50 rounded-lg p-3">
        <p className="text-xs font-semibold text-blue-700 mb-2 uppercase tracking-wide">Import US Federal Holidays</p>
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Year</label>
            <select
              value={importYear}
              onChange={e => setImportYear(Number(e.target.value))}
              className="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {[-1, 0, 1, 2].map(offset => {
                const y = new Date().getFullYear() + offset
                return <option key={y} value={y}>{y}</option>
              })}
            </select>
          </div>
          <button
            onClick={importHolidays}
            disabled={importing}
            className="self-end bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {importing ? 'Importing…' : `Import ${importYear} Holidays`}
          </button>
        </div>
        {importMsg && (
          <p className={`text-xs mt-2 ${importMsg.startsWith('Error') ? 'text-red-600' : 'text-green-700'}`}>
            {importMsg}
          </p>
        )}
        <p className="text-xs text-blue-500 mt-1">
          Imports all 11 federal holidays (observed dates). Skips any dates already blocked.
        </p>
      </div>

      {/* Existing blackout days */}
      {blackoutDays.length > 0 ? (
        <div className="space-y-2 mt-2">
          {blackoutDays.map(b => (
            <div key={b.id} className="flex items-center justify-between bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <div>
                <span className="text-sm font-medium text-gray-900">
                  {safeDate(b.date, 'EEE, MMM d, yyyy')}
                </span>
                {b.reason && (
                  <span className="ml-2 text-sm text-red-700">{b.reason}</span>
                )}
              </div>
              <button
                onClick={() => removeBlackout(b.id)}
                className="text-xs text-red-500 hover:text-red-700 font-medium ml-4"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No blackout days set.</p>
      )}
    </div>
  )
}

// ─── Demo Mode Tab ───────────────────────────────────────────────────────────

interface DemoAppt {
  id: string
  date: string
  job_type: string
  customer_name: string
  storage_name: string | null
  cwt: number | null
  products: { product: string; rate: string }[]
  status: string
  salesman_id: string | null
  truck_id: string | null
}

const blankDemo = (defaultSalesmanId = '', defaultTruckId = '') => ({
  date: '',
  job_type: 'application' as 'application' | 'stg_disinfect',
  customer_name: '',
  storage_name: '',
  cwt: '',
  product: ALL_PRODUCTS[0],
  rate: '',
  salesman_id: defaultSalesmanId,
  truck_id: defaultTruckId,
})

const DEMO_SALESMEN = ['Jake Reynolds', 'Sarah Torres', 'Ben Kohler']

function DemoModeTab({ supabase, adminId, profiles, trucks }: { supabase: ReturnType<typeof createClient>; adminId: string; profiles: Profile[]; trucks: Truck[] }) {
  // Use real profiles if available, else fall back to 3 hardcoded demo names
  const salesManagers = profiles.filter(p => p.role === 'sales_manager')
  const salesmenOptions: { id: string; name: string }[] = salesManagers.length > 0
    ? salesManagers.map(p => ({ id: p.id, name: p.full_name }))
    : DEMO_SALESMEN.map((name) => ({ id: adminId, name }))
  const applicators = profiles.filter(p => p.role === 'applicator')
  const { demoSalesmanId, demoApplicatorId, setDemoSalesmanId, setDemoApplicatorId } = useDemoPersonas()
  const [appts,      setAppts]      = useState<DemoAppt[]>([])
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [editingId,  setEditingId]  = useState<string | null>(null)
  const [form,       setForm]       = useState(() => blankDemo(salesmenOptions[0]?.id ?? adminId, trucks[0]?.id ?? ''))
  const [msg,        setMsg]        = useState('')

  async function fetchDemo() {
    setLoading(true)
    const { data } = await supabase
      .from('appointments')
      .select('id, date, job_type, customer_name, storage_name, cwt, products, status, salesman_id, truck_id')
      .eq('is_demo', true)
      .order('date')
    setAppts((data as DemoAppt[]) ?? [])
    setLoading(false)
  }

  useEffect(() => { fetchDemo() }, [])

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })) }

  function startEdit(a: DemoAppt) {
    setEditingId(a.id)
    setMsg('')
    setForm({
      date:         a.date || '',
      job_type:     (a.job_type as 'application' | 'stg_disinfect') || 'application',
      customer_name: a.customer_name,
      storage_name: a.storage_name || '',
      cwt:          a.cwt != null ? String(a.cwt) : '',
      product:      a.products?.[0]?.product || ALL_PRODUCTS[0],
      rate:         a.products?.[0]?.rate || '',
      salesman_id:  a.salesman_id || salesmenOptions[0]?.id || adminId,
      truck_id:     a.truck_id || trucks[0]?.id || '',
    })
  }

  function cancelEdit() {
    setEditingId(null)
    setMsg('')
    setForm(blankDemo(salesmenOptions[0]?.id ?? adminId, trucks[0]?.id ?? ''))
  }

  async function saveJob() {
    if (!form.date || !form.customer_name) { setMsg('Date and customer are required.'); return }
    const salesmanId = form.salesman_id || adminId
    setSaving(true); setMsg('')
    const isDisinfect = form.job_type === 'stg_disinfect'
    const payload = {
      date:         form.date,
      salesman_id:  salesmanId,
      truck_id:     form.truck_id || null,
      job_type:     form.job_type,
      customer_name: form.customer_name,
      storage_name: form.storage_name || null,
      cwt:          form.cwt ? Number(form.cwt) : null,
      products:     isDisinfect ? [] : [{ product: form.product, rate: form.rate }],
      slot_count:   isDisinfect ? 0 : 1,
    }
    let error
    if (editingId) {
      const res = await supabase.from('appointments').update(payload).eq('id', editingId)
      error = res.error
    } else {
      const res = await supabase.from('appointments').insert({ ...payload, status: 'approved', is_demo: true })
      error = res.error
    }
    setSaving(false)
    if (error) { setMsg(`Error: ${error.message}`); return }
    setEditingId(null)
    setForm(blankDemo(salesmenOptions[0]?.id ?? adminId, trucks[0]?.id ?? ''))
    fetchDemo()
  }

  async function deleteJob(id: string) {
    await supabase.from('appointments').delete().eq('id', id)
    fetchDemo()
  }

  async function clearAll() {
    if (!confirm('Delete all demo jobs?')) return
    await supabase.from('appointments').delete().eq('is_demo', true)
    fetchDemo()
  }

  const inputCls = 'border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 w-full'

  return (
    <div className="space-y-5">
      {/* Demo persona selectors */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Demo Personas</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Choose which user "My Jobs" filters to when viewing as Account Manager or Applicator.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Account Manager persona</label>
            <select
              value={demoSalesmanId ?? ''}
              onChange={e => setDemoSalesmanId(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 w-full"
            >
              <option value="">— None selected —</option>
              {salesmenOptions.map(s => <option key={s.id + s.name} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Applicator persona</label>
            <select
              value={demoApplicatorId ?? ''}
              onChange={e => setDemoApplicatorId(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 w-full"
            >
              <option value="">— None selected —</option>
              {applicators.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950 rounded-xl border border-amber-200 dark:border-amber-800 p-5">
        <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Demo Mode Schedule</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Jobs added here only appear in demo mode — never in the real calendar.
        </p>

        {/* Add job form */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Date *</label>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Job Type</label>
            <select value={form.job_type} onChange={e => set('job_type', e.target.value)} className={inputCls}>
              <option value="application">Application</option>
              <option value="stg_disinfect">Stg Disinfect</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Account Manager</label>
            <select value={form.salesman_id} onChange={e => set('salesman_id', e.target.value)} className={inputCls}>
              {salesmenOptions.map(s => <option key={s.id + s.name} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Truck</label>
            <select value={form.truck_id} onChange={e => set('truck_id', e.target.value)} className={inputCls}>
              <option value="">— No truck —</option>
              {trucks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Customer *</label>
            <input type="text" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="Johnson Farms" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Storage Name</label>
            <input type="text" value={form.storage_name} onChange={e => set('storage_name', e.target.value)} placeholder="North Bin" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">CWT</label>
            <input type="number" value={form.cwt} onChange={e => set('cwt', e.target.value)} placeholder="25000" className={inputCls} />
          </div>
          {form.job_type === 'application' && (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Product</label>
                <select value={form.product} onChange={e => set('product', e.target.value)} className={inputCls}>
                  {ALL_PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Rate</label>
                <input type="text" value={form.rate} onChange={e => set('rate', e.target.value)} placeholder="0.5 oz/cwt" className={inputCls} />
              </div>
            </>
          )}
        </div>

        {msg && <p className="text-sm text-red-600 mt-2">{msg}</p>}

        <div className="flex gap-2 mt-4">
          <button
            onClick={saveJob}
            disabled={saving}
            className="bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {saving ? (editingId ? 'Saving…' : 'Adding…') : (editingId ? 'Update Job' : '+ Add Demo Job')}
          </button>
          {editingId && (
            <button
              onClick={cancelEdit}
              className="border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Cancel
            </button>
          )}
          {!editingId && appts.length > 0 && (
            <button
              onClick={clearAll}
              className="border border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              Clear All Demo Jobs
            </button>
          )}
        </div>
      </div>

      {/* Existing demo jobs */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Current Demo Jobs {!loading && `(${appts.length})`}
          </h4>
        </div>
        {loading && <div className="text-center py-8 text-gray-400 text-sm">Loading…</div>}
        {!loading && appts.length === 0 && (
          <div className="text-center py-8 text-gray-400 text-sm">No demo jobs yet — add one above.</div>
        )}
        {!loading && appts.map(a => (
          <div
            key={a.id}
            className={`flex items-center justify-between px-5 py-3 border-b border-gray-50 dark:border-gray-800 last:border-0 ${editingId === a.id ? 'bg-amber-50 dark:bg-amber-950/20' : ''}`}
          >
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-500 dark:text-gray-400 w-24 shrink-0">{safeDate(a.date, 'MMM d, yyyy')}</span>
              <span className="font-medium text-gray-900 dark:text-white">{a.customer_name}</span>
              {(() => {
                const match = salesmenOptions.find(s => s.id === a.salesman_id)
                return match ? <span className="text-gray-400 dark:text-gray-500 text-xs">{match.name}</span> : null
              })()}
              {a.truck_id && (
                <span className="text-gray-400 dark:text-gray-500 text-xs">{trucks.find(t => t.id === a.truck_id)?.name ?? ''}</span>
              )}
              {a.products?.length > 0 && (
                <span className="text-gray-400 dark:text-gray-500 text-xs">{a.products[0].product}</span>
              )}
              {a.job_type === 'stg_disinfect' && (
                <span className="text-xs text-green-700 dark:text-green-400">Stg Disinfect</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => startEdit(a)}
                className="text-xs text-amber-600 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-200 transition-colors"
              >
                Edit
              </button>
              <button
                onClick={() => deleteJob(a.id)}
                className="text-xs text-red-500 hover:text-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Applicator list */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Applicators ({applicators.length})
          </h4>
        </div>
        {applicators.length === 0 ? (
          <div className="text-center py-6 text-gray-400 text-sm">No applicators found.</div>
        ) : (
          applicators.map(a => {
            const assignedTruck = trucks.find(t => t.applicator_id === a.id)
            return (
              <div key={a.id} className="flex items-center justify-between px-5 py-3 border-b border-gray-50 dark:border-gray-800 last:border-0 text-sm">
                <span className="font-medium text-gray-900 dark:text-white">{a.full_name}</span>
                {assignedTruck ? (
                  <span className="text-gray-400 dark:text-gray-500 text-xs">{assignedTruck.name}</span>
                ) : (
                  <span className="text-gray-300 dark:text-gray-600 text-xs italic">No truck assigned</span>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Monthly Summary Tab ─────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const YEARS  = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)

const PRODUCT_CHIP: Record<string, string> = {
  'Stg Disinfect': 'chip-disinfect',
  'Smart Block':   'chip-purple',
  '1,4 Zap':       'chip-yellow',
  'DMN':           'chip-brown',
  'Storox / Perox AG': 'chip-green',
  'Purogene Pro':  'chip-blue',
  'CIPC':          'chip-orange',
  'Amplify':       'chip-white',
  'Fresh Pack 100':'chip-pink',
}

function chipForProduct(name: string): string {
  for (const [key, cls] of Object.entries(PRODUCT_CHIP)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return cls
  }
  return 'chip-default'
}

interface SummaryRow {
  product:   string
  count:     number
  totalCwt:  number
  customers: { date: string; customer: string; cwt: number | null; salesman: string | null }[]
}

function SummaryTab({ supabase }: { supabase: ReturnType<typeof createClient> }) {
  const now    = new Date()
  const [month,    setMonth]    = useState(now.getMonth() + 1)
  const [year,     setYear]     = useState(now.getFullYear())
  const [rows,     setRows]     = useState<SummaryRow[]>([])
  const [totalJobs,setTotalJobs]= useState(0)
  const [loading,  setLoading]  = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setExpanded(null)
      const monthStr  = String(month).padStart(2, '0')
      const startDate = `${year}-${monthStr}-01`
      const lastDay   = new Date(year, month, 0).getDate()
      const endDate   = `${year}-${monthStr}-${lastDay}`

      const { data } = await supabase
        .from('appointments_with_details')
        .select('date, job_type, products, customer_name, cwt, salesman_name, status')
        .gte('date', startDate)
        .lte('date', endDate)
        .neq('status', 'rejected')

      if (!data) { setLoading(false); return }

      const map = new Map<string, SummaryRow>()

      for (const appt of data) {
        const entry = {
          date:     appt.date,
          customer: appt.customer_name,
          cwt:      appt.cwt ?? null,
          salesman: appt.salesman_name ?? null,
        }

        const cwtVal = appt.cwt ?? 0

        if (appt.job_type === 'stg_disinfect') {
          const key = 'Stg Disinfect'
          if (!map.has(key)) map.set(key, { product: key, count: 0, totalCwt: 0, customers: [] })
          const r = map.get(key)!
          r.count++
          r.totalCwt += cwtVal
          r.customers.push(entry)
        } else {
          const products: { product: string }[] = appt.products ?? []
          if (products.length === 0) {
            const key = 'Unknown'
            if (!map.has(key)) map.set(key, { product: key, count: 0, totalCwt: 0, customers: [] })
            const r = map.get(key)!
            r.count++
            r.totalCwt += cwtVal
            r.customers.push(entry)
          } else {
            for (const p of products) {
              const key = p.product
              if (!map.has(key)) map.set(key, { product: key, count: 0, totalCwt: 0, customers: [] })
              const r = map.get(key)!
              r.count++
              r.totalCwt += cwtVal
              r.customers.push(entry)
            }
          }
        }
      }

      const sorted = Array.from(map.values()).sort((a, b) => b.count - a.count)
      setRows(sorted)
      setTotalJobs(data.length)
      setLoading(false)
    }
    load()
  }, [year, month, supabase])

  return (
    <div className="space-y-5">
      {/* Month / Year picker */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Month:</span>
        <select
          value={month}
          onChange={e => setMonth(Number(e.target.value))}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
          {loading ? 'Loading…' : `${totalJobs} total job${totalJobs !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Empty state */}
      {!loading && rows.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-600 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          No applications found for {MONTHS[month - 1]} {year}.
        </div>
      )}

      {/* Product rows */}
      {!loading && rows.map(row => {
        const chipClass = chipForProduct(row.product)
        const isOpen    = expanded === row.product
        return (
          <div key={row.product} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              onClick={() => setExpanded(isOpen ? null : row.product)}
            >
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${chipClass}`}>
                  {row.product}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {row.count} application{row.count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {row.count} job{row.count !== 1 ? 's' : ''}
                </span>
                {row.totalCwt > 0 && (
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    {row.totalCwt.toLocaleString()} CWT
                