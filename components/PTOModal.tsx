'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PTOEvent, Profile } from '@/lib/types'
import { format, parseISO } from 'date-fns'
import DateRangePicker from './DateRangePicker'

interface Props {
  date: string
  profile: Profile
  isAdmin: boolean
  canAdd: boolean                                    // false for viewers — they can look, not request
  allProfiles: { id: string; full_name: string }[]  // for the admin "on behalf of" picker
  existingForDate: PTOEvent[]                        // all PTO entries overlapping this date
  onClose: () => void
  onSuccess: () => void
}

export default function PTOModal({
  date,
  profile,
  isAdmin,
  canAdd,
  allProfiles,
  existingForDate,
  onClose,
  onSuccess,
}: Props) {
  const supabase = createClient()
  const displayDate = format(parseISO(date), 'EEEE, MMMM d, yyyy')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [employeeId, setEmployeeId] = useState(profile.id)
  const [startDate, setStartDate] = useState(date)
  const [endDate, setEndDate] = useState(date)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function startAdd() {
    setEditingId('new')
    setEmployeeId(profile.id)
    setStartDate(date)
    setEndDate(date)
    setReason('')
    setError('')
  }

  function startEdit(ev: PTOEvent) {
    setEditingId(ev.id)
    setEmployeeId(ev.employee_id)
    setStartDate(ev.start_date)
    setEndDate(ev.end_date)
    setReason(ev.reason ?? '')
    setError('')
  }

  function cancelForm() {
    setEditingId(null)
    setError('')
  }

  function canManage(ev: PTOEvent) {
    return isAdmin || ev.employee_id === profile.id
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!startDate || !endDate) { setError('Start and end date are required.'); return }
    if (endDate < startDate) { setError('End date must be on or after the start date.'); return }
    setSaving(true)
    setError('')

    const ownerId = isAdmin ? employeeId : profile.id

    let err
    if (editingId && editingId !== 'new') {
      const res = await supabase
        .from('pto_events')
        .update({
          employee_id: ownerId,
          start_date: startDate,
          end_date: endDate,
          reason: reason.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', editingId)
      err = res.error
    } else {
      const res = await supabase
        .from('pto_events')
        .insert({
          employee_id: ownerId,
          start_date: startDate,
          end_date: endDate,
          reason: reason.trim() || null,
          created_by: profile.id,
        })
      err = res.error
    }

    setSaving(false)
    if (err) {
      setError(err.message)
    } else {
      setEditingId(null)
      onSuccess()
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this PTO entry?')) return
    setSaving(true)
    const { error } = await supabase.from('pto_events').delete().eq('id', id)
    setSaving(false)
    if (error) setError(error.message)
    else onSuccess()
  }

  const showForm = editingId !== null

  function formatRange(ev: PTOEvent) {
    return ev.start_date === ev.end_date
      ? format(parseISO(ev.start_date), 'MMM d, yyyy')
      : `${format(parseISO(ev.start_date), 'MMM d')} – ${format(parseISO(ev.end_date), 'MMM d, yyyy')}`
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white text-lg">Employee PTO</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{displayDate}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Existing PTO on this date */}
          {existingForDate.length > 0 && !showForm && (
            <div className="space-y-2">
              {existingForDate.map(ev => (
                <div key={ev.id} className="pto-card border rounded-xl px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-red-700 truncate">
                        {ev.employee_name ?? 'Employee'}
                      </p>
                      <p className="text-xs text-red-600">{formatRange(ev)}</p>
                    </div>
                    {canManage(ev) && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => startEdit(ev)} className="text-xs text-red-600 hover:text-red-800 font-medium">Edit</button>
                        <button onClick={() => remove(ev.id)} disabled={saving} className="text-xs text-red-400 hover:text-red-600 font-medium">Delete</button>
                      </div>
                    )}
                  </div>
                  {ev.reason && <p className="text-sm text-red-600 mt-1 whitespace-pre-wrap">{ev.reason}</p>}
                </div>
              ))}
            </div>
          )}

          {existingForDate.length === 0 && !showForm && (
            <p className="text-sm text-gray-400 italic">
              {canAdd ? 'No PTO on this day.' : 'No PTO on this day. View-only access.'}
            </p>
          )}

          {/* Add / Edit form — available to every user */}
          {showForm && (
            <form onSubmit={save} className="space-y-4">
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Employee</label>
                  <select
                    value={employeeId}
                    onChange={e => setEmployeeId(e.target.value)}
                    className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    {allProfiles.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.full_name}{p.id === profile.id ? ' (you)' : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dates</label>
                <DateRangePicker
                  startDate={startDate}
                  endDate={endDate}
                  onChange={(start, end) => { setStartDate(start); setEndDate(end) }}
                />
                <p className="text-xs text-gray-400 mt-1">Click a day to start, click another to pick the last day. Click the same day again for a single day off.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Reason <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Vacation, doctor appointment…"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={cancelForm}
                  className="flex-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                >
                  {saving ? 'Saving…' : editingId !== 'new' ? 'Update PTO' : 'Add PTO'}
                </button>
              </div>
            </form>
          )}

          {/* Footer action — every user except viewers can request PTO */}
          {!showForm && canAdd && (
            <button
              onClick={startAdd}
              className="w-full bg-red-600 hover:bg-red-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              + Request PTO
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
