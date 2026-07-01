export type Role = 'admin' | 'sales_manager' | 'applicator' | 'viewer'

export interface Profile {
  id: string
  full_name: string
  role: Role
  created_at: string
}

export interface DailyCapacity {
  id: string
  date: string        // 'YYYY-MM-DD'
  max_trucks: number
  set_by: string | null
  updated_at: string
}

export type AppointmentStatus = 'confirmed' | 'pending_approval' | 'approved' | 'rejected'
export type JobType = 'application' | 'stg_disinfect'

export interface ProductEntry {
  product: string
  rate: string
}

export interface Appointment {
  id: string
  date: string        // 'YYYY-MM-DD'
  salesman_id: string
  job_type: JobType
  customer_name: string
  storage_name: string | null
  storage_capacity: number | null
  cwt: number | null
  products: ProductEntry[]
  notes: string | null
  status: AppointmentStatus
  truck_id: string | null
  slot_count: number  // how many truck slots this appointment occupies (0 for disinfects by default)
  created_at: string
  updated_at: string
  // from view
  salesman_name?: string
  truck_name?: string
  applicator_name?: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ApprovalRequest {
  id: string
  appointment_id: string | null
  salesman_id: string
  date: string
  job_type: JobType
  customer_name: string
  storage_name: string | null
  storage_capacity: number | null
  notes: string | null
  status: ApprovalStatus
  admin_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  // joined
  salesman_name?: string
}

export interface Settings {
  key: string
  value: string
}

export interface Truck {
  id: string
  name: string
  applicator_id: string | null
  applicator_name?: string
  active_from: string | null   // 'YYYY-MM-DD'
  active_to: string | null     // 'YYYY-MM-DD'
  created_by: string | null
  created_at: string
}

export type DayOffStatus = 'pending' | 'approved' | 'rejected'

export interface DayOff {
  id: string
  applicator_id: string
  truck_id: string | null
  date: string               // 'YYYY-MM-DD'
  reason: string | null
  status: DayOffStatus
  admin_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  // joined
  applicator_name?: string
  truck_name?: string
}

export interface CapacityRule {
  id: string
  name: string | null
  start_date: string    // 'YYYY-MM-DD'
  end_date: string      // 'YYYY-MM-DD'
  days_of_week: number[] // 0=Sun,1=Mon,...,6=Sat
  max_applications: number
  truck_ids: string[] | null  // null = applies to all trucks
  created_by: string | null
  created_at: string
}

// Grouped by date for calendar display
export interface DayData {
  date: string
  appointments: Appointment[]
  maxApplications: number
  isFull: boolean
  isWeekendBlocked: boolean
}
