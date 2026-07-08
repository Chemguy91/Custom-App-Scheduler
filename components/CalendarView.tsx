'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  format, isSameMonth, isToday, isBefore, startOfDay,
  parseISO, addMonths, subMonths, addWeeks, subWeeks, getDay,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { Appointment, BlackoutDay, CapacityRule, DailyCapacity, Profile, Truck } from '@/lib/types'
import AppointmentModal from './AppointmentModal'
import { useDemoProfile, useIsDemo, useDemoPersonas } from './DemoWrapper'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ─── Applicator Job Detail Modal ──────────────────────────────────────────────

function ApptDetailModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const isDisinfect = appt.job_type === 'stg_disinfect'

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{appt.customer_name}</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {format(parseISO(appt.date), 'EEEE, MMMM d, yyyy')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-2xl leading-none mt-0.5"
          >
            ×
          </button>
        </div>

        {/* Details grid */}
        <div className="space-y-3 text-sm">
          {/* Job type */}
          <Row label="Job type">
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${isDisinfect ? 'chip-disinfect' : 'bg-blue-50 text-blue-700'}`}>
              {isDisinfect ? 'Stg Disinfect' : 'Application'}
            </span>
          </Row>

          {/* Truck */}
          {appt.truck_name && (
            <Row label="Truck">{appt.truck_name}</Row>
          )}

          {/* Storage */}
          {appt.storage_name && (
            <Row label="Storage">{appt.storage_name}</Row>
          )}

          {/* Capacity / CWT */}
          {appt.storage_capacity != null && (
            <Row label="Capacity">{appt.storage_capacity.toLocaleString()} bu</Row>
          )}
          {appt.cwt != null && (
            <Row label="CWT">{appt.cwt}</Row>
          )}

          {/* Products */}
          {!isDisinfect && appt.products?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Products</p>
              <div className="space-y-1">
                {appt.products.map(p => (
                  <div key={p.product} className="flex justify-between bg-gray-50 dark:bg-gray-800 rounded px-3 py-1.5">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{p.product}</span>
                    <span className="text-gray-500 dark:text-gray-400">{p.rate}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Account Manager */}
          {appt.salesman_name && (
            <Row label="Account Manager">{appt.salesman_name}</Row>
          )}

          {/* Slots */}
          {(appt.slot_count ?? 1) > 1 && (
            <Row label="Truck slots">{appt.slot_count}</Row>
          )}

          {/* Notes */}
          {appt.notes && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-800 rounded px-3 py-2 whitespace-pre-wrap">
                {appt.notes}
              </p>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full mt-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium py-2 rounded-xl text-sm transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-gray-500 dark:text-gray-400 font-medium">{label}</span>
      <span className="text-gray-900 dark:text-white text-right">{children}</span>
    </div>
  )
}

/** Returns the CSS class name that colours an appointment chip by its product. */
function getProductChipClass(a: { job_type: string; products?: { product: string; rate: string }[] }): string {
  if (a.job_type === 'stg_disinfect') return 'chip-disinfect'
  for (const entry of (a.products ?? [])) {
    const n = (entry.product ?? '').toLowerCase()
    if (n.includes('smart block'))                         return 'chip-purple'
    if (n.includes('1,4') || n.includes('zap'))           return 'chip-yellow'
    if (n.includes('dmn'))                                 return 'chip-brown'
    if (n.includes('storox') || n.includes('perox'))      return 'chip-green'
    if (n.includes('purogene'))                            return 'chip-blue'
    if (n.includes('cipc'))                                return 'chip-orange'
    if (n.includes('amplify'))                             return 'chip-white'
    if (n.includes('fresh pack'))                          return 'chip-pink'
  }
  return 'chip-default'
}

interface DayCapacityResult {
  max: number
  isWeekendBlocked: boolean
}

export default function CalendarView({ profile: serverProfile }: { profile: Profile }) {
  const profile  = useDemoProfile(serverProfile)
  const isDemo   = useIsDemo()
  const { demoSalesmanId, demoApplicatorId } = useDemoPersonas()
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [capacities, setCapacities]     = useState<DailyCapacity[]>([])
  const [capacityRules, setCapacityRules] = useState<CapacityRule[]>([])
  const [trucks, setTrucks]             = useState<Truck[]>([])
  const [salesManagers, setSalesManagers] = useState<{ id: string; name: string }[]>([])
  const [blackoutDays, setBlackoutDays] = useState<BlackoutDay[]>([])
  const [defaultMax, setDefaultMax]     = useState(5)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [showMyOnly, setShowMyOnly]               = useState(false)
  const [applicatorViewAll, setApplicatorViewAll] = useState(false)
  const [viewerSalesmanFilter, setViewerSalesmanFilter] = useState<string | null>(null)
  const [adminSalesmanFilter,  setAdminSalesmanFilter]  = useState<string | null>(null)
  const [adminTruckFilter,     setAdminTruckFilter]     = useState<string | null>(null)
  const [detailAppt, setDetailAppt] = useState<Appointment | null>(null)
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'list'>('month')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }))

  // Drag & drop state
  const [draggedAppt, setDraggedAppt]   = useState<Appointment | null>(null)
  const [dragOverDate, setDragOverDate] = useState<string | null>(null)
  const [dragError, setDragError]       = useState<string | null>(null)

  const supabase = createClient()

  const isViewer       = profile.role === 'viewer'
  const isApplicator   = profile.role === 'applicator'
  const isSalesManager = profile.role === 'sales_manager'
  const isAdmin        = profile.role === 'admin'
  const canSchedule    = isSalesManager || isAdmin

  // The truck assigned to this applicator (use demo persona ID when in demo mode)
  const effectiveApplicatorId = isDemo && demoApplicatorId ? demoApplicatorId : profile.id
  const myTruck = isApplicator ? trucks.find(t => t.applicator_id === effectiveApplicatorId) ?? null : null

  // Effective salesman ID for "My Jobs" filter (use demo persona ID when in demo mode)
  const effectiveSalesmanId = isDemo && demoSalesmanId ? demoSalesmanId : profile.id

  // Unique salespeople derived from appointments — used by viewer filter (excludes "Test")
  const viewerSalespeople = isViewer
    ? Array.from(
        new Map(
          appointments
            .filter(a => a.salesman_id && a.salesman_name && a.salesman_name.toLowerCase() !== 'test')
            .map(a => [a.salesman_id!, a.salesman_name!] as [string, string])
        ).entries()
      )
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name))
    : []

  // Admin filter lists — salesmen from profiles, trucks from loaded trucks state
  const adminSalespeople = isAdmin ? salesManagers : []

  const adminTrucks = isAdmin
    ? trucks
        .filter(t => t.applicator_name)
        .map(t => ({ id: t.id, label: t.applicator_name ? `${t.name} · ${t.applicator_name}` : t.name }))
        .sort((a, b) => a.label.localeCompare(b.label))
    : []

  const fetchData = useCallback(async () => {
    setLoading(true)
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
    const monthEnd   = format(endOfMonth(currentMonth),   'yyyy-MM-dd')

    const [apptRes, capRes, rulesRes, trucksRes, settingsRes, blackoutRes] =
      await Promise.all([
        supabase.from('appointments_with_details').select('*').gte('date', monthStart).lte('date', monthEnd).neq('status', 'rejected').eq('is_demo', isDemo),
        supabase.from('daily_capacity').select('*').gte('date', monthStart).lte('date', monthEnd),
        supabase.from('capacity_rules').select('*'),
        supabase.from('trucks_with_details').select('*'),
        supabase.from('settings').select('value').eq('key', 'default_daily_capacity').single(),
        supabase.from('blackout_days').select('*').gte('date', monthStart).lte('date', monthEnd),
      ])

    if (apptRes.data) {
      const appts = apptRes.data as unknown as Appointment[]
      setAppointments(
        profile.role === 'viewer'
          ? appts.filter(a => (a.salesman_name ?? '').toLowerCase() !== 'test')
          : appts
      )
    }
    if (capRes.data)      setCapacities(capRes.data as unknown as DailyCapacity[])
    if (rulesRes.data)    setCapacityRules(rulesRes.data as unknown as CapacityRule[])
    if (trucksRes.data)   setTrucks(trucksRes.data as unknown as Truck[])
    if (settingsRes.data) setDefaultMax(parseInt((settingsRes.data as unknown as { value: string }).value) || 5)
    if (blackoutRes.data) setBlackoutDays(blackoutRes.data as unknown as BlackoutDay[])

    if (isAdmin) {
      const smRes = await supabase.from('profiles').select('id, full_name').eq('role', 'sales_manager').order('full_name')
      if (smRes.data) {
        setSalesManagers((smRes.data as unknown as { id: string; full_name: string }[]).map(p => ({ id: p.id, name: p.full_name })))
      }
    }

    setLoading(false)
  }, [currentMonth, supabase, profile.id, isDemo, isAdmin])

  useEffect(() => { fetchData() }, [fetchData])

  // Sync currentMonth to weekStart when week view crosses a month boundary
  useEffect(() => {
    if (viewMode === 'week' && format(weekStart, 'yyyy-MM') !== format(currentMonth, 'yyyy-MM')) {
      setCurrentMonth(new Date(weekStart))
    }
  }, [weekStart, viewMode])

  const monthStart = startOfMonth(currentMonth)
  const monthEnd   = endOfMonth(currentMonth)
  const gridStart  = startOfWeek(monthStart)
  const gridEnd    = endOfWeek(monthEnd)
  const days       = eachDayOfInterval({ start: gridStart, end: gridEnd })
  const weekDays   = eachDayOfInterval({ start: weekStart, end: endOfWeek(weekStart, { weekStartsOn: 0 }) })

  function getAppointments(dateStr: string) {
    return appointments.filter(a => a.date === dateStr)
  }

  function getTrucksForDate(dateStr: string): Truck[] {
    return trucks.filter(t =>
      (!t.active_from || t.active_from <= dateStr) &&
      (!t.active_to   || t.active_to   >= dateStr)
    )
  }

  function getAvailableTrucks(dateStr: string): Truck[] {
    const active = getTrucksForDate(dateStr)

    // Respect capacity rule truck_ids — same logic as getDateCapacity
    const coveringRules = capacityRules
      .filter(r => r.start_date <= dateStr && r.end_date >= dateStr)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const eligible = (coveringRules.length > 0 && coveringRules[0].truck_ids?.length)
      ? active.filter(t => coveringRules[0].truck_ids!.includes(t.id))
      : active

    const assignedTruckIds = getAppointments(dateStr)
      .filter(a => a.status !== 'rejected' && a.truck_id)
      .map(a => a.truck_id!)

    return eligible.filter(t => !assignedTruckIds.includes(t.id))
  }

  // Computes the effective max slots for a date using closure over all state.
  function getDateCapacity(dateStr: string): DayCapacityResult {
    const date = parseISO(dateStr)
    const dayOfWeek = getDay(date)
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

    // 1. Exact daily override wins
    const override = capacities.find(c => c.date === dateStr)
    if (override) return { max: override.max_trucks, isWeekendBlocked: false }

    // 2. All trucks active on this date
    const allActiveTrucks = getTrucksForDate(dateStr)

    // 3. Find owning capacity rule (most recently created that covers this date)
    const coveringRules = capacityRules
      .filter(r => r.start_date <= dateStr && r.end_date >= dateStr)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

    // 4. If rule has specific truck_ids, restrict to those trucks
    let ruleTrucks = allActiveTrucks
    if (coveringRules.length > 0 && coveringRules[0].truck_ids?.length) {
      ruleTrucks = allActiveTrucks.filter(t => coveringRules[0].truck_ids!.includes(t.id))
    }

    // 5. Available truck count (assigned trucks already excluded via getAvailableTrucks)
    const truckCap = ruleTrucks.length

    // 6. Apply rule or fallback
    if (coveringRules.length > 0) {
      const owningRule = coveringRules[0]
      if (!owningRule.days_of_week.includes(dayOfWeek)) {
        return { max: 0, isWeekendBlocked: true }
      }
      const ruleMax = owningRule.max_applications
      const effectiveMax = ruleTrucks.length > 0 ? Math.min(ruleMax, truckCap) : ruleMax
      return { max: effectiveMax, isWeekendBlocked: false }
    }

    if (allActiveTrucks.length > 0) {
      if (isWeekend) return { max: 0, isWeekendBlocked: true }
      return { max: truckCap, isWeekendBlocked: false }
    }

    if (isWeekend) return { max: 0, isWeekendBlocked: true }
    return { max: defaultMax, isWeekendBlocked: false }
  }

  const selectedDateAppointments = selectedDate ? getAppointments(selectedDate) : []
  const selectedDayCapacity = selectedDate
    ? getDateCapacity(selectedDate)
    : { max: defaultMax, isWeekendBlocked: false }

  function handleDayClick(dateStr: string) {
    if (isViewer || isApplicator || draggedAppt) return
    setSelectedDate(dateStr)
  }

  // ── Drag & Drop ─────────────────────────────────────────────────────────────

  function canDrag(appt: Appointment): boolean {
    return isAdmin || appt.salesman_id === profile.id
  }

  function handleDragStart(e: React.DragEvent, appt: Appointment) {
    e.stopPropagation()
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', appt.id)
    setDraggedAppt(appt)
    setDragError(null)
  }

  function handleDragEnd() {
    setDraggedAppt(null)
    setDragOverDate(null)
  }

  function handleDragOver(e: React.DragEvent, dateStr: string) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverDate(dateStr)
  }

  function handleDragLeave(e: React.DragEvent) {
    // Only clear if leaving the cell entirely (not just moving between children)
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDragOverDate(null)
    }
  }

  async function handleDrop(e: React.DragEvent, targetDate: string) {
    e.preventDefault()
    setDragOverDate(null)

    if (!draggedAppt) return
    if (draggedAppt.date === targetDate) { setDraggedAppt(null); return }
    if (!canDrag(draggedAppt)) { setDraggedAppt(null); return }

    // Check capacity on target date (exclude the appointment being moved)
    const targetAppts = getAppointments(targetDate).filter(a => a.id !== draggedAppt.id && a.status !== 'rejected')
    const { max, isWeekendBlocked } = getDateCapacity(targetDate)

    if (isWeekendBlocked && max === 0 && !isAdmin) {
      setDragError('That day requires admin approval.')
      setDraggedAppt(null)
      setTimeout(() => setDragError(null), 3000)
      return
    }

    if (targetAppts.length >= max && !isAdmin) {
      setDragError(`${format(parseISO(targetDate), 'MMM d')} is fully booked.`)
      setDraggedAppt(null)
      setTimeout(() => setDragError(null), 3000)
      return
    }

    const { error } = await supabase
      .from('appointments')
      .update({ date: targetDate, updated_at: new Date().toISOString() })
      .eq('id', draggedAppt.id)

    setDraggedAppt(null)
    if (!error) fetchData()
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {isViewer && (
        <div className="mb-4 space-y-3">
          <div className="bg-gray-100 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-500 text-center">
            You have view-only access to this calendar.
          </div>
          {/* Account Manager filter */}
          <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
            <p className="text-xs font-medium text-gray-400 mb-2">Filter by account manager</p>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setViewerSalesmanFilter(null)}
                className={`text-sm px-3 py-1 rounded-lg font-medium transition-colors border ${
                  viewerSalesmanFilter === null
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                }`}
              >
                All
              </button>
              {viewerSalespeople.map(s => (
                <button
                  key={s.id}
                  onClick={() => setViewerSalesmanFilter(prev => prev === s.id ? null : s.id)}
                  className={`text-sm px-3 py-1 rounded-lg font-medium transition-colors border ${
                    viewerSalesmanFilter === s.id
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {s.name}
                </button>
              ))}
              {viewerSalespeople.length === 0 && (
                <span className="text-sm text-gray-400 italic">No jobs scheduled this month</span>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Admin filters */}
      {isAdmin && (
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {adminSalespeople.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">Account Manager:</span>
              <select
                value={adminSalesmanFilter ?? ''}
                onChange={e => setAdminSalesmanFilter(e.target.value || null)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                {adminSalespeople.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          {adminTrucks.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 dark:text-gray-400 whitespace-nowrap">Applicator:</span>
              <select
                value={adminTruckFilter ?? ''}
                onChange={e => setAdminTruckFilter(e.target.value || null)}
                className="border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All</option>
                {adminTrucks.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          )}
          {(adminSalesmanFilter || adminTruckFilter) && (
            <button
              onClick={() => { setAdminSalesmanFilter(null); setAdminTruckFilter(null) }}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {dragError && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-xl px-4 py-2 text-sm text-red-700 text-center">
          {dragError}
        </div>
      )}
      {canSchedule && !isApplicator && (
        <div className="mb-4 bg-gray-50 border border-gray-200 rounded-xl px-4 py-2 text-xs text-gray-400 text-center">
          Drag an appointment to move it to a different day
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        {/* Title */}
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">
          {viewMode === 'week'
            ? `${format(weekStart, 'MMM d')} – ${format(endOfWeek(weekStart, { weekStartsOn: 0 }), 'MMM d, yyyy')}`
            : format(currentMonth, 'MMMM yyyy')}
        </h2>

        <div className="flex items-center gap-2 flex-wrap">
          {/* My jobs / All jobs toggle — sales managers */}
          {isSalesManager && (
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 text-sm">
              <button onClick={() => setShowMyOnly(false)} className={`px-3 py-1.5 rounded-md font-medium transition-colors ${!showMyOnly ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>All jobs</button>
              <button onClick={() => setShowMyOnly(true)}  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${showMyOnly  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>My jobs</button>
            </div>
          )}

          {/* My jobs / All jobs toggle — applicators */}
          {isApplicator && (
            <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 text-sm">
              <button onClick={() => setApplicatorViewAll(false)} className={`px-3 py-1.5 rounded-md font-medium transition-colors ${!applicatorViewAll ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>My jobs</button>
              <button onClick={() => setApplicatorViewAll(true)}  className={`px-3 py-1.5 rounded-md font-medium transition-colors ${applicatorViewAll  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>All jobs</button>
            </div>
          )}

          {/* View mode toggle — all users */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5 text-sm">
            {(['month', 'week', 'list'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => {
                  setViewMode(mode)
                  if (mode === 'week') setWeekStart(startOfWeek(currentMonth, { weekStartsOn: 0 }))
                }}
                className={`px-3 py-1.5 rounded-md font-medium capitalize transition-colors ${
                  viewMode === mode ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>

          {/* Prev / Today / Next */}
          <button
            onClick={() => viewMode === 'week' ? setWeekStart(w => subWeeks(w, 1)) : setCurrentMonth(m => subMonths(m, 1))}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => { const t = new Date(); setCurrentMonth(t); setWeekStart(startOfWeek(t, { weekStartsOn: 0 })) }}
            className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-600 dark:text-gray-300"
          >
            Today
          </button>
          <button
            onClick={() => viewMode === 'week' ? setWeekStart(w => addWeeks(w, 1)) : setCurrentMonth(m => addMonths(m, 1))}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <svg className="w-4 h-4 text-gray-600 dark:text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && <div className="h-96 flex items-center justify-center text-gray-400">Loading calendar…</div>}

      {/* ── MONTH VIEW ── */}
      {!loading && viewMode === 'month' && (
        <>
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 py-2">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-700 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700">
          {days.map(day => {
            const dateStr    = format(day, 'yyyy-MM-dd')
            const inMonth    = isSameMonth(day, currentMonth)
            const today      = isToday(day)
            const isPast     = inMonth && isBefore(day, startOfDay(new Date()))
            const dayAppts   = getAppointments(dateStr)
            // For chip display: filter based on role toggles
            const visibleAppts = isApplicator
              ? (applicatorViewAll
                  ? dayAppts
                  : dayAppts.filter(a => myTruck ? a.truck_id === myTruck.id : false))
              : isViewer && viewerSalesmanFilter
                ? dayAppts.filter(a => a.salesman_id === viewerSalesmanFilter)
                : (isSalesManager && showMyOnly)
                  ? dayAppts.filter(a => a.salesman_id === effectiveSalesmanId)
                  : isAdmin && (adminSalesmanFilter || adminTruckFilter)
                    ? dayAppts.filter(a =>
                        (!adminSalesmanFilter || a.salesman_id === adminSalesmanFilter) &&
                        (!adminTruckFilter    || a.truck_id    === adminTruckFilter)
                      )
                    : dayAppts
            const blackout  = blackoutDays.find(b => b.date === dateStr) ?? null
            const { max, isWeekendBlocked } = getDateCapacity(dateStr)
            // Sum slot_count across all non-rejected appointments on this day.
            // Applications default to 1 slot; disinfects default to 0 but can be raised.
            const count = dayAppts
              .filter(a => a.status !== 'rejected')
              .reduce((sum, a) => sum + (a.slot_count ?? (a.job_type === 'stg_disinfect' ? 0 : 1)), 0)
            const full     = count >= max
            const blocked  = isWeekendBlocked && count === 0
            const isDragTarget = dragOverDate === dateStr && draggedAppt !== null

            return (
              <div
                key={dateStr}
                onClick={() => handleDayClick(dateStr)}
                onDragOver={canSchedule ? e => handleDragOver(e, dateStr) : undefined}
                onDragLeave={canSchedule ? handleDragLeave : undefined}
                onDrop={canSchedule ? e => handleDrop(e, dateStr) : undefined}
                className={`
                  min-h-[80px] p-2 text-left transition-colors
                  ${!inMonth ? 'opacity-40 bg-white' : ''}
                  ${inMonth && isPast && !blackout ? 'cal-past' : ''}
                  ${inMonth && !isPast && !blackout ? 'cal-future' : ''}
                  ${today ? 'ring-2 ring-inset ring-blue-500' : ''}
                  ${blocked ? 'bg-gray-50' : ''}
                  ${blackout ? 'cal-blackout' : ''}
                  ${!isViewer ? 'cursor-pointer' : 'cursor-default'}
                  ${isDragTarget ? 'bg-blue-100 ring-2 ring-inset ring-blue-400' : ''}
                `}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                    today ? 'bg-blue-600 text-white' : isPast ? 'cal-past-num' : 'text-gray-900'
                  }`}>
                    {format(day, 'd')}
                  </span>
                  {/* Job count badge — visible to all users */}
                  {inMonth && visibleAppts.length > 0 && (
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                      {visibleAppts.length}
                    </span>
                  )}
                </div>

                {/* Blackout / holiday label */}
                {blackout && inMonth && !isApplicator && (
                  <div className="mt-1">
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700 block truncate">
                      {blackout.reason ? blackout.reason : 'Blocked'}
                    </span>
                  </div>
                )}

                {/* Capacity pill — hidden on blackout days */}
                {!isApplicator && !blocked && !blackout && max > 0 && inMonth && (
                  <div className="mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      full ? 'bg-red-100 text-red-700' : count > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {count}/{max}
                    </span>
                  </div>
                )}

                {/* Weekend blocked */}
                {blocked && !blackout && inMonth && !isApplicator && (
                  <div className="mt-1">
                    <span className="text-xs text-gray-400 italic">Approval req.</span>
                  </div>
                )}

                {/* Appointment chips */}
                {(isApplicator ? inMonth : true) && (
                  <div className="mt-1 space-y-0.5">
                    {visibleAppts.slice(0, 3).map(a => {
                      const draggable = !isApplicator && canDrag(a) && canSchedule
                      const isDisinfect = a.job_type === 'stg_disinfect'
                      const chipClass = getProductChipClass(a)
                      return (
                        <div
                          key={a.id}
                          draggable={draggable}
                          onDragStart={draggable ? e => handleDragStart(e, a) : undefined}
                          onDragEnd={draggable ? handleDragEnd : undefined}
                          onClick={e => { e.stopPropagation(); if (isApplicator) setDetailAppt(a) }}
                          className={`text-xs truncate rounded px-1 py-0.5 select-none ${chipClass}
                            ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}
                            ${isApplicator ? 'cursor-pointer hover:opacity-80' : ''}
                            ${draggedAppt?.id === a.id ? 'opacity-40' : ''}
                          `}
                        >
                          <span className="font-medium">{a.customer_name}</span>
                          {!isDisinfect && a.truck_name && <span className="opacity-70 ml-1">· {a.truck_name}</span>}
                          {isDisinfect && <span className="opacity-70 ml-1">· Disinfect</span>}
                          {(a.slot_count ?? (isDisinfect ? 0 : 1)) > 1 && (
                            <span className="opacity-75 ml-1">×{a.slot_count}</span>
                          )}
                        </div>
                      )
                    })}
                    {visibleAppts.length > 3 && (
                      <div className="text-xs text-gray-400">+{visibleAppts.length - 3} more</div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
        </>
      )}

      {/* ── WEEK VIEW ── */}
      {!loading && viewMode === 'week' && (
        <div className="grid grid-cols-7 gap-2">
          {weekDays.map(day => {
            const dateStr = format(day, 'yyyy-MM-dd')
            const today   = isToday(day)
            const isPast  = isBefore(day, startOfDay(new Date()))
            const blackout = blackoutDays.find(b => b.date === dateStr) ?? null
            const dayAppts = getAppointments(dateStr)
            const visibleAppts = isApplicator
              ? (applicatorViewAll ? dayAppts : dayAppts.filter(a => myTruck ? a.truck_id === myTruck.id : false))
              : isViewer && viewerSalesmanFilter
                ? dayAppts.filter(a => a.salesman_id === viewerSalesmanFilter)
                : (isSalesManager && showMyOnly)
                  ? dayAppts.filter(a => a.salesman_id === effectiveSalesmanId)
                  : isAdmin && (adminSalesmanFilter || adminTruckFilter)
                    ? dayAppts.filter(a =>
                        (!adminSalesmanFilter || a.salesman_id === adminSalesmanFilter) &&
                        (!adminTruckFilter    || a.truck_id    === adminTruckFilter)
                      )
                    : dayAppts
            const jobCount = visibleAppts.length

            return (
              <div
                key={dateStr}
                className={`rounded-xl border p-2 min-h-[140px] flex flex-col gap-1 transition-colors
                  ${today ? 'border-blue-400 dark:border-blue-500' : 'border-gray-200 dark:border-gray-700'}
                  ${blackout ? 'cal-blackout' : isPast ? 'cal-past' : 'cal-future'}
                  ${!isViewer && !blackout ? 'cursor-pointer' : ''}
                `}
                onClick={() => !isViewer && !blackout ? handleDayClick(dateStr) : undefined}
              >
                {/* Day header */}
                <div className="text-center mb-1">
                  <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">{format(day, 'EEE')}</p>
                  <span className={`text-base font-bold w-8 h-8 flex items-center justify-center rounded-full mx-auto ${
                    today ? 'bg-blue-600 text-white' : isPast ? 'cal-past-num' : 'text-gray-900 dark:text-white'
                  }`}>
                    {format(day, 'd')}
                  </span>
                  {jobCount > 0 && (
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {jobCount} job{jobCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {/* Appointment chips */}
                <div className="flex-1 space-y-1">
                  {blackout && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-red-100 text-red-700 block truncate">
                      {blackout.reason || 'Blocked'}
                    </span>
                  )}
                  {visibleAppts.map(a => {
                    const chipClass = getProductChipClass(a)
                    return (
                      <div
                        key={a.id}
                        onClick={e => { e.stopPropagation(); if (isApplicator) setDetailAppt(a) }}
                        className={`text-xs rounded px-1.5 py-1 ${chipClass} ${isApplicator ? 'cursor-pointer hover:opacity-80' : ''}`}
                      >
                        <p className="font-medium truncate">{a.customer_name}</p>
                        {a.truck_name && <p className="opacity-70 truncate">{a.truck_name}</p>}
                        {(a.products ?? []).length > 0 && (
                          <p className="opacity-60 truncate">{a.products[0].product}</p>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {!loading && viewMode === 'list' && (() => {
        const listDays = days
          .filter(d => isSameMonth(d, currentMonth))
          .map(d => {
            const dateStr  = format(d, 'yyyy-MM-dd')
            const dayAppts = getAppointments(dateStr)
            const visible  = isApplicator
              ? (applicatorViewAll ? dayAppts : dayAppts.filter(a => myTruck ? a.truck_id === myTruck.id : false))
              : isViewer && viewerSalesmanFilter
                ? dayAppts.filter(a => a.salesman_id === viewerSalesmanFilter)
                : (isSalesManager && showMyOnly)
                  ? dayAppts.filter(a => a.salesman_id === effectiveSalesmanId)
                  : isAdmin && (adminSalesmanFilter || adminTruckFilter)
                    ? dayAppts.filter(a =>
                        (!adminSalesmanFilter || a.salesman_id === adminSalesmanFilter) &&
                        (!adminTruckFilter    || a.truck_id    === adminTruckFilter)
                      )
                    : dayAppts
            return { date: d, dateStr, appts: visible }
          })
          .filter(d => d.appts.length > 0)

        if (listDays.length === 0) {
          return (
            <div className="text-center py-16 text-gray-400 dark:text-gray-600">
              No jobs scheduled this month.
            </div>
          )
        }

        return (
          <div className="space-y-4">
            {listDays.map(({ date, dateStr, appts }) => {
              const blackout = blackoutDays.find(b => b.date === dateStr)
              const today    = isToday(date)
              return (
                <div key={dateStr} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
                  {/* Date header */}
                  <div
                    className={`px-4 py-2.5 flex items-center justify-between border-b border-gray-100 dark:border-gray-700 ${
                      today ? 'bg-blue-50 dark:bg-blue-950' : 'bg-gray-50 dark:bg-gray-800'
                    }`}
                    onClick={() => !isViewer && !blackout ? handleDayClick(dateStr) : undefined}
                  >
                    <div className="flex items-center gap-2">
                      <h3 className={`font-semibold ${today ? 'text-blue-700 dark:text-blue-400' : 'text-gray-900 dark:text-white'}`}>
                        {format(date, 'EEEE, MMMM d')}
                      </h3>
                      {today && <span className="text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full font-medium">Today</span>}
                      {blackout && <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">{blackout.reason || 'Blocked'}</span>}
                    </div>
                    <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {appts.length} job{appts.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {/* Job rows */}
                  <ul className="divide-y divide-gray-50 dark:divide-gray-800">
                    {appts.map(a => {
                      const chipClass = getProductChipClass(a)
                      const isDisinfect = a.job_type === 'stg_disinfect'
                      return (
                        <li
                          key={a.id}
                          className="px-4 py-3 flex items-start gap-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer"
                          onClick={() => isApplicator ? setDetailAppt(a) : handleDayClick(dateStr)}
                        >
                          <span className={`text-xs px-2 py-1 rounded font-medium flex-shrink-0 mt-0.5 ${chipClass}`}>
                            {isDisinfect ? 'Disinfect' : 'App'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{a.customer_name}</p>
                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                              {a.truck_name && <p className="text-xs text-gray-500 dark:text-gray-400">{a.truck_name}</p>}
                              {a.salesman_name && <p className="text-xs text-gray-400 dark:text-gray-500">{a.salesman_name}</p>}
                              {!isDisinfect && (a.products ?? []).length > 0 && (
                                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{a.products.map(p => p.product).join(', ')}</p>
                              )}
                              {a.storage_name && <p className="text-xs text-gray-400 dark:text-gray-500">{a.storage_name}</p>}
                            </div>
                            {a.notes && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 italic truncate">{a.notes}</p>}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* Legend */}
      <div className="mt-5 space-y-3">
        {!isApplicator && (
          <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-100 border border-blue-300 inline-block" />Available</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-100 border border-red-300 inline-block" />Full</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-gray-100 border border-gray-300 inline-block" />Approval required</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded inline-block cal-blackout border border-red-300" />Blocked / Holiday</span>
          </div>
        )}
        {!isViewer && (
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1.5">Product colors</p>
            <div className="flex flex-wrap gap-2">
              {([
                { label: 'Smart Block',       cls: 'chip-purple'    },
                { label: '1,4 Zap',           cls: 'chip-yellow'    },
                { label: 'DMN',               cls: 'chip-brown'     },
                { label: 'Storox / Perox AG', cls: 'chip-green'     },
                { label: 'Purogene Pro',      cls: 'chip-blue'      },
                { label: 'CIPC',              cls: 'chip-orange'    },
                { label: 'Amplify',           cls: 'chip-white'     },
                { label: 'Fresh Pack 100',    cls: 'chip-pink'      },
                { label: 'Stg Disinfect',     cls: 'chip-disinfect' },
              ] as const).map(({ label, cls }) => (
                <span key={label} className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {detailAppt && (
        <ApptDetailModal appt={detailAppt} onClose={() => setDetailAppt(null)} />
      )}

      {selectedDate && canSchedule && (
        <AppointmentModal
          date={selectedDate}
          appointments={selectedDateAppointments}
          maxTrucks={selectedDayCapacity.max}
          isWeekendBlocked={selectedDayCapacity.isWeekendBlocked}
          blackoutDay={blackoutDays.find(b => b.date === selectedDate) ?? null}
          currentProfile={profile}
          trucksForDay={getTrucksForDate(selectedDate)}
          availableTrucks={getAvailableTrucks(selectedDate)}
          onClose={() => setSelectedDate(null)}
          onSuccess={() => { setSelectedDate(null); fetchData() }}
          isDemo={isDemo}
          salesmanIdOverride={isDemo && demoSalesmanId ? demoSalesmanId : undefined}
        />
      )}
    </div>
  )
}
