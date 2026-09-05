const { createClient } = supabase;
window.sb = createClient(
  window.ROCKFALL_CONFIG.SUPABASE_URL,
  window.ROCKFALL_CONFIG.SUPABASE_ANON_KEY
);
