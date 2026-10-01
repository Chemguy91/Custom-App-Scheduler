import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Fires a one-line email to the owner whenever a sales manager schedules (or
// requests approval for) a job. Admin-created jobs never trigger this — no
// point notifying the admin about their own action.
export async function POST(req: NextRequest) {
  const cookieStore = cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  // Only sales-manager-initiated jobs trigger a notification.
  if (callerProfile?.role !== 'sales_manager') {
    return NextResponse.json({ ok: true, skipped: true })
  }

  const { customerName, date, jobType, pending } = await req.json()
  if (!customerName || !date) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const apiKey = process.env.RESEND_API_KEY
  const from   = process.env.JOB_NOTIFY_FROM_EMAIL
  const to     = process.env.JOB_NOTIFY_TO_EMAIL
  if (!apiKey || !from || !to) {
    // Notifications aren't configured — don't let that break scheduling.
    return NextResponse.json({ ok: true, skipped: true })
  }

  const salesmanName = callerProfile?.full_name ?? 'A salesman'
  const action = pending ? 'requested approval for' : 'scheduled'
  const subject = `${salesmanName} ${action} a job — ${customerName}`
  const displayDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const text = [
    `${salesmanName} ${action} a job in the scheduler.`,
    '',
    `Customer: ${customerName}`,
    `Date: ${displayDate}`,
    `Job type: ${jobType ?? 'Application'}`,
    pending ? 'Status: Pending your approval' : 'Status: Confirmed',
  ].join('\n')

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `Truck Scheduler <${from}>`,
      to: [to],
      subject,
      text,
    }),
  })

  if (!resendRes.ok) {
    const errText = await resendRes.text()
    return NextResponse.json({ error: errText }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
