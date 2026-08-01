// Edge functions get no CORS headers for free, and every one of these is
// cross-origin (web origin / tauri:// -> the Supabase API) with a custom
// Authorization header, so the browser preflights every call.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

export const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
