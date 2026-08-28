export type Role = "admin" | "factory" | "sales";
export type OrderStatus = "pending" | "in_progress" | "completed" | "dispatched";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  created_at: string;
}

export interface OrderPhoto {
  id: string;
  order_id: string;
  url: string;
  created_at: string;
}

export interface Order {
  id: string;
  order_no: string;
  line_no: number;
  line_count: number;
  serial_num: number;
  party: string;
  thick: string;
  panel: string;
  length_mm: number;
  breadth_mm: number;
  qty: number;
  area_sqft: number;
  total_sqft: number;
  design: "2D" | "3D";
  delivery_date: string;
  reminder_days: number;
  reminder_date: string | null;
  notes: string | null;
  status: OrderStatus;
  sequence: number;
  dispatch_photo_url: string | null;
  created_by: string | null;
  created_at: string;
  in_progress_at: string | null;
  completed_at: string | null;
  dispatched_at: string | null;
  order_photos?: OrderPhoto[];
  photos?: string[];
}

export interface OptionRow {
  id: string;
  list_type: "thick" | "panel" | "party";
  value: string;
  created_at: string;
}
