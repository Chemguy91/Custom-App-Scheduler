'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { format, parseISO } from 'date-fns'

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
  customers: { date: string; customer: string; storage: string | null; rate: string | null; cwt: number | null; salesman: string | null }[]
}

export default function SummaryPanel() {
  const supabase = createClient()
  const now = new Date()
  const [month,     setMonth]     = useState(now.getMonth() + 1)
  const [year,      setYear]      = useState(now.getFullYear())
  const [rows,      setRows]      = useState<SummaryRow[]>([])
  const [totalJobs, setTotalJobs] = useState(0)
  const [loading,   setLoading]   = useState(true)
  const [expanded,  setExpanded]  = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      setLoading(true)
      setExpanded(null)
      const monthStr  = String(month).padStart(2, '0')
      const startDate = `${year}-${monthStr}-01`
      const lastDay   = new Date(year, month, 0).getDate()
      const endDate   = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`

      const { data } = await supabase
        .from('appointments_with_details')
        .select('date, job_type, products, customer_name, storage_name, cwt, salesman_name, status')
        .gte('date', startDate)
        .lte('date', endDate)
        .neq('status', 'rejected')

      if (!data) { setLoading(false); return }

      const map = new Map<string, SummaryRow>()

      for (const appt of data) {
        const cwtVal = appt.cwt ?? 0

        if (appt.job_type === 'stg_disinfect') {
          const key = 'Stg Disinfect'
          if (!map.has(key)) map.set(key, { product: key, count: 0, totalCwt: 0, customers: [] })
          const r = map.get(key)!
          r.count++
          r.totalCwt += cwtVal
          r.customers.push({
            date:     appt.date,
            customer: appt.customer_name,
            storage:  appt.storage_name ?? null,
            rate:     null,
            cwt:      appt.cwt ?? null,
            salesman: appt.salesman_name ?? null,
          })
        } else {
          const products: { product: string; rate?: string }[] = appt.products ?? []
          if (products.length === 0) {
            const key = 'Unknown'
            if (!map.has(key)) map.set(key, { product: key, count: 0, totalCwt: 0, customers: [] })
            const r = map.get(key)!
            r.count++
            r.totalCwt += cwtVal
            r.customers.push({
              date:     appt.date,
              customer: appt.customer_name,
              storage:  appt.storage_name ?? null,
              rate:     null,
              cwt:      appt.cwt ?? null,
              salesman: appt.salesman_name ?? null,
            })
          } else {
            for (const p of products) {
              const key = p.product
              if (!map.has(key)) map.set(key, { product: key, count: 0, totalCwt: 0, customers: [] })
              const r = map.get(key)!
              r.count++
              r.totalCwt += cwtVal
              r.customers.push({
                date:     appt.date,
                customer: appt.customer_name,
                storage:  appt.storage_name ?? null,
                rate:     p.rate ?? null,
                cwt:      appt.cwt ?? null,
                salesman: appt.salesman_name ?? null,
              })
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
  }, [year, month])

  function exportCSV() {
    const headers = ['Product', 'Date', 'Customer', 'Storage', 'Rate', 'CWT', 'Salesman']
    const csvRows = [headers.join(',')]
    for (const row of rows) {
      for (const c of row.customers.sort((a, b) => a.date.localeCompare(b.date))) {
        csvRows.push([
          row.product,
          c.date,
          c.customer,
          c.storage ?? '',
          c.rate ?? '',
          c.cwt ?? '',
          c.salesman ?? '',
        ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))
      }
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `summary-${year}-${String(month).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Monthly Summary</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Applications by product</p>
        </div>
        {!loading && rows.length > 0 && (
          <button
            onClick={exportCSV}
            className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export to Excel
          </button>
        )}
      </div>

      {/* Month / Year picker */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 flex-wrap">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Month:</span>
        <select
          value={month}
          onChange={e => setMonth(Number(e.target.value))}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select
          value={year}
          onChange={e => setYear(Number(e.target.value))}
          className="border border-gray-300 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span className="ml-auto text-sm text-gray-500 dark:text-gray-400">
          {loading ? 'Loading…' : `${totalJobs} total job${totalJobs !== 1 ? 's' : ''}`}
        </span>
      </div>

      {/* Empty state */}
      {!loading && rows.length === 0 && (
        <div className="text-center py-16 text-gray-400 dark:text-gray-600 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700">
          No applications found for {MONTHS[month - 1]} {year}.
        </div>
      )}

      {/* Product rows */}
      {!loading && rows.map(row => {
        const chipClass = chipForProduct(row.product)
        const isOpen    = expanded === row.product
        return (
          <div key={row.product} className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left"
              onClick={() => setExpanded(isOpen ? null : row.product)}
            >
              <div className="flex items-center gap-3">
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${chipClass}`}>
                  {row.product}
                </span>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {row.count} application{row.count !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {row.count} job{row.count !== 1 ? 's' : ''}
                </span>
                {row.totalCwt > 0 && (
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    {row.totalCwt.toLocaleString()} CWT
                  </span>
                )}
                <svg className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
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
                      <th className="text-left px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400">Salesman</th>
                    </tr>
                  </thead>
                  <tbody>
                    {row.customers
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .map((c, i) => (
                        <tr key={i} className="border-b border-gray-50 dark:border-gray-800 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800">
                          <td className="px-5 py-2.5 text-gray-600 dark:text-gray-400 whitespace-nowrap">
                            {format(parseISO(c.date), 'MMM d, yyyy')}
                          </td>
                          <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{c.customer}</td>
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{c.storage ?? '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{c.rate ?? '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{c.cwt != null ? c.cwt.toLocaleString() : '—'}</td>
                          <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400">{c.salesman ?? '—'}</td>
                        </tr>
                      ))}
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
