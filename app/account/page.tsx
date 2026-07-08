import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Profile } from '@/lib/types'
import DemoWrapper from '@/components/DemoWrapper'
import ChangePasswordForm from '@/components/ChangePasswordForm'

export default async function AccountPage() {
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
    <DemoWrapper profile={profile as Profile} userEmail={user.email}>
      <div className="max-w-md mx-auto mt-12 px-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6">Account Settings</h1>
        <ChangePasswordForm />
      </div>
    </DemoWrapper>
  )
}
