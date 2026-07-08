'use client'

import { useState, useEffect, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, parseISO } from 'date-fns'
import { useIsDemo } from './DemoWrapper'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const YEARS  = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i)

const PRODUCT_CHIP: Record<string, string> = {
  'Stg Disinfect':     'chip-disinfect',
  'Smart Block':       'chip-purple',
  '1,4 Zap':           'chip-yellow',
  'DMN':               'chip-brown',
  'Storox / Perox AG': 'chip-green',
  'Purogene Pro':      'chip-blue',
  'CIPC':              'chip-orange',
  'Amplify':           'chip-white',
  'Fresh Pack 100':    'chip-pink',
}

function chipForProduct(name: string): string {
  for (const [key, cls] of Object.entries(PRODUCT_CHIP)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return cls
  }
  return 'chip-default'
}

interface SummaryRow {
  product:  string
  count:    number
  totalCwt: number
  customers: { date: string; customer: string; storage: string | null; rate: string | null; cwt: number | null; salesman: string | null; notes: string | null }[]
}

const selectCls = 'border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500'

export default function SummaryPanel() {
  const supabase = createClient()
  const isDemo   = useIsDemo()
  const now = new Date()

  // ── Date range ──────────────────────────────────────────────────────────────
  const [startMonth, setStartMonth] = useState(now.getMonth() + 1)
  const [startYear,  setStartYear]  = useState(now.getFullYear())
  const [endMonth,   setEndMonth]   = useState(now.getMonth() + 1)
  const [endYear,    setEndYear]    = useState(now.getFullYear())

  // ── Data ────────────────────────────────────────────────────────────────────
  const [rows,      setRows]      = useState<SummaryRow[]>([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [expanded,  setExpanded]  = useState<string | null>(null)

  // ── Search ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')

  // Normalise start <= end
  const startDate = `${startYear}-${String(startMonth).padStart(2, '0')}-01`
  const endDate   = (() => {
    const lastDay = new Date(endYear, endMonth, 0).getDate()
    return `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
  })()
  const rangeValid = startDate <= endDate

  useEffect(() => {
    if (!rangeValid) return
    async function load() {
      setLoading(true)
      setExpanded(null)

      const { data } = await supabase
        .from('appointments_with_details')
        .select('date, job_type, products, customer_name, storage_name, cwt, storage_capacity, salesman_name, status, notes')
        .gte('date', startDate)
        .lte('date', endDate)
        .neq('status', 'rejected')
        .eq('is_demo', isDemo)

      if (!data) { setLoading(false); return }

      const map = new Map<string, SummaryRow>()

      for (const appt of data) {
        const effectiveCwt = appt.cwt ?? (appt.job_type === 'stg_disinfect' ? (appt.storage_capacity ?? null) : null)
        const cwtVal = effectiveCwt ?? 0

        if (appt.job_type === 'stg_disinfect') {
          const key = 'Stg Disinfect'
          if (!map.has(key)) map.set(key, { product: key, count: 0, totalCwt: 0, customers: [] })
          const r = map.get(key)!
          r.count++
          r.totalCwt += cwtVal
          r.customers.push({ date: appt.date, customer: appt.customer_name, storage: appt.storage_name ?? null, rate: null, cwt: effectiveCwt, salesman: appt.salesman_name ?? null, notes: appt.notes ?? null })
        } else {
          const products: { product: string; rate?: string }[] = appt.products ?? []
          if (products.length === 0) {
            const key = 'Unknown'
            if (!map.has(key)) map.set(key, { product: key, count: 0, totalCwt: 0, customers: [] })
            const r = map.get(key)!
            r.count++
            r.totalCwt += cwtVal
            r.customers.push({ date: appt.date, customer: appt.customer_name, storage: appt.storage_name ?? null, rate: null, cwt: appt.cwt ?? null, salesman: appt.salesman_name ?? null, notes: appt.notes ?? null })
          } else {
            for (const p of products) {
              const key = p.product
              if (!map.has(key)) map.set(key, { product: key, count: 0, totalCwt: 0, customers: [] })
              const r = map.get(key)!
              r.count++
              r.totalCwt += cwtVal
              r.customers.push({ date: appt.date, customer: appt.customer_name, storage: appt.storage_name ?? null, rate: p.rate ?? null, cwt: appt.cwt ?? null, salesman: appt.salesman_name ?? null, notes: appt.notes ?? null })
            }
          }
        }
      }

      const sorted = Array.from(map.values()).sort((a, b) => b.count - a.count)
      setRows(sorted)
      setTotalJobs(data.length)
      setLoading(false)
    }
    load()
  }, [startYear, startMonth, endYear, endMonth, isDemo])

  // ── Filtered rows (search is pure in-memory) ─────────────────────────────
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows
      .map(row => ({
        ...row,
        customers: row.customers.filter(c =>
          c.customer.toLowerCase().includes(q) ||
          (c.storage ?? '').toLowerCase().includes(q) ||
          (c.notes ?? '').toLowerCase().includes(q)
        ),
      }))
      .filter(row => row.customers.length > 0)
  }, [rows, search])

  const isSearching = search.trim().length > 0

  // ── Excel export ─────────────────────────────────────────────────────────────
  async function exportXLSX() {
    const XLSX = (await import('xlsx-js-style')).default

    const HEADERS = ['Product', 'Date', 'Customer', 'Storage', 'Rate', 'CWT', 'Account Manager', 'Notes']
    const COL_WIDTHS = [16, 13, 24, 22, 13, 11, 20, 40]

    const exportRows = isSearching ? filteredRows : rows

    // Build flat data array
    const dataRows: (string | number)[][] = []
    for (const row of exportRows) {
      for (const c of row.customers.slice().sort((a, b) => a.date.localeCompare(b.date))) {
        dataRows.push([
          row.product,
          c.date ? format(parseISO(c.date), 'M/d/yyyy') : '',
          c.customer,
          c.storage ?? '',
          c.rate ?? '',
          c.cwt ?? '',
          c.salesman ?? '',
          c.notes ?? '',
        ])
      }
    }

    // Styles
    const headerStyle = {
      font:      { bold: true, color: { rgb: 'FFFFFF' }, sz: 11 },
      fill:      { fgColor: { rgb: '1E3A5F' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: false },
      border: {
        top:    { style: 'thin', color: { rgb: '93C5FD' } },
        bottom: { style: 'thin', color: { rgb: '93C5FD' } },
        left:   { style: 'thin', color: { rgb: '93C5FD' } },
        right:  { style: 'thin', color: { rgb: '93C5FD' } },
      },
    }
    const cellBorder = {
      top:    { style: 'thin', color: { rgb: 'D1D5DB' } },
      bottom: { style: 'thin', color: { rgb: 'D1D5DB' } },
      left:   { style: 'thin', color: { rgb: 'D1D5DB' } },
      right:  { style: 'thin', color: { rgb: 'D1D5DB' } },
    }
    const evenFill = { fgColor: { rgb: 'F0F4FF' } }

    const ws = XLSX.utils.aoa_to_sheet([HEADERS, ...dataRows])

    // Style header row
    HEADERS.forEach((_, ci) => {
      const ref = XLSX.utils.encode_cell({ r: 0, c: ci })
      if (ws[ref]) ws[ref].s = headerStyle
    })

    // Style data rows
    dataRows.forEach((row, ri) => {
      const isEven = ri % 2 === 1
      row.forEach((_, ci) => {
        const ref = XLSX.utils.encode_cell({ r: ri + 1, c: ci })
        if (!ws[ref]) ws[ref] = { v: '' }
        ws[ref].s = {
          border: cellBorder,
          fill:   isEven ? evenFill : undefined,
          font:   { sz: 10 },
          alignment: ci === 5
            ? { horizontal: 'right' }   // CWT right-aligned
            : { horizontal: 'left', wrapText: ci === 7 }, // Notes wraps
        }
        // CWT as actual number
        if (ci === 5 && typeof row[ci] === 'number') {
          ws[ref].t = 'n'
          ws[ref].z = '#,##0'
        }
      })
    })

    // Column widths + row height for header
    ws['!cols'] = COL_WIDTHS.map(wch => ({ wch }))
    ws['!rows'] = [{ hpt: 22 }] // header row taller

    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Summary')
    XLSX.writeFile(wb, `summary-${startYear}-${String(startMonth).padStart(2, '0')}_to_${endYear}-${String(endMonth).padStart(2, '0')}.xlsx`)
  }

  // ── Range label ─────────────────────────────────────────────────────────────
  const rangeLabel = startMonth === endMonth && startYear === endYear
    ? `${MONTHS[startMonth - 1]} ${startYear}`
    : `${MONTHS[startMonth - 1]} ${startYear} – ${MONTHS[endMonth - 1]} ${endYear}`

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Summary</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{rangeLabel} · Applications by product</p>
        </div>
        {!loading && rows.length > 0 && (
          <button
            onClick={exportXLSX}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export to Excel
          </button>
        )}
      </div>

      {/* Date range picker */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* From */}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-10">From:</span>
          <select value={startMonth} onChange={e => setStartMonth(Number(e.target.value))} className={selectCls}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={startYear} onChange={e => setStartYear(Number(e.target.value))} className={selectCls}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <span className="text-gray-400 dark:text-gray-600">→</span>

          {/* To */}
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300 w-4">To:</span>
          <select value={endMonth} onChange={e => setEndMonth(Number(e.target.value))} className={selectCls}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select value={endYear} onChange={e => setEndYear(Number(e.target.value))} className={selectCls}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <span className="ml-auto text-sm text-gray-500 dark:text-gray-400 shrink-0">
            {loading ? 'Loading…' : `${totalJobs} total job${totalJobs !== 1 ? 's' : ''}`}
          </span>
        </div>

        {!rangeValid && (
          <p className="text-xs text-red-500">Start date must be before or equal to end date.</p>
        )}

        {/* Search */}
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by customer or storage name…"
            className="w-full pl-9 pr-9 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Search result count */}
      {isSearching && !loading && (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {filteredRows.reduce((n, r) => n + r.customers.length, 0)} result{filteredRows.reduce((n, r) => n + r.customers.length, 0) !== 1 ? 's' : ''} for <strong className="text-gray-700 dark:text-gray-300">"{search}"</strong>
        </p>
      )}

      {/* Empty state */}
      {!loading && filteredRows.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-600 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          {isSearching
            ? `No results for "${search}".`
            : `No applications found for ${rangeLabel}.`}
        </div>
      )}

      {/* Product rows */}
      {!loading && filteredRows.map(row => {
        const chipClass = chipForProduct(row.product)
        // Auto-expand all rows when searching; otherwise honour manual toggle
        const isOpen = isSearching || expanded === row.product
        const displayCustomers = isSearching
          ? row.customers
          : rows.find(r => r.product === row.product)?.customers ?? row.customers

        return (
          <div key={row.product} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              onClick={() => !isSearching && setExpanded(isOpen ? null : row.product)}
            >
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${chipClass}`}>
                  {row.product}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {isSearching
                    ? `${row.customers.length} match${row.customers.length !== 1 ? 'es' : ''}`
                    : `${row.count} application${row.count !== 1 ? 's' : ''}`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {row.totalCwt > 0 && !isSearching && (
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    {row.totalCwt.toLocaleString()} CWT
                  </span>
                )}
                {!isSearching && (
                  <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                )}
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-gray-100 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                      <th className="text-left px-5 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Date</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Customer</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Storage</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Rate</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">CWT</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Account Manager</th>
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayCustomers
                      .slice()
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((c, i) => {
                        const q = search.trim().toLowerCase()
                        const highlightCustomer = q && c.customer.toLowerCase().includes(q)
                        const highlightStorage  = q && (c.storage ?? '').toLowerCase().includes(q)
                        const highlightNotes    = q && (c.notes ?? '').toLowerCase().includes(q)
                        return (
                          <tr key={i} className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
                            <td className="px-5 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                              {c.date ? format(parseISO(c.date), 'MMM d, yyyy') : '—'}
                            </td>
                            <td className={`px-4 py-2.5 font-medium ${highlightCustomer ? 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-900 dark:text-white'}`}>
                              {c.customer}
                            </td>
                            <td className={`px-4 py-2.5 ${highlightStorage ? 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-500 dark:text-gray-400'}`}>
                              {c.storage ?? '—'}
                            </td>
                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{c.rate ?? '—'}</td>
                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{c.cwt != null ? c.cwt.toLocaleString() : '—'}</td>
                            <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{c.salesman ?? '—'}</td>
                            <td className={`px-4 py-2.5 text-xs max-w-[180px] ${highlightNotes ? 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20' : 'text-gray-400 dark:text-gray-500'}`}>
                              {c.notes ?? '—'}
                            </td>
                          </tr>
                        )
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
