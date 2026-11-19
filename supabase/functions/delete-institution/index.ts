import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0'
class HttpError extends Error { constructor(public status: number, public code: string) { super(code) } }
function requireEnv(name: string): string { const value = Deno.env.get(name); if (!value?.trim()) throw new HttpError(500, 'configuration_error'); return value.trim() }
function bearer(req: Request): string { const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('Authorization') ?? ''); return match ? match[1].trim() : '' }
function corsHeaders(req: Request): Record<string,string> {
  const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(x => x.trim()).filter(Boolean)
  const app = (Deno.env.get('APP_URL') ?? '').trim().replace(/\/+$/, '')
  const allowed = [...configured, ...(app ? [app] : [])]
  const origin = req.headers.get('Origin') ?? ''
  return { Vary:'Origin', 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS', ...(origin && allowed.includes(origin.replace(/\/+$/, '')) ? {'Access-Control-Allow-Origin':origin} : {}) }
}
function json(req: Request, body: unknown, status=200): Response { return new Response(JSON.stringify(body), {status, headers:{...corsHeaders(req),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}}) }
function fail(req: Request, status: number, code: string): Response { return json(req,{error:code},status) }
async function readJson(req: Request): Promise<Record<string,unknown>> {
  const raw=await req.text(); if(!raw.trim() || raw.length>32768) throw new HttpError(raw.length>32768?413:400,'invalid_request')
  try { const value=JSON.parse(raw); if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error(); return value as Record<string,unknown> } catch { throw new HttpError(400,'invalid_request') }
}

type StorageFile = { name: string; id?: string | null; metadata?: Record<string, unknown> | null }
const BUCKETS = ['trainer-avatars', 'trainer-media', 'trainer-medical', 'trainer-report-templates']
const MAX_DEPTH = 10

async function collectFiles(client: ReturnType<typeof createClient>, bucket: string, folder: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) throw new HttpError(500, 'storage_path_depth_exceeded')
  const files: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } })
    if (error) throw new HttpError(502, 'storage_listing_failed')
    const entries = (data ?? []) as StorageFile[]
    for (const item of entries) {
      const path = folder ? `${folder}/${item.name}` : item.name
      if (item.id == null || item.metadata == null) files.push(...await collectFiles(client, bucket, path, depth + 1))
      else files.push(path)
    }
    if (entries.length < 1000) break
  }
  return files
}

async function removeFiles(client: ReturnType<typeof createClient>, bucket: string, files: string[]): Promise<number> {
  let removed = 0
  for (let i = 0; i < files.length; i += 100) {
    const batch = files.slice(i, i + 100)
    const { data, error } = await client.storage.from(bucket).remove(batch)
    if (error) throw new HttpError(502, 'storage_removal_failed')
    removed += data?.length ?? batch.length
  }
  return removed
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed')
    const token = bearer(req)
    if (!token) throw new HttpError(401, 'unauthorized')
    const url = requireEnv('SUPABASE_URL')
    const anon = requireEnv('SUPABASE_ANON_KEY')
    const service = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const userClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data: authData, error: authError } = await userClient.auth.getUser()
    if (authError || !authData.user) throw new HttpError(401, 'unauthorized')
    const body = await readJson(req)
    const institutionId = typeof body.institution_id === 'string' ? body.institution_id.trim() : ''
    const confirmationName = typeof body.confirmation_name === 'string' ? body.confirmation_name.trim() : ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(institutionId) || !confirmationName) {
      throw new HttpError(400, 'invalid_request')
    }
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
    const { data: actor, error: actorError } = await admin.from('profiles').select('id,role,institution_id,account_status').eq('id', authData.user.id).maybeSingle()
    if (actorError || !actor || actor.role !== 'manager' || actor.account_status !== 'active' || actor.institution_id !== institutionId) {
      throw new HttpError(403, 'manager_access_required')
    }
    const { data: institution, error: institutionError } = await admin.from('institutions').select('id,name').eq('id', institutionId).maybeSingle()
    if (institutionError) throw new HttpError(500, 'institution_lookup_failed')
    if (!institution || institution.name !== confirmationName) throw new HttpError(409, 'institution_confirmation_mismatch')

    // Pre-list every bucket before deleting any object, so a listing failure
    // cannot cause a partial cleanup. All paths are rooted under this tenant ID.
    const plans = await Promise.all(BUCKETS.map(async (bucket) => ({ bucket, files: await collectFiles(admin, bucket, institutionId) })))
    let removed = 0
    for (const plan of plans) removed += await removeFiles(admin, plan.bucket, plan.files)

    // Use the caller JWT for the public SECURITY INVOKER RPC; the private
    // SECURITY DEFINER implementation performs the atomic tenant-row deletion.
    const { data, error } = await userClient.rpc('delete_institution', {
      p_institution_id: institutionId,
      p_confirmation_name: confirmationName,
    })
    if (error || !(data as { deleted?: boolean } | null)?.deleted) {
      throw new HttpError(502, 'database_delete_failed_after_storage_cleanup')
    }
    return json(req, { ...(data as Record<string, unknown>), storage_objects_removed: removed })
  } catch (error) {
    if (error instanceof HttpError) return fail(req, error.status, error.code)
    console.error('delete-institution', error instanceof Error ? error.message.slice(0, 250) : 'unknown error')
    return fail(req, 500, 'internal_error')
  }
})
