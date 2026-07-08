'use client'

import { createClient } from '@/lib/supabase/client'
import { Profile } from '@/lib/types'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useTheme } from './ThemeProvider'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  sales_manager: 'Account Manager',
  applicator: 'Applicator',
  viewer: 'Viewer',
}

function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="5" strokeWidth={2} />
      <path strokeLinecap="round" strokeWidth={2}
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  )
}

export default function Navbar({ profile }: { profile: Profile }) {
  const router = useRouter()
  const supabase = createClient()
  const { theme, toggle } = useTheme()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 py-3 transition-colors">
      <div className="max-w-6xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link href="/calendar" className="flex items-center">
            <Image
              src="/logo.png"
              alt="Agri-Stor Company"
              width={120}
              height={75}
              className="object-contain"
              priority
            />
          </Link>

          <Link href="/calendar" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
            Calendar
          </Link>

          {profile.role === 'admin' && (
            <Link href="/admin" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
              Admin
            </Link>
          )}
          {(profile.role === 'admin' || profile.role === 'viewer' || profile.role === 'sales_manager') && (
            <Link href="/summary" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
              Summary
            </Link>
          )}
          <Link href="/account" className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors">
            Change Password
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {/* Day / Night toggle */}
          <button
            onClick={toggle}
            title={theme === 'dark' ? 'Switch to day mode' : 'Switch to night mode'}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
          </button>

          <div className="text-right">
            <p className="text-sm font-medium text-gray-900 dark:text-white">{profile.full_name}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{ROLE_LABELS[profile.role] ?? profile.role}</p>
          </div>
          <button
            onClick={signOut}
            className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 transition-colors"
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  )
}
