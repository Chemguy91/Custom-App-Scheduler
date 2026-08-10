'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CompanyEvent } from '@/lib/types'
import { format, parseISO } from 'date-fns'

interface Props {
  date: string
  isAdmin: boolean
  adminId: string
  existingEvents: CompanyEvent[]   // all events already on this date
  onClose: () => void
  onSuccess: () => void
}

export default function CompanyEventModal({
  date,
  isAdmin,
  adminId,
  existingEvents,
  onClose,
  onSuccess,
}: Props) {
  const supabase = createClient()
  const displayDate = format(parseISO(date), 'EEEE, MMMM d, yyyy')

  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function startAdd() {
    setEditingId('new')
    setTitle('')
    setNotes('')
    setError('')
  }

  function startEdit(ev: CompanyEvent) {
    setEditingId(ev.id)
    setTitle(ev.title)
    setNotes(ev.notes ?? '')
    setError('')
  }

  function cancelForm() {
    setEditingId(null)
    setError('')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('Title is required.'); return }
    setSaving(true)
    setError('')

    let err
    if (editingId && editingId !== 'new') {
      const res = await supabase
        .from('company_events')
        .update({ title: title.trim(), notes: notes.trim() || null, updated_at: new Date().toISOString() })
        .eq('id', editingId)
      err = res.error
    } else {
      const res = await supabase
        .from('company_events')
        .insert({ title: title.trim(), date, notes: notes.trim() || null, created_by: adminId })
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
    if (!confirm('Delete this event?')) return
    setSaving(true)
    const { error } = await supabase.from('company_events').delete().eq('id', id)
    setSaving(false)
    if (error) setError(error.message)
    else onSuccess()
  }

  const showForm = editingId !== null

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
              <h2 className="font-semibold text-gray-900 dark:text-white text-lg">Company Events</h2>
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
          {/* Existing events list */}
          {existingEvents.length > 0 && !showForm && (
            <div className="space-y-2">
              {existingEvents.map(ev => (
                <div key={ev.id} className="bg-indigo-50 dark:bg-indigo-950 border border-indigo-100 dark:border-indigo-900 rounded-xl px-3 py-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-indigo-900 dark:text-indigo-200">{ev.title}</p>
                    {isAdmin && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => startEdit(ev)} className="text-xs text-indigo-500 hover:text-indigo-700 font-medium">Edit</button>
                        <button onClick={() => remove(ev.id)} disabled={saving} className="text-xs text-red-400 hover:text-red-600 font-medium">Delete</button>
                      </div>
                    )}
                  </div>
                  {ev.notes && <p className="text-sm text-indigo-700 dark:text-indigo-300 mt-1 whitespace-pre-wrap">{ev.notes}</p>}
                </div>
              ))}
            </div>
          )}

          {existingEvents.length === 0 && !showForm && (
            <p className="text-sm text-gray-400 italic">No events on this day.</p>
          )}

          {/* Add / Edit form (admin only) */}
          {isAdmin && showForm && (
            <form onSubmit={save} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="e.g. Team meeting, Company picnic…"
                  autoFocus
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Notes <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Time, location, agenda…"
                  className="w-full border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
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
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                >
                  {saving ? 'Saving…' : editingId !== 'new' ? 'Update Event' : 'Add Event'}
                </button>
              </div>
            </form>
          )}

          {/* Footer actions */}
          {isAdmin && !showForm && (
            <button
              onClick={startAdd}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium py-2 rounded-lg transition-colors"
            >
              + Add Event
            </button>
          )}
          {!isAdmin && !showForm && (
            <button
              onClick={onClose}
              className="w-full bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium py-2 rounded-lg transition-colors"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
