// Supabase Edge Function: invite a manager, admin or coach by email.
//
// Contract (matches the deployed production function):
//   * the caller is authenticated and has an active profile;
//   * only Owner/Manager/Admin can invite, according to the role matrix;
//   * Manager/Admin are locked to their own institution, Owner selects one;
//   * EVERY invitation is an email invitation. No OTP, SMS or WhatsApp path is
//     generated for invitations; the unrelated OTP/recovery functions remain
//     intact elsewhere in the project;
//   * an invitation row is the source of truth and lives for seven days;
//   * duplicate live invitations are rejected;
//   * an existing account is never mutated here. The person signs in with their
//     own account and accepts the pending invitation in the app;
//   * a newly invited account stays pending until the Owner/Manager review.
//
// Required function secrets:
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//   APP_URL, ALLOWED_ORIGINS (comma-separated)
//
// Deploy with: supabase functions deploy invite-user

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.0'
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import {
  HttpError,
  bearer,
  fail,
  isEmail,
  isUuid,
  json,
  logServerError,
  preflight,
  readJson,
  requireEnv,
  requirePost,
} from '../_shared/http.ts'

type Role = 'owner' | 'manager' | 'admin' | 'coach'
type InvitableRole = 'manager' | 'admin' | 'coach'

type Actor = {
  id: string
  role: Role
  institution_id: string | null
  account_status: string
}

// No path may produce an owner. Administration may invite another Admin or Coach,
// always inside their own institution; Managers may invite Admin or Coach.
const INVITE_MATRIX: Record<Role, InvitableRole[]> = {
  owner: ['manager', 'admin', 'coach'],
  manager: ['admin', 'coach'],
  admin: ['admin', 'coach'],
  coach: [],
}

const INVITATION_DAYS = 7

function textField(body: Record<string, unknown>, key: string, max: number): string {
  const value = body[key]
  if (typeof value !== 'string') return ''
  return value.trim().slice(0, max)
}

/** Emails may contain LIKE metacharacters; escape them for ilike lookups. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req)

  try {
    requirePost(req)

    const url = requireEnv('SUPABASE_URL')
    const anon = requireEnv('SUPABASE_ANON_KEY')
    const service = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
    const appUrl = requireEnv('APP_URL').replace(/\/+$/, '')

    const token = bearer(req)
    if (!token) throw new HttpError(401, 'unauthorized')

    const caller = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: userData, error: userError } = await caller.auth.getUser()
    if (userError || !userData.user) throw new HttpError(401, 'unauthorized')

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: actorRow, error: actorError } = await admin
      .from('profiles')
      .select('id, role, institution_id, account_status')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (actorError) throw new HttpError(500, 'profile_lookup_failed')
    if (!actorRow || actorRow.account_status !== 'active') {
      throw new HttpError(403, 'active_profile_required')
    }

    const actor = actorRow as Actor
    if (!['owner', 'manager', 'admin', 'coach'].includes(actor.role)) {
      throw new HttpError(403, 'insufficient_role')
    }

    const body = await readJson(req)
    const email = textField(body, 'email', 254).toLowerCase()
    const fullName = textField(body, 'full_name', 120)
    const role = textField(body, 'role', 16) as InvitableRole
    // The browser never selects a delivery channel for invitations.
    if (textField(body, 'delivery_method', 16) && textField(body, 'delivery_method', 16) !== 'email') {
      throw new HttpError(400, 'email_only')
    }
    if (body.use_otp === true) throw new HttpError(400, 'email_only')

    if (!isEmail(email)) throw new HttpError(400, 'invalid_email')
    if (!fullName) throw new HttpError(400, 'invalid_full_name')
    if (!['manager', 'admin', 'coach'].includes(role)) {
      throw new HttpError(403, 'role_not_allowed')
    }
    if (!INVITE_MATRIX[actor.role].includes(role)) {
      throw new HttpError(403, 'role_not_allowed')
    }

    let institutionId = actor.institution_id ?? ''
    if (actor.role === 'owner') {
      institutionId = textField(body, 'institution_id', 64)
      if (!isUuid(institutionId)) throw new HttpError(400, 'institution_required')
    } else {
      const requested = textField(body, 'institution_id', 64)
      if (requested && requested !== actor.institution_id) {
        throw new HttpError(403, 'institution_forbidden')
      }
      if (!isUuid(institutionId)) throw new HttpError(403, 'institution_required')
    }

    const { data: institution, error: institutionError } = await admin
      .from('institutions')
      .select('id, is_active')
      .eq('id', institutionId)
      .maybeSingle()
    if (institutionError) throw new HttpError(500, 'institution_lookup_failed')
    if (!institution) throw new HttpError(404, 'institution_not_found')
    if (!institution.is_active) throw new HttpError(403, 'institution_inactive')

    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    const { count, error: countError } = await admin
      .from('invitations')
      .select('id', { count: 'exact', head: true })
      .eq('inviter_id', actor.id)
      .gte('created_at', since)
    if (countError) throw new HttpError(500, 'invitation_lookup_failed')
    if ((count ?? 0) >= 20) throw new HttpError(429, 'rate_limited')

    // Duplicate prevention: one live invitation per email/institution/role.
    const { data: duplicateRows, error: duplicateError } = await admin
      .from('invitations')
      .select('id,expires_at')
      .eq('institution_id', institutionId)
      .eq('invited_email', email)
      .eq('role', role)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .limit(1)
    if (duplicateError) throw new HttpError(500, 'invitation_lookup_failed')
    if ((duplicateRows ?? []).length > 0) {
      throw new HttpError(409, 'duplicate_pending_invitation')
    }

    const { data: existingRows, error: existingError } = await admin
      .from('profiles')
      .select('id, role, account_status, institution_id')
      .ilike('email', likeLiteral(email))
      .limit(1)
    if (existingError) throw new HttpError(500, 'profile_lookup_failed')

    const existing = (existingRows ?? [])[0] as
      | { id: string; role: string; account_status: string; institution_id: string | null }
      | undefined

    if (existing) {
      if (existing.id === actor.id) throw new HttpError(403, 'self_invitation_forbidden')
      if (existing.role === 'owner') throw new HttpError(403, 'role_not_allowed')
      if (existing.account_status === 'suspended') throw new HttpError(403, 'account_suspended')
      if (
        existing.account_status === 'active'
        && existing.institution_id
        && existing.institution_id !== institutionId
      ) {
        throw new HttpError(409, 'different_institution')
      }
    }

    const expiresAt = new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000).toISOString()

    // Create the invitation first so a successful email always has a row the
    // invitee can accept. If the provider rejects the email, revoke the row
    // instead of leaving a ghost invitation.
    const { data: invitation, error: invitationError } = await admin
      .from('invitations')
      .insert({
        inviter_id: actor.id,
        institution_id: institutionId,
        role,
        invited_email: email,
        invited_name: fullName,
        delivery_method: 'email',
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('id')
      .single()
    if (invitationError || !invitation) throw new HttpError(500, 'invitation_create_failed')

    const invitationId = (invitation as { id: string }).id

    async function revokeInvitation(): Promise<void> {
      await admin
        .from('invitations')
        .update({ status: 'revoked', updated_at: new Date().toISOString() })
        .eq('id', invitationId)
        .then(() => undefined, () => undefined)
    }

    let accountCreated = false
    let existingAccount = Boolean(existing)
    let emailRequested = false

    if (!existing) {
      const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName, role, institution_id: institutionId },
        redirectTo: `${appUrl}/`,
      })
      if (inviteError) {
        const status = Number((inviteError as { status?: number }).status ?? 0)
        if (status === 422) {
          // The Auth account already exists but no profile was found. The
          // invitation is still usable after that person signs in.
          existingAccount = true
        } else {
          await revokeInvitation()
          if (status === 429) throw new HttpError(429, 'rate_limited')
          throw new HttpError(502, 'invitation_email_failed')
        }
      } else {
        accountCreated = Boolean(invited?.user?.id)
        emailRequested = true
      }
    }

    await admin.from('audit_logs').insert({
      institution_id: institutionId,
      actor_id: actor.id,
      action: existingAccount ? 'invitation_existing_account' : 'invitation_email_sent',
      table_name: 'invitations',
      record_id: invitationId,
      old_data: existing
        ? {
          role: existing.role,
          institution_id: existing.institution_id,
          account_status: existing.account_status,
        }
        : null,
      new_data: {
        role,
        delivery_method: 'email',
        account_status: 'pending',
        email_requested: emailRequested,
      },
    }).then(() => undefined, () => undefined)

    return json(req, {
      ok: true,
      invitation_id: invitationId,
      delivery_method: 'email',
      expires_at: expiresAt,
      account_created: accountCreated,
      existing_account: existingAccount,
      account_status: existing?.account_status ?? 'pending',
      message: existingAccount
        ? (existing?.account_status === 'active' ? 'existing_account_sign_in' : 'existing_account_pending')
        : 'invitation_email_sent',
    })
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status >= 500) logServerError('invite-user', error)
      return fail(req, error.status, error.code)
    }
    logServerError('invite-user', error)
    return fail(req, 500, 'internal_error')
  }
})
