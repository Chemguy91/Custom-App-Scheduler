'use client'

import { useEffect, useRef, useState } from 'react'
import { DayPicker, DateRange } from 'react-day-picker'
import 'react-day-picker/dist/style.css'
import { format, parseISO } from 'date-fns'

interface Props {
  startDate: string   // 'YYYY-MM-DD'
  endDate: string      // 'YYYY-MM-DD'
  onChange: (start: string, end: string) => void
  disabled?: boolean
}

function toISO(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/**
 * Click-to-pick date range field. Shows the current range as a button;
 * clicking it opens a real calendar popover (react-day-picker) instead of
 * relying on the native <input type="date"> picker, which some browsers/OS
 * combos render without a usable click target.
 */
export default function DateRangePicker({ startDate, endDate, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const selected: DateRange | undefined = startDate
    ? { from: parseISO(startDate), to: endDate ? parseISO(endDate) : parseISO(startDate) }
    : undefined

  function handleSelect(range: DateRange | undefined) {
    if (!range?.from) return
    if (range.to) {
      onChange(toISO(range.from), toISO(range.to))
      setOpen(false)
    } else {
      // First click of a new selection — treat it as a single-day range
      // until (and unless) a second click extends it.
      onChange(toISO(range.from), toISO(range.from))
    }
  }

  const label = startDate
    ? startDate === endDate
      ? format(parseISO(startDate), 'MMM d, yyyy')
      : `${format(parseISO(startDate), 'MMM d')} – ${format(parseISO(endDate || startDate), 'MMM d, yyyy')}`
    : 'Select dates'

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
      >
        <span className={startDate ? '' : 'text-gray-400'}>{label}</span>
        <svg className="w-4 h-4 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl p-2 pto-range-picker">
          <DayPicker
            mode="range"
            selected={selected}
            onSelect={handleSelect}
            defaultMonth={selected?.from}
            numberOfMonths={1}
            weekStartsOn={0}
            style={{
              '--rdp-accent-color': '#dc2626',
              '--rdp-background-color': '#f3f4f6',
              '--rdp-accent-color-dark': '#ef4444',
              '--rdp-background-color-dark': '#1a1a1a',
            } as React.CSSProperties}
          />
          <div className="flex items-center justify-between gap-2 px-2 pb-1">
            <button
              type="button"
              onClick={() => { onChange('', ''); }}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 font-medium"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-xs bg-red-600 hover:bg-red-700 text-white font-medium px-3 py-1 rounded-md"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
