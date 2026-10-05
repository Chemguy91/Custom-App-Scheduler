import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'

// Fires a one-line email to the owner whenever anyone else schedules (or
// requests approval for) a job — sales managers and any other admin account.
// Only the configured recipient's own account is excluded, so the owner
// never gets notified about their own action.
//
// Logs at every branch (prefixed [notify-job]) so a silent failure shows up
// in Vercel's runtime logs instead of just vanishing.
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

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (!user) {
    console.error('[notify-job] no authenticated user on request', authError?.message)
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const apiKey = process.env.RESEND_API_KEY
  const from   = process.env.JOB_NOTIFY_FROM_EMAIL
  const to     = process.env.JOB_NOTIFY_TO_EMAIL
  if (!apiKey || !from || !to) {
    // Notifications aren't configured — don't let that break scheduling.
    console.error('[notify-job] missing env vars — RESEND_API_KEY/JOB_NOTIFY_FROM_EMAIL/JOB_NOTIFY_TO_EMAIL', {
      hasApiKey: !!apiKey, hasFrom: !!from, hasTo: !!to,
    })
    return NextResponse.json({ ok: true, skipped: true })
  }

  // Don't notify the owner about their own action — but DO notify for every
  // other account, including other admins (not just sales managers).
  if (user.email && user.email.toLowerCase() === to.toLowerCase()) {
    console.log('[notify-job] skipped — caller is the notification owner', user.email)
    return NextResponse.json({ ok: true, skipped: true })
  }

  const { data: callerProfile, error: profileError } = await supabase
    .from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    console.error('[notify-job] failed to look up caller profile', user.id, profileError.message)
  }

  const { customerName, date, jobType, pending } = await req.json()
  if (!customerName || !date) {
    console.error('[notify-job] missing required fields in request body', { customerName, date })
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const callerName = callerProfile?.full_name ?? 'Someone'
  const callerEmail = user.email ?? 'unknown email'
  const action = pending ? 'requested approval for' : 'scheduled'
  const subject = `${callerName} ${action} a job — ${customerName}`
  const displayDate = new Date(`${date}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  const text = [
    `${callerName} ${action} a job in the scheduler.`,
    '',
    `Created by: ${callerName} (${callerEmail})`,
    `Customer: ${customerName}`,
    `Date: ${displayDate}`,
    `Job type: ${jobType ?? 'Application'}`,
    pending ? 'Status: Pending your approval' : 'Status: Confirmed',
  ].join('\n')

  console.log('[notify-job] sending email', { callerEmail, callerName, customerName, date })

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
    console.error('[notify-job] Resend send failed', resendRes.status, errText)
    return NextResponse.json({ error: errText }, { status: 502 })
  }

  console.log('[notify-job] email sent successfully', { callerEmail, customerName })
  return NextResponse.json({ ok: true })
}
