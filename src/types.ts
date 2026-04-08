export interface PlayerRow {
  id: number;
  name: string;
  created_at: Date;
  updated_at: Date;
  last_seen: Date;
}

export interface RoomRow {
  id: number;
  name: string;
  map_id: number;
  created_at: Date;
}

export interface SessionRow {
  id: number;
  player_id: number;
  room_id: number;
  connected_at: Date;
  disconnected_at: Date | null;
  last_ip: string | null;
}
