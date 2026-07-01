'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Appointment, Profile, Truck } from '@/lib/types'
import { format, parseISO } from 'date-fns'

// ─── Product & Rate Data ──────────────────────────────────────────────────────

const PRODUCTS = [
  'Smart Block', '1,4 Zap', 'DMN (1,4-Sight)', 'Storox 2.0',
  'Purogene Pro', 'Purogene 2%', 'Perox Ag', 'CIPC', 'Amplify', 'Fresh Pack 100',
]

const PRODUCT_RATES: Record<string, string[]> = {
  'Smart Block':      ['11.5 PPM','23 PPM','34.5 PPM','46 PPM','57.5 PPM','69 PPM','80.5 PPM','92 PPM','103.5 PPM','115 PPM'],
  '1,4 Zap':         ['10 PPM','20 PPM','30 PPM','40 PPM','50 PPM','60 PPM','70 PPM','80 PPM','90 PPM','100 PPM'],
  'DMN (1,4-Sight)': ['7.5 PPM','10 PPM','12.5 PPM','15 PPM','16 PPM','17 PPM','18 PPM','19 PPM','20 PPM'],
  'Storox 2.0':      ['Single','Double','Triple','Chaser'],
  'Purogene Pro':    ['12.5 gal solution / 10,000 CWT (standard)'],
  'Purogene 2%':     ['12.5 gal solution / 10,000 CWT (standard)'],
  'Perox Ag':        ['Single','Double','Triple','Chaser'],
  'CIPC':            ['1:1,000','1:600','1:500','1:450','1:400'],
  'Amplify':         ['1:1,200','1:900','1:600'],
  'Fresh Pack 100':  ['1:14,000','1:1,500','1:1,400','1:1,200','1:1,000','1:600'],
}

interface ProductEntry { product: string; rate: string }

// ─── Props ────────────────────────────────────────────────────────────────────

interface Props {
  date: string
  appointments: Appointment[]
  maxTrucks: number
  isWeekendBlocked?: boolean
  currentProfile: Profile
  trucksForDay: Truck[]
  availableTrucks: Truck[]
  onClose: () => void
  onSuccess: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blankForm() {
  return { customerName: '', storageName: '', cwt: '', notes: '', selectedProducts: [] as ProductEntry[], truckId: '' }
}

function formFromAppt(appt: Appointment) {
  return {
    customerName:     appt.customer_name,
    storageName:      appt.storage_name ?? '',
    cwt:              appt.cwt?.toString() ?? '',
    notes:            appt.notes ?? '',
    selectedProducts: (appt.products as ProductEntry[]) ?? [],
    truckId:          appt.truck_id ?? '',
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function AppointmentModal({
  date,
  appointments,
  maxTrucks,
  isWeekendBlocked = false,
  currentProfile,
  trucksForDay,
  availableTrucks,
  onClose,
  onSuccess,
}: Props) {
  const supabase = createClient()
  const confirmedAppts = appointments.filter(a => a.status !== 'rejected')
  const isFull  = confirmedAppts.length >= maxTrucks || (isWeekendBlocked && maxTrucks === 0)
  const isAdmin = currentProfile.role === 'admin'

  const autoTruck = availableTrucks[0] ?? null

  // null = new appointment form, Appointment = editing that appointment
  const [editing, setEditing] = useState<Appointment | null>(null)
  const [showRequestForm, setShowRequestForm] = useState(false)

  // Form fields — shared between new & edit modes
  const [form, setForm] = useState(blankForm())
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const displayDate    = format(parseISO(date), 'EEEE, MMMM d, yyyy')
  const confirmedCount = confirmedAppts.length

  // ── Form helpers ────────────────────────────────────────────────────────────

  function set<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  function toggleProduct(product: string) {
    set('selectedProducts', form.selectedProducts.find(p => p.product === product)
      ? form.selectedProducts.filter(p => p.product !== product)
      : [...form.selectedProducts, { product, rate: PRODUCT_RATES[product][0] }]
    )
  }

  function setRate(product: string, rate: string) {
    set('selectedProducts', form.selectedProducts.map(p => p.product === product ? { ...p, rate } : p))
  }

  function isSelected(product: string) {
    return form.selectedProducts.some(p => p.product === product)
  }

  // ── Edit mode ───────────────────────────────────────────────────────────────

  function startEdit(appt: Appointment) {
    setEditing(appt)
    setForm(formFromAppt(appt))
    setError('')
    setShowRequestForm(false)
  }

  function cancelEdit() {
    setEditing(null)
    setForm(blankForm())
    setError('')
  }

  // ── Submit ──────────────────────────────────────────────────────────────────

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (form.selectedProducts.length === 0) {
      setError('Please select at least one product.')
      return
    }

    setLoading(true)

    // Resolve truck: admin picks from dropdown, salesman gets auto-assigned
    const truckId = isAdmin ? (form.truckId || null) : (autoTruck?.id ?? null)

    const payload = {
      customer_name: form.customerName,
      storage_name:  form.storageName,
      cwt:           form.cwt ? parseFloat(form.cwt) : null,
      products:      form.selectedProducts,
      notes:         form.notes,
      truck_id:      truckId,
      updated_at:    new Date().toISOString(),
    }

    try {
      if (editing) {
        // Update existing appointment
        const { error } = await supabase.from('appointments').update(payload).eq('id', editing.id)
        if (error) throw error
      } else if (isFull && !isAdmin) {
        // Submit approval request
        const { error } = await supabase.from('approval_requests').insert({
          salesman_id:   currentProfile.id,
          date,
          customer_name: form.customerName,
          storage_name:  form.storageName,
          cwt:           form.cwt ? parseFloat(form.cwt) : null,
          products:      form.selectedProducts,
          notes:         form.notes,
          truck_id:      truckId,
        })
        if (error) throw error
      } else {
        // New appointment
        const { error } = await supabase.from('appointments').insert({
          date,
          salesman_id: currentProfile.id,
          status:      'confirmed',
          ...payload,
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

  // ── Render ──────────────────────────────────────────────────────────────────

  const showNewForm = !editing && (!isFull || isAdmin || showRequestForm)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">

        {/* Header */}
        <div className="p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-semibold text-gray-900 text-lg">{displayDate}</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                {isWeekendBlocked && maxTrucks === 0
                  ? 'Weekend — admin approval required'
                  : `${confirmedCount} of ${maxTrucks} applications scheduled`}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 ml-4">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {maxTrucks > 0 && (
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
          )}
        </div>

        {/* Existing appointments */}
        {appointments.length > 0 && (
          <div className="p-5 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Scheduled</h3>
            <ul className="space-y-2">
              {appointments.map(appt => {
                const apptProducts = (appt.products as ProductEntry[]) ?? []
                const canEdit = isAdmin || appt.salesman_id === currentProfile.id
                const isEditingThis = editing?.id === appt.id
                return (
                  <li key={appt.id} className={`rounded-xl px-3 py-2 border ${isEditingThis ? 'border-blue-300 bg-blue-50' : 'bg-gray-50 border-transparent'}`}>
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-gray-900">{appt.customer_name}</p>
                          {appt.truck_name && (
                            <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
                              {appt.truck_name}
                            </span>
                          )}
                          {isEditingThis && (
                            <span className="text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded-full">Editing</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">{appt.salesman_name}</p>
                        {appt.applicator_name && <p className="text-xs text-gray-400">Applicator: {appt.applicator_name}</p>}
                        {appt.storage_name && <p className="text-xs text-gray-500">Storage: {appt.storage_name}</p>}
                        {appt.cwt && <p className="text-xs text-gray-500">CWT: {appt.cwt.toLocaleString()}</p>}
                        {apptProducts.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {apptProducts.map((pe, i) => (
                              <span key={i} className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">
                                {pe.product} · {pe.rate}
                              </span>
                            ))}
                          </div>
                        )}
                        {appt.notes && <p className="text-xs text-gray-400 mt-0.5">{appt.notes}</p>}
                      </div>
                      {canEdit && (
                        <div className="flex items-center gap-2 ml-2 shrink-0">
                          {appt.status === 'pending_approval' && (
                            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Pending</span>
                          )}
                          {isEditingThis ? (
                            <button onClick={cancelEdit} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
                          ) : (
                            <button onClick={() => startEdit(appt)} className="text-blue-500 hover:text-blue-700 text-xs font-medium">Edit</button>
                          )}
                          <button onClick={() => handleDelete(appt)} className="text-red-400 hover:text-red-600 text-xs">Remove</button>
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Full / blocked warning (only when not in edit mode) */}
        {!editing && isFull && !isAdmin && !showRequestForm && (
          <div className="p-5">
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-center">
              <svg className="w-8 h-8 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <p className="font-semibold text-red-800">
                {isWeekendBlocked ? 'Weekend — not open for scheduling' : 'This day is fully booked'}
              </p>
              <p className="text-sm text-red-600 mt-1">
                {isWeekendBlocked ? 'Weekends require admin approval.' : `All ${maxTrucks} slots are taken.`}
              </p>
              <div className="flex gap-2 mt-4">
                <button onClick={onClose} className="flex-1 bg-white border border-gray-200 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors">
                  Choose another day
                </button>
                <button onClick={() => setShowRequestForm(true)} className="flex-1 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 transition-colors">
                  Request approval
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Form — new appointment or inline edit */}
        {(editing || showNewForm) && (
          <form onSubmit={handleSubmit} className="p-5 space-y-5">

            {/* Edit mode header */}
            {editing && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800 flex items-center justify-between">
                <span>Editing <strong>{editing.customer_name}</strong></span>
                <button type="button" onClick={cancelEdit} className="text-blue-500 hover:text-blue-700 text-xs font-medium">
                  Cancel edit
                </button>
              </div>
            )}

            {showRequestForm && !editing && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-800">
                This will send an approval request to the admin for an extra slot on this day.
              </div>
            )}

            {/* Truck assignment */}
            <div className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-200">
              <p className="text-xs font-medium text-gray-500 mb-1">Assigned Truck</p>
              {isAdmin ? (
                <select
                  value={form.truckId}
                  onChange={e => set('truckId', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">— No truck —</option>
                  {trucksForDay.map(t => {
                    const taken = !availableTrucks.find(a => a.id === t.id) && t.id !== editing?.truck_id
                    return (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.applicator_name ? ` (${t.applicator_name})` : ''}{taken ? ' — already booked' : ''}
                      </option>
                    )
                  })}
                </select>
              ) : (
                <p className="text-sm font-medium text-gray-900">
                  {editing?.truck_name
                    ? editing.truck_name
                    : autoTruck
                      ? <>{autoTruck.name}{autoTruck.applicator_name ? <span className="text-gray-500 font-normal"> · {autoTruck.applicator_name}</span> : null}</>
                      : <span className="text-gray-400 italic">No truck available</span>
                  }
                </p>
              )}
            </div>

            {/* Customer Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Name</label>
              <input
                type="text" required
                value={form.customerName}
                onChange={e => set('customerName', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="John Smith"
              />
            </div>

            {/* Storage Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Storage Name</label>
              <input
                type="text"
                value={form.storageName}
                onChange={e => set('storageName', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. North Facility"
              />
            </div>

            {/* CWT */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">CWT to Treat</label>
              <input
                type="number" min={0} step="any"
                value={form.cwt}
                onChange={e => set('cwt', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 50000"
              />
            </div>

            {/* Products */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Products</label>
              <div className="space-y-2">
                {PRODUCTS.map(product => (
                  <div key={product} className={`rounded-xl border transition-colors ${
                    isSelected(product) ? 'border-blue-300 bg-blue-50' : 'border-gray-200 bg-white'
                  }`}>
                    <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isSelected(product)}
                        onChange={() => toggleProduct(product)}
                        className="w-4 h-4 rounded text-blue-600 border-gray-300 focus:ring-blue-500"
                      />
                      <span className={`text-sm font-medium ${isSelected(product) ? 'text-blue-800' : 'text-gray-700'}`}>
                        {product}
                      </span>
                    </label>
                    {isSelected(product) && (
                      <div className="px-3 pb-3">
                        <label className="block text-xs font-medium text-blue-700 mb-1">Rate</label>
                        <select
                          value={form.selectedProducts.find(p => p.product === product)?.rate ?? ''}
                          onChange={e => setRate(product, e.target.value)}
                          className="w-full border border-blue-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                          {PRODUCT_RATES[product].map(rate => (
                            <option key={rate} value={rate}>{rate}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={form.notes}
                onChange={e => set('notes', e.target.value)}
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Special instructions…"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={editing ? cancelEdit : onClose}
                className="flex-1 bg-white border border-gray-200 text-gray-700 text-sm font-medium py-2 rounded-lg hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-medium py-2 rounded-lg transition-colors"
              >
                {loading ? 'Saving…' : editing ? 'Save changes' : showRequestForm ? 'Send request' : 'Schedule'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
