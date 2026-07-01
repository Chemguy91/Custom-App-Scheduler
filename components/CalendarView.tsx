'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  format, isSameMonth, isToday, isBefore, startOfDay,
  parseISO, addMonths, subMonths, getDay,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { Appointment, BlackoutDay, CapacityRule, DailyCapacity, DayOff, Profile, Truck } from '@/lib/types'
import AppointmentModal from './AppointmentModal'
import DayOffModal from './DayOffModal'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

export default function CalendarView({ profile }: { profile: Profile }) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [capacities, setCapacities]     = useState<DailyCapacity[]>([])
  const [capacityRules, setCapacityRules] = useState<CapacityRule[]>([])
  const [trucks, setTrucks]             = useState<Truck[]>([])
  const [daysOff, setDaysOff]           = useState<DayOff[]>([])
  const [blackoutDays, setBlackoutDays] = useState<BlackoutDay[]>([])
  const [defaultMax, setDefaultMax]     = useState(5)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading]           = useState(true)
  const [showMyOnly, setShowMyOnly]         = useState(false)
  const [applicatorViewAll, setApplicatorViewAll] = useState(false)

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

  // The truck assigned to this applicator (used to filter their jobs)
  const myTruck = isApplicator ? trucks.find(t => t.applicator_id === profile.id) ?? null : null

  const fetchData = useCallback(async () => {
    setLoading(true)
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
    const monthEnd   = format(endOfMonth(currentMonth),   'yyyy-MM-dd')

    const queries: Promise<unknown>[] = [
      supabase.from('appointments_with_details').select('*').gte('date', monthStart).lte('date', monthEnd).neq('status', 'rejected'),
      supabase.from('daily_capacity').select('*').gte('date', monthStart).lte('date', monthEnd),
      supabase.from('capacity_rules').select('*'),
      supabase.from('trucks_with_details').select('*'),
      supabase.from('settings').select('value').eq('key', 'default_daily_capacity').single(),
      supabase.from('blackout_days').select('*').gte('date', monthStart).lte('date', monthEnd),
    ]

    if (isApplicator) {
      queries.push(supabase.from('days_off').select('*').eq('applicator_id', profile.id))
    } else {
      queries.push(supabase.from('days_off').select('*').gte('date', monthStart).lte('date', monthEnd).eq('status', 'approved'))
    }

    const [apptRes, capRes, rulesRes, trucksRes, settingsRes, blackoutRes, daysOffRes] =
      await Promise.all(queries) as Awaited<ReturnType<typeof supabase.from>>[]

    if ((apptRes as { data: unknown[] | null }).data)      setAppointments((apptRes as { data: Appointment[] }).data!)
    if ((capRes as { data: unknown[] | null }).data)       setCapacities((capRes as { data: DailyCapacity[] }).data!)
    if ((rulesRes as { data: unknown[] | null }).data)     setCapacityRules((rulesRes as { data: CapacityRule[] }).data!)
    if ((trucksRes as { data: unknown[] | null }).data)    setTrucks((trucksRes as { data: Truck[] }).data!)
    if ((settingsRes as { data: { value: string } | null }).data) setDefaultMax(parseInt((settingsRes as { data: { value: string } }).data!.value) || 5)
    if ((blackoutRes as { data: unknown[] | null }).data)  setBlackoutDays((blackoutRes as { data: BlackoutDay[] }).data!)
    if ((daysOffRes as { data: unknown[] | null }).data)   setDaysOff((daysOffRes as { data: DayOff[] }).data!)

    setLoading(false)
  }, [currentMonth, supabase, isApplicator, profile.id])

  useEffect(() => { fetchData() }, [fetchData])

  const monthStart = startOfMonth(currentMonth)
  const monthEnd   = endOfMonth(currentMonth)
  const gridStart  = startOfWeek(monthStart)
  const gridEnd    = endOfWeek(monthEnd)
  const days       = eachDayOfInterval({ start: gridStart, end: gridEnd })

  function getAppointments(dateStr: string) {
    return appointments.filter(a => a.date === dateStr)
  }

  function getMyDayOff(dateStr: string): DayOff | null {
    return daysOff.find(d => d.date === dateStr && d.applicator_id === profile.id) ?? null
  }

  function getTrucksForDate(dateStr: string): Truck[] {
    return trucks.filter(t =>
      (!t.active_from || t.active_from <= dateStr) &&
      (!t.active_to   || t.active_to   >= dateStr)
    )
  }

  function getAvailableTrucks(dateStr: string): Truck[] {
    const active = getTrucksForDate(dateStr)
    const approvedOff = daysOff.filter(d => d.date === dateStr && d.status === 'approved')
    const assignedTruckIds = getAppointments(dateStr)
      .filter(a => a.status !== 'rejected' && a.truck_id)
      .map(a => a.truck_id!)
    return active.filter(t => {
      if (assignedTruckIds.includes(t.id)) return false
      if (approvedOff.some(d => d.truck_id === t.id)) return false
      if (t.applicator_id && approvedOff.some(d => d.applicator_id === t.applicator_id)) return false
      return true
    })
  }

  // Computes the effective max slots for a date using closure over all state.
  // This replaces the old external resolveCapacity() which had issues receiving
  // daysOff as a parameter. Uses the same day-off filtering logic as getAvailableTrucks.
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

    // 5. Deduct approved days off (same logic as getAvailableTrucks — this is what works)
    const approvedOff = daysOff.filter(d => d.date === dateStr && d.status === 'approved')
    const truckCap = ruleTrucks.filter(t => {
      if (approvedOff.some(d => d.truck_id === t.id)) return false
      if (t.applicator_id && approvedOff.some(d => d.applicator_id === t.applicator_id)) return false
      return true
    }).length

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
    if (isViewer || draggedAppt) return
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
        <div className="mb-4 bg-gray-100 border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-500 text-center">
          You have view-only access to this calendar.
        </div>
      )}
      {isApplicator && (
        <div className="mb-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-2 text-sm text-blue-700 text-center">
          Click any day to request a day off.
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

      {/* Month navigation */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-xl font-bold text-gray-900">{format(currentMonth, 'MMMM yyyy')}</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* View toggle — sales managers */}
          {isSalesManager && (
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-sm">
              <button
                onClick={() => setShowMyOnly(false)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  !showMyOnly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                All jobs
              </button>
              <button
                onClick={() => setShowMyOnly(true)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  showMyOnly ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                My jobs
              </button>
            </div>
          )}

          {/* View toggle — applicators */}
          {isApplicator && (
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5 text-sm">
              <button
                onClick={() => setApplicatorViewAll(false)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  !applicatorViewAll ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                My jobs
              </button>
              <button
                onClick={() => setApplicatorViewAll(true)}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${
                  applicatorViewAll ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                All jobs
              </button>
            </div>
          )}
          <button onClick={() => setCurrentMonth(m => subMonths(m, 1))} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button onClick={() => setCurrentMonth(new Date())} className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600">
            Today
          </button>
          <button onClick={() => setCurrentMonth(m => addMonths(m, 1))} className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAYS.map(d => (
          <div key={d} className="text-center text-xs font-medium text-gray-400 py-2">{d}</div>
        ))}
      </div>

      {/* Calendar grid */}
      {loading ? (
        <div className="h-96 flex items-center justify-center text-gray-400">Loading calendar…</div>
      ) : (
        <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-xl overflow-hidden border border-gray-200">
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
              : (isSalesManager && showMyOnly)
                ? dayAppts.filter(a => a.salesman_id === profile.id)
                : dayAppts
            const myDayOff  = getMyDayOff(dateStr)
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
                <span className={`text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full ${
                  today ? 'bg-blue-600 text-white' : isPast ? 'cal-past-num' : 'text-gray-900'
                }`}>
                  {format(day, 'd')}
                </span>

                {/* Blackout / holiday label */}
                {blackout && inMonth && !isApplicator && (
                  <div className="mt-1">
                    <span className="text-xs px-1.5 py-0.5 rounded-full font-medium bg-red-100 text-red-700 block truncate">
                      {blackout.reason ? blackout.reason : 'Blocked'}
                    </span>
                  </div>
                )}

                {/* Applicator: day off status */}
                {isApplicator && myDayOff && inMonth && (
                  <div className="mt-1">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      myDayOff.status === 'approved' ? 'bg-green-100 text-green-700' :
                      myDayOff.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      {myDayOff.status === 'approved' ? 'Off ✓' :
                       myDayOff.status === 'rejected' ? 'Denied' : 'Off?'}
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
                          onClick={e => e.stopPropagation()}
                          className={`text-xs truncate rounded px-1 py-0.5 select-none ${chipClass}
                            ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}
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
      )}

      {/* Legend */}
      <div className="mt-5 space-y-3">
        {/* Capacity legend */}
        {!isApplicator && (
          <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-100 border border-blue-300 inline-block" />Available</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-100 border border-red-300 inline-block" />Full</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-gray-100 border border-gray-300 inline-block" />Approval required</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded inline-block cal-blackout border border-red-300" />Blocked / Holiday</span>
          </div>
        )}
        {isApplicator && (
          <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-yellow-100 border border-yellow-300 inline-block" />Pending</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-100 border border-green-300 inline-block" />Approved off</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-100 border border-red-300 inline-block" />Denied</span>
          </div>
        )}

        {/* Product color guide — show for everyone except viewers */}
        {!isViewer && (
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1.5">Product colors</p>
            <div className="flex flex-wrap gap-2">
              {([
                { label: 'Smart Block',   cls: 'chip-purple'   },
                { label: '1,4 Zap',       cls: 'chip-yellow'   },
                { label: 'DMN',           cls: 'chip-brown'    },
                { label: 'Storox / Perox AG', cls: 'chip-green' },
                { label: 'Purogene Pro',  cls: 'chip-blue'     },
                { label: 'CIPC',          cls: 'chip-orange'   },
                { label: 'Amplify',       cls: 'chip-white'    },
                { label: 'Fresh Pack 100',cls: 'chip-pink'     },
                { label: 'Stg Disinfect', cls: 'chip-disinfect'},
              ] as const).map(({ label, cls }) => (
                <span key={label} className={`text-xs px-2 py-0.5 rounded font-medium ${cls}`}>
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {selectedDate && isApplicator && (
        <DayOffModal
          date={selectedDate}
          profile={profile}
          existingRequest={getMyDayOff(selectedDate)}
          trucks={trucks}
          onClose={() => setSelectedDate(null)}
          onSuccess={() => { setSelectedDate(null); fetchData() }}
        />
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
        />
      )}
    </div>
  )
}
