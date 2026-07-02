import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { DEMO_EMAIL } from '@/lib/demo'

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user || user.email !== DEMO_EMAIL) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Check if already seeded
  const { data: existing } = await supabase
    .from('appointments')
    .select('id')
    .eq('is_demo', true)
    .limit(1)

  if (existing && existing.length > 0) {
    return NextResponse.json({ ok: true, seeded: false })
  }

  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  const now   = new Date()
  const year  = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const d     = (day: number) => `${year}-${month}-${String(day).padStart(2, '0')}`

  // Seed a demo truck
  const { data: truck } = await adminClient
    .from('trucks')
    .insert({ name: 'Demo Truck 1', created_by: user.id })
    .select('id')
    .single()

  const truckId = truck?.id ?? null

  // Seed approved appointments
  await adminClient.from('appointments').insert([
    {
      date: d(3), salesman_id: user.id, job_type: 'application',
      customer_name: 'Johnson Farms', storage_name: 'North Bin',
      storage_capacity: 50000, cwt: 25000,
      products: [{ product: 'Smart Block', rate: '0.5 oz/cwt' }],
      status: 'approved', slot_count: 1, truck_id: truckId,
    },
    {
      date: d(7), salesman_id: user.id, job_type: 'application',
      customer_name: 'Miller Grain Co.', storage_name: 'East Flat',
      storage_capacity: 80000, cwt: 42000,
      products: [{ product: 'DMN', rate: '4 oz/cwt' }],
      status: 'approved', slot_count: 1, truck_id: truckId,
    },
    {
      date: d(10), salesman_id: user.id, job_type: 'application',
      customer_name: 'Thompson Ag', storage_name: 'Main Storage',
      storage_capacity: 35000, cwt: 18500,
      products: [{ product: 'CIPC', rate: '2.5 oz/cwt' }],
      status: 'approved', slot_count: 1, truck_id: truckId,
    },
    {
      date: d(14), salesman_id: user.id, job_type: 'application',
      customer_name: 'Davis Grain', storage_name: 'West Bin',
      storage_capacity: 100000, cwt: 55000,
      products: [{ product: 'Storox / Perox AG', rate: '1 oz/cwt' }],
      status: 'approved', slot_count: 1, truck_id: truckId,
    },
    {
      date: d(14), salesman_id: user.id, job_type: 'application',
      customer_name: 'Henderson Farms', storage_name: 'South Bin',
      storage_capacity: 60000, cwt: 30000,
      products: [{ product: 'Fresh Pack 100', rate: '3 oz/cwt' }],
      status: 'approved', slot_count: 1, truck_id: truckId,
    },
    {
      date: d(17), salesman_id: user.id, job_type: 'stg_disinfect',
      customer_name: 'Wilson Bins', storage_name: 'Facility A',
      storage_capacity: 45000, cwt: null,
      products: [], status: 'approved', slot_count: 0, truck_id: truckId,
    },
    {
      date: d(21), salesman_id: user.id, job_type: 'application',
      customer_name: 'Baker Farms', storage_name: 'Bin 3',
      storage_capacity: 28000, cwt: 14000,
      products: [{ product: '1,4 Zap', rate: '2 oz/cwt' }],
      status: 'approved', slot_count: 1, truck_id: truckId,
    },
    {
      date: d(24), salesman_id: user.id, job_type: 'application',
      customer_name: 'Cooper Storage', storage_name: 'Big Flat',
      storage_capacity: 120000, cwt: 68000,
      products: [{ product: 'Smart Block', rate: '0.5 oz/cwt' }, { product: 'Amplify', rate: '1 oz/cwt' }],
      status: 'approved', slot_count: 1, truck_id: truckId,
    },
  ])

  // Seed a couple pending approval requests for the Requests tab
  await adminClient.from('approval_requests').insert([
    {
      salesman_id: user.id,
      date: d(28),
      job_type: 'application',
      customer_name: 'Greenfield Co.',
      storage_name: 'Silo 1',
      storage_capacity: 40000,
      notes: 'Needs morning slot if possible.',
      status: 'pending',
    },
    {
      salesman_id: user.id,
      date: d(29),
      job_type: 'application',
      customer_name: 'Riverside Ag',
      storage_name: 'River Bin',
      storage_capacity: 55000,
      notes: null,
      status: 'pending',
    },
  ])

  return NextResponse.json({ ok: true, seeded: true })
}
