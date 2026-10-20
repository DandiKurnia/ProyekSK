export interface ClassOption {
  class_id: string;
  name: string;
}

export interface DeviceInfo {
  device_id: string;
  name: string;
  type: string;
  status: string;
  last_seen_at: string | null;
  stale: boolean;
}

export interface RecentItem {
  attendance_id: string;
  student_id: string;
  student_name: string | null;
  status: string;
  check_in_at: string;
  face_confidence: number | null;
  fingerprint_slot: number | null;
}

export interface OverviewSummary {
  date: string;
  class_id: string;
  classes: ClassOption[];
  total: number;
  present: number;
  late: number;
  absent: number;
  failed: number;
  expired: number;
  seats: { total: number; occupied: number; empty: number; unknown: number };
  devices: DeviceInfo[];
  recent: RecentItem[];
  device_offline_seconds: number;
}
