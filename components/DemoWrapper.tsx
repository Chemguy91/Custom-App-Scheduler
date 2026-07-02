'use client'

import { createContext, useContext, useState, useEffect } from 'react'
import { Profile, Role } from '@/lib/types'
import { DEMO_EMAIL } from '@/lib/demo'
import { createClient } from '@/lib/supabase/client'
import Navbar from './Navbar'

// ─── Context ──────────────────────────────────────────────────────────────────

type DemoCtx = {
  effectiveProfile: Profile | null
  isDemo: boolean
  demoSalesmanId: string | null
  demoApplicatorId: string | null
  setDemoSalesmanId: (id: string) => void
  setDemoApplicatorId: (id: string) => void
}
const DemoContext = createContext<DemoCtx>({
  effectiveProfile: null,
  isDemo: false,
  demoSalesmanId: null,
  demoApplicatorId: null,
  setDemoSalesmanId: () => {},
  setDemoApplicatorId: () => {},
})

/** Returns the demo-overridden profile, or the real profile if not in demo mode. */
export function useDemoProfile(fallback: Profile): Profile {
  const { effectiveProfile } = useContext(DemoContext)
  return effectiveProfile ?? fallback
}

/** Returns true when the current session is the demo account. */
export function useIsDemo(): boolean {
  return useContext(DemoContext).isDemo
}

/** Returns the selected demo persona IDs and their setters. */
export function useDemoPersonas() {
  const { demoSalesmanId, demoApplicatorId, setDemoSalesmanId, setDemoApplicatorId } = useContext(DemoContext)
  return { demoSalesmanId, demoApplicatorId, setDemoSalesmanId, setDemoApplicatorId }
}

// ─── Role switcher bar ────────────────────────────────────────────────────────

const ROLE_OPTIONS: { role: Role; label: string; description: string }[] = [
  { role: 'admin',         label: 'Admin',        description: 'Full access — manage jobs, users & capacity' },
  { role: 'sales_manager', label: 'Account Manager', description: 'Schedule jobs and view the calendar' },
  { role: 'applicator',    label: 'Applicator',    description: 'View assigned jobs, click chips for details' },
  { role: 'viewer',        label: 'Viewer',        description: 'Read-only calendar + monthly summary' },
]

// ─── Wrapper ──────────────────────────────────────────────────────────────────

export default function DemoWrapper({
  profile,
  userEmail,
  children,
}: {
  profile: Profile
  userEmail: string | undefined
  children: React.ReactNode
}) {
  const isDemo = userEmail === DEMO_EMAIL
  const supabase = createClient()

  const [roleIndex, setRoleIndex] = useState(0)
  const [salesManagers, setSalesManagers] = useState<{ id: string; name: string }[]>([])
  const [applicators,   setApplicators]   = useState<{ id: string; name: string }[]>([])

  const [demoSalesmanId,   setDemoSalesmanIdState]   = useState<string | null>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('demo_salesman_id') ?? null : null
  )
  const [demoApplicatorId, setDemoApplicatorIdState] = useState<string | null>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('demo_applicator_id') ?? null : null
  )

  function setSalesman(id: string) {
    setDemoSalesmanIdState(id)
    localStorage.setItem('demo_salesman_id', id)
  }
  function setApplicator(id: string) {
    setDemoApplicatorIdState(id)
    localStorage.setItem('demo_applicator_id', id)
  }

  // Fetch profiles once when in demo mode
  useEffect(() => {
    if (!isDemo) return
    fetch('/api/demo-seed', { method: 'POST' }).catch(() => {})
    supabase.from('profiles').select('id, full_name, role').order('full_name').then(({ data }) => {
      if (!data) return
      setSalesManagers(data.filter(p => p.role === 'sales_manager').map(p => ({ id: p.id, name: p.full_name })))
      setApplicators(data.filter(p => p.role === 'applicator').map(p => ({ id: p.id, name: p.full_name })))
    })
  }, [isDemo])

  const demoRole = ROLE_OPTIONS[roleIndex].role
  const effectiveProfile: Profile = isDemo ? { ...profile, role: demoRole } : profile

  const prev = () => setRoleIndex(i => (i - 1 + ROLE_OPTIONS.length) % ROLE_OPTIONS.length)
  const next = () => setRoleIndex(i => (i + 1) % ROLE_OPTIONS.length)

  const selectCls = 'bg-amber-100 dark:bg-amber-900 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 text-xs rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-amber-500'

  return (
    <DemoContext.Provider value={{ effectiveProfile: isDemo ? effectiveProfile : null, isDemo, demoSalesmanId, demoApplicatorId, setDemoSalesmanId: setSalesman, setDemoApplicatorId: setApplicator }}>
      <Navbar profile={effectiveProfile} />
      {isDemo && (
        <div className="bg-amber-50 dark:bg-amber-950 border-b border-amber-200 dark:border-amber-800 px-4 py-2">
          <div className="max-w-6xl mx-auto flex items-center gap-3 flex-wrap">
            <span className="text-xs font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
              🎯 Demo Mode
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-500">View as:</span>

            {/* Role buttons */}
            <div className="flex gap-1 flex-wrap">
              {ROLE_OPTIONS.map((opt, i) => (
                <button
                  key={opt.role}
                  onClick={() => setRoleIndex(i)}
                  title={opt.description}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    roleIndex === i
                      ? 'bg-amber-500 text-white shadow-sm'
                      : 'bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {/* Cycle arrows */}
            <div className="flex items-center gap-1">
              <button onClick={prev} className="p-1 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors" title="Previous role">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
              </button>
              <button onClick={next} className="p-1 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800 transition-colors" title="Next role">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>

            {/* Persona dropdown — Account Manager */}
            {demoRole === 'sales_manager' && salesManagers.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-amber-600 dark:text-amber-500">User:</span>
                <select value={demoSalesmanId ?? ''} onChange={e => setSalesman(e.target.value)} className={selectCls}>
                  <option value="">— pick user —</option>
                  {salesManagers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}

            {/* Persona dropdown — Applicator */}
            {demoRole === 'applicator' && applicators.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-amber-600 dark:text-amber-500">User:</span>
                <select value={demoApplicatorId ?? ''} onChange={e => setApplicator(e.target.value)} className={selectCls}>
                  <option value="">— pick user —</option>
                  {applicators.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
            )}

            <span className="text-xs text-amber-500 dark:text-amber-600 ml-auto hidden sm:block italic">
              {ROLE_OPTIONS[roleIndex].description}
            </span>
          </div>
        </div>
      )}
      {children}
    </DemoContext.Provider>
  )
}
