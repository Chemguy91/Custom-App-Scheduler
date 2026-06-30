'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  startOfMonth, endOfMonth, eachDayOfInterval, startOfWeek, endOfWeek,
  format, isSameMonth, isToday, parseISO, addMonths, subMonths, getDay,
} from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { Appointment, CapacityRule, DailyCapacity, Profile } from '@/lib/types'
import AppointmentModal from './AppointmentModal'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface DayCapacityResult {
  max: number
  isWeekendBlocked: boolean
}

function resolveCapacity(
  date: Date,
  dateStr: string,
  dailyCapacities: DailyCapacity[],
  capacityRules: CapacityRule[],
  defaultMax: number,
): DayCapacityResult {
  const dayOfWeek = getDay(date) // 0=Sun ... 6=Sat
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6

  // 1. Exact date override (highest priority)
  const override = dailyCapacities.find(c => c.date === dateStr)
  if (override) return { max: override.max_trucks, isWeekendBlocked: false }

  // 2. Capacity rules — find matching ones (date in range AND day_of_week matches)
  const matching = capacityRules
    .filter(r =>
      r.start_date <= dateStr &&
      r.end_date >= dateStr &&
      r.days_of_week.includes(dayOfWeek)
    )
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  if (matching.length > 0) {
    return { max: matching[0].max_applications, isWeekendBlocked: false }
  }

  // 3. Weekend not covered by any rule → requires admin approval (max=0)
  if (isWeekend) {
    return { max: 0, isWeekendBlocked: true }
  }

  // 4. Default
  return { max: defaultMax, isWeekendBlocked: false }
}

export default function CalendarView({ profile }: { profile: Profile }) {
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [capacities, setCapacities] = useState<DailyCapacity[]>([])
  const [capacityRules, setCapacityRules] = useState<CapacityRule[]>([])
  const [defaultMax, setDefaultMax] = useState(5)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const monthStart = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
    const monthEnd = format(endOfMonth(currentMonth), 'yyyy-MM-dd')

    const [apptRes, capRes, rulesRes, settingsRes] = await Promise.all([
      supabase
        .from('appointments_with_details')
        .select('*')
        .gte('date', monthStart)
        .lte('date', monthEnd)
        .neq('status', 'rejected'),
      supabase
        .from('daily_capacity')
        .select('*')
        .gte('date', monthStart)
        .lte('date', monthEnd),
      supabase
        .from('capacity_rules')
        .select('*'),
      supabase
        .from('settings')
        .select('value')
        .eq('key', 'default_daily_capacity')
        .single(),
    ])

    if (apptRes.data) setAppointments(apptRes.data as Appointment[])
    if (capRes.data) setCapacities(capRes.data as DailyCapacity[])
    if (rulesRes.data) setCapacityRules(rulesRes.data as CapacityRule[])
    if (settingsRes.data) setDefaultMax(parseInt(settingsRes.data.value) || 5)
    setLoading(false)
  }, [currentMonth, supabase])

  useEffect(() => { fetchData() }, [fetchData])

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const gridStart = startOfWeek(monthStart)
  const gridEnd = endOfWeek(monthEnd)
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd })

  function getAppointments(dateStr: string) {
    return appointments.filter(a => a.date === dateStr)
  }

  const selectedDateAppointments = selectedDate ? getAppointments(selectedDate) : []
  const selectedDayCapacity = selectedDate
    ? resolveCapacity(parseISO(selectedDate), selectedDate, capacities, capacityRules, defaultMax)
    : { max: defaultMax, isWeekendBlocked: false }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Month navigation */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-900">
          {format(currentMonth, 'MMMM yyyy')}
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentMonth(m => subMonths(m, 1))}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => setCurrentMonth(new Date())}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors text-gray-600"
          >
            Today
          </button>
          <button
            onClick={() => setCurrentMonth(m => addMonths(m, 1))}
            className="p-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
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
            const dateStr = format(day, 'yyyy-MM-dd')
            const inMonth = isSameMonth(day, currentMonth)
            const today = isToday(day)
            const dayAppts = getAppointments(dateStr)
            const { max, isWeekendBlocked } = resolveCapacity(day, dateStr, capacities, capacityRules, defaultMax)
            const count = dayAppts.length
            const full = count >= max
            const blocked = isWeekendBlocked && count === 0

            return (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                className={`
                  bg-white min-h-[80px] p-2 text-left hover:bg-blue-50 transition-colors
                  ${!inMonth ? 'opacity-40' : ''}
                  ${today ? 'ring-2 ring-inset ring-blue-500' : ''}
                  ${blocked ? 'bg-gray-50' : ''}
                `}
              >
                <span className={`
                  text-sm font-medium w-7 h-7 flex items-center justify-center rounded-full
                  ${today ? 'bg-blue-600 text-white' : 'text-gray-900'}
                `}>
                  {format(day, 'd')}
                </span>

                {/* Weekend blocked indicator */}
                {blocked && inMonth && (
                  <div className="mt-1">
                    <span className="text-xs text-gray-400 italic">Approval req.</span>
                  </div>
                )}

                {/* Capacity pill */}
                {!blocked && max > 0 && inMonth && (
                  <div className="mt-1">
                    <span className={`
                      text-xs px-1.5 py-0.5 rounded-full font-medium
                      ${full ? 'bg-red-100 text-red-700' : count > 0 ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}
                    `}>
                      {count}/{max}
                    </span>
                  </div>
                )}

                {/* Appointment names */}
                <div className="mt-1 space-y-0.5">
                  {dayAppts.slice(0, 2).map(a => (
                    <div key={a.id} className="text-xs truncate text-gray-600 bg-gray-100 rounded px-1 py-0.5">
                      {a.customer_name}
                    </div>
                  ))}
                  {dayAppts.length > 2 && (
                    <div className="text-xs text-gray-400">+{dayAppts.length - 2} more</div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 mt-4 text-xs text-gray-500 flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-blue-100 border border-blue-300 inline-block" />
          Available
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-red-100 border border-red-300 inline-block" />
          Full
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-full bg-gray-100 border border-gray-300 inline-block" />
          Approval required
        </span>
      </div>

      {/* Modal */}
      {selectedDate && (
        <AppointmentModal
          date={selectedDate}
          appointments={selectedDateAppointments}
          maxTrucks={selectedDayCapacity.max}
          isWeekendBlocked={selectedDayCapacity.isWeekendBlocked}
          currentProfile={profile}
          onClose={() => setSelectedDate(null)}
          onSuccess={() => {
            setSelectedDate(null)
            fetchData()
          }}
        />
      )}
    </div>
  )
}
