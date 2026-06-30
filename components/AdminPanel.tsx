'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ApprovalRequest, Profile } from '@/lib/types'
import { format, parseISO } from 'date-fns'

export default function AdminPanel({ profile }: { profile: Profile }) {
  const supabase = createClient()
  const [requests, setRequests] = useState<ApprovalRequest[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [defaultCapacity, setDefaultCapacity] = useState('5')
  const [savingCapacity, setSavingCapacity] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'requests' | 'users' | 'settings'>('requests')
  const [newUser, setNewUser] = useState({ email: '', full_name: '', role: 'salesman' as 'admin' | 'salesman' })
  const [inviteMsg, setInviteMsg] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [reqRes, profRes, settingsRes] = await Promise.all([
      supabase
        .from('approval_requests')
        .select(`*, profiles!approval_requests_salesman_id_fkey(full_name)`)
        .order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('full_name'),
      supabase.from('settings').select('value').eq('key', 'default_daily_capacity').single(),
    ])

    if (reqRes.data) {
      setRequests(reqRes.data.map((r: Record<string, unknown>) => ({
        ...r,
        salesman_name: (r.profiles as { full_name: string } | null)?.full_name ?? 'Unknown',
      })) as ApprovalRequest[])
    }
    if (profRes.data) setProfiles(profRes.data as Profile[])
    if (settingsRes.data) setDefaultCapacity(settingsRes.data.value)
    setLoading(false)
  }, [supabase])

  useEffect(() => { fetchData() }, [fetchData])

  async function handleApprovalAction(req: ApprovalRequest, action: 'approved' | 'rejected', note?: string) {
    const supabaseClient = createClient()

    if (action === 'approved') {
      // Create the actual appointment
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

  async function inviteUser() {
    setInviteMsg('')
    const { error } = await supabase.auth.admin.createUser({
      email: newUser.email,
      user_metadata: { full_name: newUser.full_name, role: newUser.role },
      email_confirm: true,
    })
    if (error) {
      setInviteMsg(`Error: ${error.message}`)
    } else {
      setInviteMsg(`Invited ${newUser.email}. They can now set their password via the login page.`)
      setNewUser({ email: '', full_name: '', role: 'salesman' })
    }
  }

  const pendingRequests = requests.filter(r => r.status === 'pending')
  const reviewedRequests = requests.filter(r => r.status !== 'pending')

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Admin Panel</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage requests, users, and daily capacity</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-xl p-1 w-fit">
        {(['requests', 'users', 'settings'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors capitalize ${
              activeTab === tab
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
            {tab === 'requests' && pendingRequests.length > 0 && (
              <span className="ml-1.5 bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
                {pendingRequests.length}
              </span>
            )}
          </button>
        ))}
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
                <RequestCard
                  key={req.id}
                  req={req}
                  onAction={handleApprovalAction}
                />
              ))}

              {reviewedRequests.length > 0 && (
                <>
                  <h3 className="text-sm font-medium text-gray-500 pt-2">Previously reviewed</h3>
                  {reviewedRequests.map(req => (
                    <RequestCard
                      key={req.id}
                      req={req}
                      onAction={handleApprovalAction}
                      readonly
                    />
                  ))}
                </>
              )}
            </div>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <div className="space-y-4">
              {/* Existing users */}
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
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${
                            p.role === 'admin'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {p.role}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {format(parseISO(p.created_at), 'MMM d, yyyy')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Invite new user */}
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-4">Invite New User</h3>
                <p className="text-sm text-gray-500 mb-4">
                  To add users, go to your <strong>Supabase Dashboard → Authentication → Users → Invite user</strong>.
                  Set their <code className="bg-gray-100 px-1 rounded">full_name</code> and <code className="bg-gray-100 px-1 rounded">role</code> in the metadata field.
                </p>
                <div className="bg-gray-50 rounded-lg p-3 text-xs font-mono text-gray-600">
                  {`{ "full_name": "Jane Doe", "role": "salesman" }`}
                </div>
              </div>
            </div>
          )}

          {/* SETTINGS TAB */}
          {activeTab === 'settings' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Default Daily Truck Capacity</h3>
                <p className="text-sm text-gray-500 mb-4">
                  How many applications can be scheduled per day unless overridden for a specific date.
                </p>
                <div className="flex items-center gap-3">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    value={defaultCapacity}
                    onChange={e => setDefaultCapacity(e.target.value)}
                    className="w-24 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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

              <div className="bg-white rounded-xl border border-gray-200 p-5">
                <h3 className="font-semibold text-gray-900 mb-1">Override Capacity for a Specific Date</h3>
                <p className="text-sm text-gray-500 mb-4">
                  Set a different application limit for one date (e.g. holidays or peak days).
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
        <label className="block text-xs font-medium text-gray-600 mb-1">Max Trucks</label>
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
