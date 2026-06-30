'use client'

import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/lib/types'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

export default function Navbar({ profile }: { profile: Profile }) {
  const router = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/calendar" className="flex items-center gap-2 font-semibold text-gray-900">
            <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            Application Scheduler
          </Link>

          <Link href="/calendar" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
            Calendar
          </Link>

          {profile.role === 'admin' && (
            <Link href="/admin" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">
              Admin
            </Link>
          )}
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium text-gray-900">{profile.full_name}</p>
            <p className="text-xs text-gray-500 capitalize">{profile.role}</p>
          </div>
          <button
            onClick={signOut}
            className="text-sm text-gray-500 hover:text-gray-900 border border-gray-200 rounded-lg px-3 py-1.5 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  )
}
