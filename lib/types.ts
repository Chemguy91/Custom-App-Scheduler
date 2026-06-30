export type Role = 'admin' | 'salesman'

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

export interface Appointment {
  id: string
  date: string        // 'YYYY-MM-DD'
  salesman_id: string
  customer_name: string
  notes: string | null
  status: AppointmentStatus
  created_at: string
  updated_at: string
  // from view
  salesman_name?: string
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface ApprovalRequest {
  id: string
  appointment_id: string | null
  salesman_id: string
  date: string
  customer_name: string
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

// Grouped by date for calendar display
export interface DayData {
  date: string
  appointments: Appointment[]
  maxTrucks: number
  isFull: boolean
}
