'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Appointment, Profile } from '@/lib/types'
import { format, parseISO } from 'date-fns'

interface Props {
  date: string                    // 'YYYY-MM-DD'
  appointments: Appointment[]
  maxTrucks: number
  currentProfile: Profile
  editingAppointment?: Appointment | null
  onClose: () => void
  onSuccess: () => void
}

export default function AppointmentModal({
  date,
  appointments,
  maxTrucks,
  currentProfile,
  editingAppointment,
  onClose,
  onSuccess,
}: Props) {
  const supabase = createClient()
  const isFull = appointments.filter(a => a.status !== 'rejected').length >= maxTrucks
  const isAdmin = currentProfile.role === 'admin'

  const [customerName, setCustomerName] = useState(editingAppointment?.customer_name ?? '')
  const [notes, setNotes] = useState(editingAppointment?.notes ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showRequestForm, setShowRequestForm] = useState(false)

  const displayDate = format(parseISO(date), 'EEEE, MMMM d, yyyy')
  const confirmedCount = appointments.filter(a => a.status !== 'rejected').length

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (editingAppointment) {
        // Update existing
        const { error } = await supabase
          .from('appointments')
          .update({ customer_name: customerName, notes, updated_at: new Date().toISOString() })
          .eq('id', editingAppointment.id)
        if (error) throw error
      } else if (isFull && !isAdmin) {
        // Day is full — submit approval request instead
        const { error } = await supabase
          .from('approval_requests')
          .insert({
            salesman_id: currentProfile.id,
            date,
            customer_name: customerName,
            notes,
          })
        if (error) throw error
      } else {
        // Normal booking
        const { error } = await supabase
          .from('appointments')
          .insert({
            date,
            salesman_id: currentProfile.id,
            customer_name: customerName,
            notes,
            status: 'confirmed',
          })
        if (error) throw error
      }
      onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(appt: Appointment) {
    if (!confirm(`Remove appointment for ${appt.customer_name}?`)) return
    setLoading(true)
    const { error } = await supabase.from('appointments').delete().eq('id', appt.id)
    if (error) setError(error.message)
    else onSuccess()
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="p-5 border-b border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 text-lg">{displayDate}</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {confirmedCount} of {maxTrucks} trucks scheduled
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Capacity bar */}
          <div className="mt-3">
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div
                className={`h-1.5 rounded-full transition-all ${
                  isFull ? 'bg-red-500' : confirmedCount / maxTrucks > 0.7 ? 'bg-yellow-400' : 'bg-green-500'
                }`}
                style={{ width: `${Math.min((confirmedCount / maxTrucks) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>

        {/* Existing appointments */}
        {appointments.length > 0 && (
          <div className="p-5 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Scheduled
            </h3>
            <ul className="space-y-2">
              {appointments.map(appt => (
                <li
                  key={appt.id}
                  className="flex items-center justify-between bg-gray-50 rounded-xl px-3 py-2"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{appt.customer_name}</p>
                    <p className="text-xs text-gray-500">{appt.salesman_name ?? 'Unknown'}</p>
                    {appt.notes && <p className="text-xs text-gray-400 mt-0.5">{appt.notes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {appt.status === 'pending_approval' && (
                      <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
                        Pending
                      </span>
                    )}
                    {(appt.salesman_id === currentProfile.id || isAdmin) && (
                      <button
                        onClick={() => handleDelete(appt)}
                        className="text-red-400 hover:text-red-600 text-xs"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Full-day warning (non-admin) */}
        {isFull && !isAdmin && !showRequestForm && !editingAppointment && (
          <div className="p-5">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <svg className="w-8 h-8 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="font-semibold text-red-800">This day is fully booked</p>
              <p className="text-sm text-red-600 mt-1">All {maxTrucks} truck slots are taken.</p>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={onClose}
                  className="flex-1 bg-white border border-gray-200 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  Choose another day
                </button>
                <button
                  onClick={() => setShowRequestForm(true)}
                  className="flex-1 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Request approval
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Booking form */}
        {(!isFull || isAdmin || showRequestForm || editingAppointment) && (
          <form onSubmit={handleSubmit} className="p-5 space-y-4">
            {showRequestForm && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
                This will send an approval request to the admin for an extra slot on this day.
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
              <input
                type="text"
                required
                value={customerName}
                onChange={e => setCustomerName(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="John Smith"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Job details, special instructions…"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex gap-2 pt-1">
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
                {loading
                  ? 'Saving…'
                  : editingAppointment
                  ? 'Save changes'
                  : showRequestForm
                  ? 'Send request'
                  : 'Schedule'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
