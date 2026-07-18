// Shared Supabase client for the Wing Beat cloud database (samples, conductor
// presets, live state). The publishable key is safe to ship in the bundle;
// access is governed by RLS policies on the wingbeat_* tables.
import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://ralyyojiwvnsqdnxkfwb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_KWCW83UUfYvjVUnyyX3-Gw_KuaMbXur';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
