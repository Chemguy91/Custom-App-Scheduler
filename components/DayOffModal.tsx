'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DayOff, Profile, Truck } from '@/lib/types'
import { format, parseISO } from 'date-fns'

interface Props {
  date: string
  profile: Profile
  existingRequest: DayOff | null   // if already requested for this day
  trucks: Truck[]                  // trucks assigned to this applicator
  onClose: () => void
  onSuccess: () => void
}

export default function DayOffModal({
  date,
  profile,
  existingRequest,
  trucks,
  onClose,
  onSuccess,
}: Props) {
  const supabase = createClient()
  const displayDate = format(parseISO(date), 'EEEE, MMMM d, yyyy')

  const myTruck = trucks.find(t => t.applicator_id === profile.id)

  const [reason, setReason] = useState(existingRequest?.reason ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function requestDayOff(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.from('days_off').insert({
      applicator_id: profile.id,
      truck_id: myTruck?.id ?? null,
      date,
      reason: reason || null,
      status: 'pending',
    })
    setLoading(false)
    if (error) setError(error.message)
    else onSuccess()
  }

  async function cancelRequest() {
    if (!existingRequest) return
    setLoading(true)
    const { error } = await supabase.from('days_off').delete().eq('id', existingRequest.id)
    setLoading(false)
    if (error) setError(error.message)
    else onSuccess()
  }

  const statusColors: Record<string, string> = {
    pending: 'bg-yellow-100 text-yellow-700',
    approved: 'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm">
        {/* Header */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 text-lg">Day Off Request</h2>
              <p className="text-sm text-gray-500 mt-0.5">{displayDate}</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-5">
          {/* Truck info */}
          {myTruck && (
            <div className="flex items-center gap-2 mb-4 bg-blue-50 rounded-xl px-3 py-2">
              <svg className="w-4 h-4 text-blue-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <span className="text-sm text-blue-700 font-medium">{myTruck.name}</span>
            </div>
          )}

          {/* Existing request */}
          {existingRequest ? (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Request status</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${statusColors[existingRequest.status]}`}>
                    {existingRequest.status}
                  </span>
                </div>
                {existingRequest.reason && (
                  <p className="text-sm text-gray-600">{existingRequest.reason}</p>
                )}
                {existingRequest.admin_note && (
                  <p className="text-xs text-gray-500 mt-2 italic">
                    Admin note: {existingRequest.admin_note}
                  </p>
                )}
              </div>

              {existingRequest.status === 'pending' && (
                <button
                  onClick={cancelRequest}
                  disabled={loading}
                  className="w-full border border-red-200 text-red-600 text-sm font-medium py-2 rounded-lg hover:bg-red-50 transition-colors"
                >
                  {loading ? 'Cancelling…' : 'Cancel Request'}
                </button>
              )}
            </div>
          ) : (
            <form onSubmit={requestDayOff} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  rows={3}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  placeholder="e.g. Doctor appointment, personal day…"
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 bg-white border border-gray-200 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium py-2 rounded-lg transition-colors"
                >
                  {loading ? 'Submitting…' : 'Request Day Off'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
