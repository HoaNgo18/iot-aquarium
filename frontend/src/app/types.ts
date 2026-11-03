import type { AlertRecord, TelemetryReading } from '../types/monitoring'

export interface User { id: number; username: string; display_name: string }
export interface Tank {
  id: number
  name: string
  device_id: string
  volume_l: number | null
  species: string | null
  created_at: string | null
  connectivity: 'online' | 'offline'
  last_seen_at: string | null
  open_alerts: number
  latest: TelemetryReading | null
}
export type Repeat = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'
export interface Reminder {
  id: number; title: string; note: string | null; tank_id: number | null; tank_name: string | null
  repeat: Repeat; due_date: string; done_at: string | null; last_done_at: string | null
}
export interface TankAlert extends AlertRecord { tank_name: string }
