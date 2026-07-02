'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/calendar')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl shadow-lg p-8 w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Image
            src="/logo.png"
            alt="Agri-Stor Company"
            width={180}
            height={112}
            className="object-contain mb-4"
            priority
          />
          <h1 className="text-xl font-bold text-gray-900">Application Scheduler</h1>
          <p className="text-sm text-gray-500 mt-1">Sign in to your account</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2 px-4 rounded-lg text-sm transition-colors"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-6">
          Contact your admin if you need an account.
        </p>

        {/* Demo account */}
        <div className="mt-4 border border-amber-200 bg-amber-50 rounded-xl p-4">
          <p className="text-xs font-semibold text-amber-700 text-center mb-3">🎯 Try the Demo</p>
          <button
            onClick={async () => {
              setError('')
              setLoading(true)
              const { error } = await supabase.auth.signInWithPassword({ email: 'demo@demo.com', password: 'demo123' })
              if (error) { setError(error.message); setLoading(false) }
              else { router.push('/calendar'); router.refresh() }
            }}
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-600 disabled:bg-amber-300 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
          >
            {loading ? 'Signing in…' : 'Enter demo mode'}
          </button>
        </div>
      </div>
    </div>
  )
}
