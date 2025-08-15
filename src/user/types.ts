export interface WorkOSUser {
  object: 'user';
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  email_verified: boolean;
  profile_picture_url?: string;
  created_at: string;
  updated_at: string;
}

export interface WorkOSWebhookEvent {
  id: string;
  event: 'user.created' | 'user.updated' | 'user.deleted';
  created_at: string;
  data: WorkOSUser;
}

export interface UserRecord {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  email_verified: boolean;
  profile_picture_url?: string;
  workos_id: string;
  deleted_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface TeamRecord {
  id: string;
  name: string;
  description?: string;
  created_at: Date;
  updated_at: Date;
}

export interface TeamUserRecord {
  team_id: string;
  user_id: string;
  role: 'owner' | 'admin' | 'member';
  joined_at: Date;
}
