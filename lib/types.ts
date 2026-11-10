export type Role = "admin" | "factory" | "sales" | "floor_manager";
export type OrderStatus = "pending" | "in_progress" | "completed" | "dispatched" | "cancelled";

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: Role;
  can_place_orders: boolean;
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
  placed_by: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  thick: string;
  panel: string;
  printing: string | null;
  packing_type: string | null;
  door_type: string | null;
  design_number: string | null;
  design_photo_url: string | null;
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
  cancel_reason: string | null;
  created_by: string | null;
  created_at: string;
  in_progress_at: string | null;
  completed_at: string | null;
  dispatched_at: string | null;
  cancelled_at: string | null;
  order_photos?: OrderPhoto[];
  photos?: string[];
}

export type ListType = "thick" | "panel" | "party" | "salesperson" | "door_type" | "design_number";

export interface OptionRow {
  id: string;
  list_type: ListType;
  value: string;
  photo_url: string | null;
  door_type: string | null;
  default_panel: string | null;
  photo_required: boolean;
  created_at: string;
}

export interface FloorManager {
  id: string;
  name: string;
}

export type MachineStatus = "working" | "not_working" | "in_service";

export interface Machine {
  id: string;
  name: string;
  status: MachineStatus;
  created_at: string;
}

export type RawMaterialStatus = "order_placed" | "in_dispatch" | "delivered";

export interface RawMaterial {
  id: string;
  material: string;
  quantity: number;
  unit: string;
  needed_by: string | null;
  notes: string | null;
  status: RawMaterialStatus;
  requested_by_name: string | null;
  voice_note_url: string | null;
  photo_url: string | null;
  given_by_name: string | null;
  assigned_to_name: string | null;
  created_at: string;
}
