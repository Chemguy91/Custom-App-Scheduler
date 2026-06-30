import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Navbar from '@/components/Navbar'
import AdminPanel from '@/components/AdminPanel'
import { Profile } from '@/lib/types'

export default async function AdminPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile || profile.role !== 'admin') redirect('/calendar')

  return (
    <>
      <Navbar profile={profile as Profile} />
      <AdminPanel profile={profile as Profile} />
    </>
  )
}
