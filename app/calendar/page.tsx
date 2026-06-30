import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Navbar from '@/components/Navbar'
import CalendarView from '@/components/CalendarView'
import { Profile } from '@/lib/types'

export default async function CalendarPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single()

  if (!profile) redirect('/login')

  return (
    <>
      <Navbar profile={profile as Profile} />
      <CalendarView profile={profile as Profile} />
    </>
  )
}
