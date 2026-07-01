import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Navbar from '@/components/Navbar'
import SummaryPanel from '@/components/SummaryPanel'
import { Profile } from '@/lib/types'

export default async function SummaryPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || (profile.role !== 'admin' && profile.role !== 'viewer')) redirect('/calendar')

  return (
    <>
      <Navbar profile={profile as Profile} />
      <SummaryPanel />
    </>
  )
}
