import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import AdminPanel from '@/components/AdminPanel'
import DemoWrapper from '@/components/DemoWrapper'
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

  if (!profile || (profile.role !== 'admin' && profile.role !== 'viewer')) redirect('/calendar')

  return (
    <DemoWrapper profile={profile as Profile} userEmail={user.email}>
      <AdminPanel profile={profile as Profile} />
    </DemoWrapper>
  )
}
