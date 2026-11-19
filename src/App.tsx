import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import {
  Activity, Archive, Bell, Building2, CalendarDays, Check, ChevronLeft, ClipboardList,
  FileUp, FileText, GraduationCap, HeartPulse, History, Home, Languages, LogOut, Menu,
  MessageCircle, Mic, NotebookPen, Paperclip, Pencil, Plus, Search, Send,
  Settings as SettingsIcon, ShieldCheck, Square, Trash2, UserPlus, Users, X,
  type LucideIcon,
} from 'lucide-react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isConfigured } from './lib/supabase'
import { makeT, isRtl, setDateLocale, formatDateTime, formatTime, type Lang } from './lib/i18n'
import { notify, setToastListener } from './lib/toast'
import { parseStudentImportText } from './lib/student-import'
import {
  loadAttendance, saveAttendance, buildAttendanceRows, NO_SESSION,
} from './lib/attendance'
import { cacheAttendanceRoster, cacheAttendanceSession, cacheAttendanceSnapshot, getQueuedAttendance, listQueuedAttendance, queueAttendance, readAttendanceRoster, readAttendanceSession, readAttendanceSnapshot, removeQueuedAttendance, updateQueuedAttendanceError } from './lib/attendance-outbox'
import {
  accountGate, gateTitleKey, gateBodyKey, gateAllowsRetry, gateCanAcceptInvitation, type GateState,
} from './lib/account-gate'
import {
  ASSIGNABLE_ROLES, INVITE_MATRIX, canInvite, canReviewAccount, isAccountRole,
  type AccountRole,
} from './lib/account-policy'
import {
  loadReportDraft, saveReportDraft, clearReportDraft, hasDraftContent,
  type ReportCounts,
} from './lib/report-draft'
import { buildReportDocument, reportFileName } from './lib/report-export'
import {
  pushEnv, pushNotification, requestPushPermission, type PushPermission,
} from './lib/push-notify'
import { canSubmitReport, draftSubmittedAt, type ReportLifecycleState } from './lib/report-submission'
import { canDeleteReport, canReviewReport, affectedRows } from './lib/report-permissions'
import {
  buildReportDetailRows, detailsInsertedCompletely, reportAcceptsDetails, upsertDetailDraft,
  type DetailDraft,
} from './lib/report-details'
import {
  TEMPLATE_PLACEHOLDERS, templateExportFileName, type TemplateReportInput,
} from './lib/report-template'
import { inspectWordTemplate, readWordFieldValues, missingRequiredWordFields, type WordInputField } from './lib/word-template-editor'

type Role = 'owner' | 'manager' | 'admin' | 'coach'
type Profile = {
  id: string
  full_name: string
  email: string
  role: Role
  institution_id: string | null
  account_status: string
  preferred_language: Lang
  avatar_path?: string | null
}
type T = (key: string) => string
type AuthOtpType = 'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'
type Student = {
  id: string
  student_code: string
  full_name: string
  is_active: boolean
  date_of_birth?: string | null
  institution_id?: string | null
  class_id?: string | null
}
type Person = {
  id: string
  full_name: string
  email: string
  role?: string
  account_status?: string
  institution_id?: string | null
  created_at?: string
}
type AccountRow = Profile & {
  avatar_path?: string | null
  created_at?: string
  approved_by?: string | null
  approved_at?: string | null
}
type InvitationRow = {
  id: string
  invited_email: string | null
  invited_name: string | null
  role: string
  institution_id: string
  status: string
  delivery_method: string
  expires_at: string
  created_at: string
}
type PendingInvitation = {
  id: string
  role: string
  institution_id: string
  institution_name?: string | null
  invited_email?: string | null
  invited_name?: string | null
  delivery_method?: string | null
  expires_at?: string | null
}
type Conversation = {
  id: string
  title: string | null
  conversation_type: string
  created_by: string
  created_at: string
  label?: string
  people?: Person[]
}
type ChatMessage = {
  id: string
  body: string | null
  sender_id: string
  created_at: string
  message_type: string
  media_path: string | null
  readBy?: { id: string; full_name: string; read_at: string }[]
  profiles?: { full_name?: string | null } | null
  media_url?: string
}
type ReportRow = {
  id: string
  institution_id?: string | null
  coach_id: string
  coach_name_snapshot: string
  report_date: string
  present_count: number
  absent_count: number
  late_count: number
  injured_count: number
  excused_count: number
  notes?: string | null
  status: string
  is_finalized: boolean
  shift_start?: string | null
  shift_end?: string | null
  reviewed_by?: string | null
  finalized_at?: string | null
  reviewed_at?: string | null
  created_at: string
  // Independent report chronology fields (task requirement).
  // reporting_period_start / reporting_period_end define the period covered by
  // the report; issue_date is when the coach issued/prepared it; submitted_at is
  // when the final report was actually submitted. They are never derived from
  // `report_date` or the shift timestamps.
  reporting_period_start?: string | null
  reporting_period_end?: string | null
  issue_date?: string | null
  submitted_at?: string | null
}
type MedicalRecord = {
  id: string
  student_id: string
  record_type: string
  details: string
  start_date?: string | null
  end_date?: string | null
  start_at?: string | null
  end_at?: string | null
  notified_at?: string | null
  actual_return_at?: string | null
  duty_completed_at?: string | null
  attachment_path?: string | null
  attachment_url?: string
  created_at: string
}
type AuditRow = {
  id: number | string
  actor_id?: string | null
  action: string
  table_name: string
  record_id?: string | null
  old_data?: unknown
  new_data?: unknown
  created_at: string
  profiles?: { full_name?: string | null } | null
}

// institution_id, coach_id and shift_id identify a report and are immutable in the
// database (guard_daily_report_relation). They are sent only on INSERT; sending the
// current shift on every update made editing an older draft fail with
// "Report identity is immutable".
function withoutReportIdentity<T extends Record<string, unknown>>(row: T) {
  const { shift_id, coach_id, institution_id, ...rest } = row
  void shift_id; void coach_id; void institution_id
  return rest
}

function localDate() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** True when Supabase redirected back with a password-recovery or invite token. */
function passwordSetupLink(): 'recovery' | 'invite' | null {
  if (typeof window === 'undefined') return null
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const type = hash.get('type')
    return type === 'recovery' || type === 'invite' ? type : null
  } catch {
    return null
  }
}

/** Removes one-time auth parameters without touching the router path. */
function cleanAuthUrl() {
  try {
    const url = new URL(window.location.href)
    for (const key of ['code', 'token_hash', 'type', 'error', 'error_code', 'error_description']) {
      url.searchParams.delete(key)
    }
    url.hash = ''
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  } catch { /* history is optional */ }
}

function defaultLocalProfile(): Profile {
  return {
    id: 'local-preview',
    full_name: '',
    email: '',
    role: 'owner',
    institution_id: null,
    account_status: 'active',
    preferred_language: 'ar',
  }
}


const roleLabel = (role: string, t: T) => t(role)
const emptyCounts = (): ReportCounts => ({
  present_count: 0, absent_count: 0, late_count: 0, injured_count: 0, excused_count: 0,
})
export default function App() {
  const [lang, setLang] = useState<Lang>(() => {
    try {
      const saved = localStorage.getItem('tt_lang')
      return saved === 'ar' || saved === 'fr' || saved === 'en' ? saved : 'ar'
    } catch { return 'ar' }
  })
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  // Latest loaded profile, readable inside the long-lived auth listener.
  const profileRef = useRef<Profile | null>(null)
  profileRef.current = profile
  const [profileError, setProfileError] = useState('')
  const [localProfile, setLocalProfile] = useState<Profile>(defaultLocalProfile)
  const [passwordSetup, setPasswordSetup] = useState<'recovery' | 'invite' | null>(null)
  const [authNotice, setAuthNotice] = useState('')
  const [busy, setBusy] = useState(true)
  const [menu, setMenu] = useState(false)
  const [toast, setToast] = useState('')
  const [unread, setUnread] = useState(0)
  const nav = useNavigate()
  const t: T = useMemo(() => makeT(lang), [lang])
  const rtl = isRtl(lang)
  const isLocalMode = !isConfigured
  const gate: GateState = accountGate(profile, profileError)

  useEffect(() => {
    document.documentElement.lang = lang
    document.documentElement.dir = rtl ? 'rtl' : 'ltr'
    setDateLocale(lang)
    try { localStorage.setItem('tt_lang', lang) } catch { /* storage is optional */ }
  }, [lang, rtl])

  useEffect(() => setToastListener(setToast), [])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(''), 4200)
    return () => window.clearTimeout(id)
  }, [toast])

  async function loadProfile(id: string) {
    if (!isConfigured) return
    let { data, error } = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
    if (error) {
      setProfileError(error.message)
      setProfile(null)
      return
    }
    if (!data) {
      // Repair an Auth user whose trigger-created profile is missing. The RPC
      // only ever creates a safe coach/pending row for the caller; the exact
      // confirmed owner email may bootstrap the owner when none exists.
      const ensured = await supabase.rpc('ensure_my_profile')
      if (ensured.error) {
        setProfileError(ensured.error.message)
        setProfile(null)
        return
      }
      const retry = await supabase.from('profiles').select('*').eq('id', id).maybeSingle()
      if (retry.error) {
        setProfileError(retry.error.message)
        setProfile(null)
        return
      }
      data = retry.data
    }
    setProfileError('')
    setProfile((data as Profile | null) ?? null)
  }

  useEffect(() => {
    if (!isConfigured) { setBusy(false); return }
    let alive = true
    const sync = async (id: string) => {
      await loadProfile(id)
      if (alive) setBusy(false)
    }

    /**
     * Supabase can return an email link in several shapes. The client already
     * handles implicit hash links; PKCE `?code=` and `?token_hash=&type=`
     * links are completed here. The invitation link authenticates the
     * recipient; accepting that invitation activates the account immediately.
     */
    async function handleEmailLink(): Promise<boolean> {
      const search = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const code = search.get('code')
      const tokenHash = search.get('token_hash')
      const rawType = search.get('type') || hash.get('type') || ''
      const linkType: AuthOtpType = rawType === 'invite' || rawType === 'recovery'
        || rawType === 'signup' || rawType === 'magiclink' || rawType === 'email_change'
        ? rawType
        : 'email'
      const linkError = search.get('error_description') || search.get('error')
        || hash.get('error_description') || hash.get('error')

      if (linkError) {
        if (alive) setAuthNotice(makeT(lang)('authLinkInvalid'))
        cleanAuthUrl()
        return true
      }
      if (!code && !tokenHash) {
        return false
      }

      // The Supabase client may already have consumed a PKCE code during its
      // own initialisation. Only exchange when no session was recovered.
      const current = await supabase.auth.getSession()
      if (current.data.session) {
        if (linkType === 'recovery' || linkType === 'invite') setPasswordSetup(linkType)
        cleanAuthUrl()
        return true
      }

      const result = code
        ? await supabase.auth.exchangeCodeForSession(code)
        : await supabase.auth.verifyOtp({ token_hash: tokenHash as string, type: linkType })
      if (!alive) return true
      if (result.error) {
        setAuthNotice(makeT(lang)('authLinkInvalid'))
      } else {
        if (linkType === 'recovery' || linkType === 'invite') setPasswordSetup(linkType)
        setAuthNotice('')
      }
      cleanAuthUrl()
      return true
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, next) => {
      if (!alive) return
      if (event === 'INITIAL_SESSION') return
      if (event === 'PASSWORD_RECOVERY') setPasswordSetup('recovery')
      setSession(next)
      if (next) {
        // Returning from the file picker / another app makes Supabase re-emit
        // SIGNED_IN or TOKEN_REFRESHED for the SAME user. Re-syncing would show the
        // loading screen and wipe every open form, so it is skipped.
        if (
          (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') &&
          profileRef.current?.id === next.user.id
        ) return
        setBusy(true)
        void sync(next.user.id)
      } else {
        setProfile(null)
        setProfileError('')
        setBusy(false)
      }
    })

    void (async () => {
      await handleEmailLink()
      const { data } = await supabase.auth.getSession()
      if (!alive) return
      setSession(data.session)
      if (data.session) {
        const implicit = passwordSetupLink()
        if (implicit) setPasswordSetup(implicit)
        void sync(data.session.user.id)
      } else setBusy(false)
    })()

    return () => { alive = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (isLocalMode || !profile) { setUnread(0); return }
    let alive = true
    const refresh = async () => {
      const { count } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_id', profile.id)
        .is('read_at', null)
      if (alive) setUnread(count ?? 0)
    }
    void refresh()
    const channel = supabase
      .channel(`tt-shell-${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.id}`,
      }, (payload) => {
        void refresh()
        if (payload.eventType === 'INSERT') {
          const row = payload.new as { title?: string; body?: string }
          pushNotification(row.title ?? '', row.body ?? '')
        }
      })
      .subscribe()
    return () => { alive = false; supabase.removeChannel(channel) }
  }, [profile?.id, isLocalMode])

  async function signOut() {
    if (isLocalMode) {
      setLocalProfile(defaultLocalProfile())
      setMenu(false)
      nav('/')
      return
    }
    if (profile?.id) clearReportDraft(profile.id)
    await supabase.auth.signOut()
    setSession(null)
    setProfile(null)
    setProfileError('')
    setMenu(false)
    nav('/')
  }

  function retryProfile() {
    if (!session) return
    setBusy(true)
    void loadProfile(session.user.id).finally(() => setBusy(false))
  }

  const [myAvatarPath, setMyAvatarPath] = useState<string | null>(null)
  const [myAvatarSignedUrl, setMyAvatarSignedUrl] = useState<string | null>(null)
  const [myAvatarBusy, setMyAvatarBusy] = useState(false)

  useEffect(() => {
    let alive = true
    async function resolveMyAvatar() {
      const path = (isLocalMode ? localProfile : profile)?.avatar_path || null
      setMyAvatarPath(path)
      setMyAvatarSignedUrl(null)
      if (!path) return
      const { data } = await supabase.storage.from('trainer-avatars').createSignedUrl(path, 3600)
      if (alive) setMyAvatarSignedUrl(data?.signedUrl || null)
    }
    void resolveMyAvatar()
    return () => { alive = false }
  }, [isLocalMode, profile?.avatar_path, profile?.id, localProfile?.avatar_path, localProfile?.id])

  async function uploadMyAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const me = isLocalMode ? localProfile : profile
    if (!me) return
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!/image\/(png|jpe?g|webp)/.test(file.type)) { notify(t('invalidImage')); return }
    if (file.size > 2 * 1024 * 1024) { notify(t('imageTooLarge')); return }
    setMyAvatarBusy(true)
    const extension = file.name.split('.').pop() || 'png'
    const avatar_path = `${me.institution_id || 'platform'}/${me.id}/avatar-${Date.now()}.${extension}`
    const { error: uploadError } = await supabase.storage.from('trainer-avatars').upload(avatar_path, file, { upsert: false, contentType: file.type })
    if (uploadError) { notify(uploadError.message); setMyAvatarBusy(false); return }
    const { data } = await supabase.storage.from('trainer-avatars').createSignedUrl(avatar_path, 3600)
    if (!data?.signedUrl) { notify(t('errorGeneric')); setMyAvatarBusy(false); return }
    const { error: updateError } = await supabase.from('profiles').update({ avatar_path }).eq('id', me.id)
    if (updateError) { notify(updateError.message); setMyAvatarBusy(false); return }
    setMyAvatarPath(avatar_path)
    setMyAvatarSignedUrl(data.signedUrl)
    setMyAvatarBusy(false)
    notify(t('savedOk'))
    e.target.value = ''
  }

  async function deleteMyAvatar() {
    const me = isLocalMode ? localProfile : profile
    if (!me) return
    setMyAvatarBusy(true)
    const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', me.id)
    setMyAvatarBusy(false)
    if (error) { notify(error.message); return }
    setMyAvatarPath(null)
    setMyAvatarSignedUrl(null)
    notify(t('savedOk'))
  }

  // Password setup only makes sense once the email link produced a session.
  // A bare ?type=invite URL without a valid token must fall through to login.
  if (passwordSetup && (session || isLocalMode)) {
    return (
      <RecoveryScreen
        mode={passwordSetup}
        t={t}
        onDone={() => setPasswordSetup(null)}
        onSignOut={() => { setPasswordSetup(null); void signOut() }}
      />
    )
  }

  if (busy) {
    return <div className="loading-screen"><img src="/icons/brand-emblem.png" alt="T" className="brand-mark" style={{objectFit:"cover",padding:0}} /><p>{t('loading')}</p></div>
  }

  if (!isLocalMode) {
    if (!session) {
      return <Login lang={lang} setLang={setLang} t={t} notice={authNotice} />
    }
    if (gate !== 'active') {
      return (
        <GateScreen
          state={gate}
          t={t}
          onRetry={retryProfile}
          onSignOut={signOut}
          onAccepted={retryProfile}
          notice={authNotice}
        />
      )
    }
  }

  const viewProfile: Profile | null = isLocalMode ? localProfile : profile
  if (!viewProfile) {
    return (
      <GateScreen
        state="error"
        t={t}
        onRetry={retryProfile}
        onSignOut={signOut}
        onAccepted={retryProfile}
      />
    )
  }

  const owner = viewProfile.role === 'owner'
  const admin = ['owner', 'manager', 'admin'].includes(viewProfile.role)
  const navItems: [string, LucideIcon, string, boolean?][] = owner
    ? [
        ['/', Home, 'home'],
        ['/owner', Building2, 'ownerConsole'],
        ['/audit', History, 'audit'],
      ]
    : [
        ['/', Home, 'home'],
        ['/students', Users, 'students'],
        ['/classes', GraduationCap, 'classes'],
        ['/attendance', CalendarDays, 'attendance'],
        ['/followups', Activity, 'absenceFollowups'],
        ['/daily-status', CalendarDays, 'dailyStatus'],
        ['/reports', ClipboardList, 'reports'],
        ['/management-reports', FileText, 'managementReports'],
        ...(viewProfile.role === 'coach' ? [['/notebook', NotebookPen, 'notebook'] as [string, LucideIcon, string]] : []),
        ['/notices', Bell, 'notices'],
        ['/notifications', Bell, 'notifications', true],
        ['/messages', MessageCircle, 'messages'],
        ...(admin ? [
          ['/academic-years', GraduationCap, 'academicYears'] as [string, LucideIcon, string],
          ['/team', UserPlus, 'team'] as [string, LucideIcon, string],
          ['/medical', HeartPulse, 'medical'] as [string, LucideIcon, string],
          ['/settings', SettingsIcon, 'settings'] as [string, LucideIcon, string],
          ['/templates', FileUp, 'templates'] as [string, LucideIcon, string],
          ['/audit', History, 'audit'] as [string, LucideIcon, string],
        ] : []),
      ]

  // Five primary destinations for the phone bottom bar. Everything else stays
  // in the drawer so no label is ever clipped on a small screen.
  const mobileNavItems: [string, LucideIcon, string, boolean?][] = owner
    ? [
        ['/', Home, 'home'],
        ['/owner', Building2, 'ownerConsole'],
        ['/audit', History, 'audit'],
      ]
    : viewProfile.role === 'coach'
      ? [
          ['/', Home, 'home'],
          ['/students', Users, 'students'],
          ['/attendance', CalendarDays, 'attendance'],
          ['/daily-status', Activity, 'dailyStatus'],
          ['/reports', ClipboardList, 'reports'],
        ]
      : [
          ['/', Home, 'home'],
          ['/students', Users, 'students'],
          ['/reports', ClipboardList, 'reports'],
          ['/team', UserPlus, 'team'],
          ['/messages', MessageCircle, 'messages'],
        ]

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="icon-btn mobile-menu" aria-label={t('menu')} aria-expanded={menu}
          aria-controls="app-sidebar" onClick={() => setMenu((v) => !v)}>
          {menu ? <X /> : <Menu />}
        </button>
        <div className="brand">
          <img src="/icons/brand-emblem.png" alt="THE TRAINERS" className="brand-mark" />
          <div className="app-name">
            <span className="arabic">{t('app')}</span>
            <span className="latin">{t('subtitle')}</span>
          </div>
        </div>
        <div className="top-actions">
          <select aria-label={t('language')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="ar">العربية</option>
            <option value="fr">Français</option>
            <option value="en">English</option>
          </select>
          <button className="icon-btn" onClick={signOut} title={t('logout')} aria-label={t('logout')}>
            <LogOut size={19} />
          </button>
        </div>
      </header>
      <div className="layout">
        <button className={`sidebar-scrim ${menu ? 'show' : ''}`} aria-label={t('close')}
          tabIndex={menu ? 0 : -1} onClick={() => setMenu(false)} />
        <aside id="app-sidebar" className={`sidebar ${menu ? 'open' : ''}`}>
          <div className="user-mini">
            <div className="avatar">
              {myAvatarPath ? (
                <img src={myAvatarSignedUrl || myAvatarPath} alt={viewProfile.full_name || 'avatar'} className="avatar-img" />
              ) : (
                <span>{viewProfile.full_name?.slice(0, 1) || 'T'}</span>
              )}
              <button type="button" className="avatar-upload-btn" onClick={() => document.getElementById('avatar-upload-me')?.click()} disabled={myAvatarBusy}>
                {t('changeAvatar')}
              </button>
            </div>
            <div><b>{viewProfile.full_name || viewProfile.email || t('offline')}</b><small>{roleLabel(viewProfile.role, t)}</small></div>
            {myAvatarPath && (
              <button className="icon-btn" onClick={() => { void deleteMyAvatar() }} disabled={myAvatarBusy} title={t('deleteAvatar')} aria-label={t('deleteAvatar')}>
                <Trash2 size={15} />
              </button>
            )}
            <input type="file" accept="image/png,image/jpeg,image/webp" id="avatar-upload-me" onChange={(e) => { void uploadMyAvatar(e); e.target.value = '' }} hidden />
          </div>
          <nav>
            {navItems.map(([to, Icon, key, badge]) => (
              <NavLink end={to === '/'} to={to} key={to} onClick={() => setMenu(false)}>
                <Icon size={19} />
                <span>{t(key)}</span>
                {badge && unread > 0 && <span className="unread-badge">{unread > 99 ? '99+' : unread}</span>}
                <ChevronLeft className="nav-arrow" size={16} />
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-foot">
            <span className={`status-dot ${isConfigured ? 'online' : 'offline'}`}></span>
            <small>{isConfigured ? t('configured') : t('offline')}</small>
          </div>
        </aside>
        <main className="main-content">
          {isLocalMode && <div className="notice-box"><b>{t('configMissing')}</b><div>{t('configHint')}</div></div>}
          <Routes>
            <Route path="/" element={<Dashboard profile={viewProfile} t={t} />} />
            <Route path="/owner" element={owner ? <OwnerConsole profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/students" element={!owner ? <Students profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/classes" element={!owner ? <ClassManagement profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/attendance" element={!owner ? <Attendance profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/followups" element={!owner ? <FollowUpQueue profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/daily-status" element={!owner ? <DailyStatus profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/reports" element={!owner ? <Reports profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/management-reports" element={!owner ? <ManagementReports profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/notebook" element={viewProfile.role === 'coach' ? <Notebook profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/notices" element={!owner ? <Notices profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/notifications" element={!owner ? <Notifications profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/messages" element={!owner ? <Messages profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/accept-invitation" element={!owner ? <AcceptInvitation t={t} profile={viewProfile} onAccepted={retryProfile} /> : <Denied t={t} />} />
            <Route path="/academic-years" element={admin && !owner ? <AcademicYears profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/team" element={admin && !owner ? <Team profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/medical" element={admin && !owner ? <Medical profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/settings" element={admin && !owner ? <InstitutionSettings profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/templates" element={admin && !owner ? <ReportTemplates profile={viewProfile} t={t} /> : <Denied t={t} />} />
            <Route path="/audit" element={admin ? <Audit t={t} /> : <Denied t={t} />} />
            <Route path="*" element={<NotFound t={t} />} />
          </Routes>
        </main>
      </div>
      <nav className="mobile-nav" aria-label={t('navigation')}>
        {mobileNavItems.map(([to, Icon, key, badge]) => (
          <NavLink end={to === '/'} to={to} key={to}>
            <span className="mobile-nav-icon">
              <Icon size={20} />
              {badge && unread > 0 && <span className="mobile-nav-badge">{unread > 9 ? '9+' : unread}</span>}
            </span>
            <span>{t(key)}</span>
          </NavLink>
        ))}
      </nav>
      {toast && <div className="toast" role="status" onClick={() => setToast('')}>{toast}</div>}
    </div>
  )
}
function RecoveryScreen({ mode, t, onDone, onSignOut }: {
  mode: 'recovery' | 'invite'
  t: T
  onDone: () => void
  onSignOut: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) { notify(t('passwordMismatch')); return }
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { notify(error.message); return }
    try { window.history.replaceState(null, '', window.location.pathname) } catch { /* optional */ }
    notify(t('passwordUpdated'))
    onDone()
  }

  return (
    <div className="login-wrap">
      <section className="login-card">
        <div className="login-brand">
          <img src="/icons/brand-emblem.png" alt="T" className="brand-mark big" style={{objectFit:"cover",padding:0}} />
          <h1 className="app-name">
            <span className="arabic">{t('app')}</span>
            <span className="latin">{t('subtitle')}</span>
          </h1>
        </div>
        <h2>{t(mode === 'invite' ? 'setPasswordTitle' : 'resetPasswordTitle')}</h2>
        <form onSubmit={submit}>
          <label>
            {t('newPassword')}
            <input type="password" autoComplete="new-password" minLength={6} required
              value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            {t('confirmPassword')}
            <input type="password" autoComplete="new-password" minLength={6} required
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </label>
          <button className="primary full" disabled={busy}>{busy ? t('loading') : t('updatePassword')}</button>
          <button type="button" className="secondary full" onClick={onSignOut}>{t('logout')}</button>
        </form>
      </section>
    </div>
  )
}

function Login({ lang, setLang, t, notice }: {
  lang: Lang
  setLang: (v: Lang) => void
  t: T
  notice?: string
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [mode, setMode] = useState<'login' | 'reset'>('login')
  const [resetBusy, setResetBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!isConfigured) { setError(t('configMissing')); return }
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (authError) setError(authError.message)
    setLoading(false)
  }

  async function sendReset(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) { notify(t('resetEmailFirst')); return }
    setResetBusy(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    setResetBusy(false)
    if (resetError) { notify(resetError.message); return }
    notify(t('resetSent'))
    setMode('login')
  }

  return (
    <div className="login-wrap">
      <div className="login-stage">
        <aside className="login-aside" aria-hidden="true">
          <div className="login-aside-emblem">
            <img src="/icons/brand-emblem.png" alt="" />
          </div>
          <span className="eyebrow">{t('app')}</span>
          <h1>{t('heroTitle')}</h1>
          <p>{t('heroBody')}</p>
          <div className="login-aside-rule" />
          <small>{t('subtitle')}</small>
        </aside>
        <section className="login-card">
          <div className="login-brand">
            <img src="/icons/brand-emblem.png" alt="THE TRAINERS" className="brand-mark big" />
            <h1 className="app-name">
              <span className="arabic">{t('app')}</span>
              <span className="latin">{t('subtitle')}</span>
            </h1>
          </div>
          <div className="login-lang">
            <Languages size={16} />
            <select aria-label={t('language')} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              <option value="ar">العربية</option>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </div>
          <h2>{mode === 'login' ? t('welcome') : t('forgotPassword')}</h2>
          {notice && <div className="error-box" role="alert">{notice}</div>}
          {mode === 'login' ? (
            <form onSubmit={submit}>
              <label>
                {t('email')}
                <input type="email" autoComplete="username" required value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              </label>
              <label>
                {t('password')}
                <input type="password" autoComplete="current-password" required value={password}
                  onChange={(e) => setPassword(e.target.value)} />
              </label>
              {error && <div className="error-box">{error}</div>}
              <button className="primary full" disabled={loading}>{loading ? t('loading') : t('login')}</button>
              <button type="button" className="secondary full" onClick={() => { setError(''); setMode('reset') }}>
                {t('forgotPassword')}
              </button>
            </form>
          ) : (
            <form onSubmit={sendReset}>
              <p className="muted">{t('resetEmailFirst')}</p>
              <label>
                {t('email')}
                <input type="email" autoComplete="email" required value={email}
                  onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
              </label>
              <button className="primary full" disabled={resetBusy}>
                {resetBusy ? t('sendingReset') : t('forgotPassword')}
              </button>
              <button type="button" className="secondary full" onClick={() => setMode('login')}>
                {t('cancel')}
              </button>
            </form>
          )}
          <small className="secure-note"><ShieldCheck size={14} /> {t('secureAccess')}</small>
        </section>
      </div>
    </div>
  )
}

type FunctionPayload = {
  error?: string
  ok?: boolean
  already_accepted?: boolean
  attempts_remaining?: number
  message?: string
  existing_account?: boolean
  account_status?: string
}

/**
 * `functions.invoke` exposes a non-2xx body through `error.context`. The body
 * carries a stable error code; provider/database messages are never shown.
 */
async function functionErrorCode(error: unknown): Promise<string> {
  const name = (error as { name?: unknown } | null)?.name
  const message = (error as { message?: unknown } | null)?.message
  // supabase-js throws FunctionsFetchError when fetch itself fails (missing
  // deployment, DNS/CORS, offline). That is not an HTTP application error.
  if (name === 'FunctionsFetchError'
    || (typeof message === 'string' && /failed to send a request to the edge function/i.test(message))) {
    return 'edge_unreachable'
  }
  const context = (error as { context?: { json?: () => Promise<unknown> } } | null)?.context
  if (!context?.json) return ''
  try {
    const body = await context.json()
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      return (body as { error: string }).error
    }
  } catch {
    // The response body may be empty or already consumed.
  }
  return ''
}

function inviteErrorMessage(code: string, t: T): string {
  switch (code) {
    case 'edge_unreachable':
      return t('edgeUnreachable')
    case 'duplicate_pending_invitation':
      return t('duplicateInvitation')
    case 'email_only':
      return t('invitationEmailOnly')
    case 'invalid_email':
    case 'invalid_full_name':
      return t('invalidInviteDetails')
    case 'invitation_email_failed':
    case 'invitation_create_failed':
    case 'invitation_lookup_failed':
      return t('inviteDeliveryFailed')
    case 'rate_limited':
      return t('tooManyRequests')
    case 'institution_inactive':
      return t('inactive')
    case 'institution_required':
    case 'institution_not_found':
      return t('institutionRequired')
    case 'active_profile_required':
    case 'insufficient_role':
    case 'role_not_allowed':
    case 'self_invitation_forbidden':
    case 'institution_forbidden':
      return t('noPermission')
    case 'different_institution':
      return t('invitationDifferentInstitution')
    case 'account_suspended':
      return t('suspendedMsg')
    default:
      return t('errorGeneric')
  }
}

function inviteSuccessMessage(payload: FunctionPayload | null, t: T): string {
  if (payload?.message === 'existing_account_sign_in') return t('inviteExistingActive')
  if (payload?.message === 'existing_account_pending') return t('inviteExistingPending')
  return t('inviteCreated')
}

function reviewErrorMessage(code: string, t: T): string {
  switch (code) {
    case 'authentication_required':
    case 'active_profile_required':
    case 'insufficient_permission':
    case 'institution_forbidden':
    case 'self_review_forbidden':
    case 'owner_protected':
    case 'owner_role_forbidden':
    case 'target_role_forbidden':
    case 'role_change_forbidden':
    case 'profile_field_forbidden':
      return t('noPermission')
    case 'institution_required':
    case 'institution_not_found':
      return t('institutionRequired')
    case 'profile_not_found':
      return t('loadingError')
    case 'invalid_transition':
    case 'invalid_action':
      return t('reviewFailed')
    default:
      return t('errorGeneric')
  }
}

async function reviewAccount(
  profileId: string,
  action: 'approve' | 'reject' | 'suspend' | 'reactivate' | 'update',
  options: {
    role?: AccountRole
    institutionId?: string | null
    fullName?: string | null
    reason?: string | null
  } = {},
): Promise<{ ok: boolean; error?: string; account_status?: string } | null> {
  const { data, error } = await supabase.rpc('review_account', {
    p_profile_id: profileId,
    p_action: action,
    p_role: options.role ?? null,
    p_institution_id: options.institutionId ?? null,
    p_full_name: options.fullName ?? null,
    p_reason: options.reason ?? null,
  })
  if (error) return { ok: false, error: error.message }
  const result = data as { ok?: boolean; error?: string; account_status?: string } | null
  if (!result) return { ok: false, error: 'empty_response' }
  return { ok: result.ok === true, error: result.error, account_status: result.account_status }
}

function invitationAcceptError(raw: string, t: T): string {
  const code = raw.toLowerCase()
  if (code.includes('expired')) return t('invitationExpired')
  if (code.includes('recipient_mismatch') || code.includes('email_required')) return t('invitationRecipientMismatch')
  if (code.includes('different_institution')) return t('invitationDifferentInstitution')
  if (code.includes('account_suspended')) return t('suspendedMsg')
  if (code.includes('not_pending') || code.includes('not_found') || code.includes('already')) {
    return t('invitationAlreadyHandled')
  }
  return t('invitationAcceptFailed')
}

/**
 * The invitee accepts the live invitation that belongs to their own signed-in
 * email. `my_pending_invitation()` can only return the caller's row and
 * `accept_email_invitation()` performs every server-side check. A valid
 * invitation acceptance activates the account without a second admin review.
 */
function EmailInvitationPanel({ t, onAccepted }: { t: T; onAccepted: () => void }) {
  const [invitation, setInvitation] = useState<PendingInvitation | null>(null)
  const [checking, setChecking] = useState(true)
  const [checkError, setCheckError] = useState(false)
  const [accepting, setAccepting] = useState(false)
  const [accepted, setAccepted] = useState(false)

  useEffect(() => {
    if (!isConfigured) { setChecking(false); return }
    let alive = true
    setChecking(true)
    setCheckError(false)
    supabase.rpc('my_pending_invitation').then(({ data, error }) => {
      if (!alive) return
      if (error) setCheckError(true)
      else setInvitation((data as PendingInvitation | null) ?? null)
      setChecking(false)
    })
    return () => { alive = false }
  }, [])

  async function accept() {
    if (!invitation || accepting) return
    if (!isConfigured) { notify(t('configMissing')); return }
    setAccepting(true)
    const { data, error } = await supabase.rpc('accept_email_invitation', {
      p_invitation_id: invitation.id,
    })
    setAccepting(false)
    const result = data as { ok?: boolean; error?: string } | null
    if (error || result?.ok === false) {
      notify(invitationAcceptError(result?.error || error?.message || '', t))
      return
    }
    setAccepted(true)
    setInvitation(null)
    notify(t('invitationAcceptedOk'))
    onAccepted()
  }

  if (accepted) {
    return (
      <div className="invite-state success" role="status">
        <span className="invite-state-icon"><Check size={22} /></span>
        <div>
          <b>{t('invitationAcceptedOk')}</b>
          <p className="muted">{t('invitationNoActivation')}</p>
        </div>
      </div>
    )
  }

  if (checking) {
    return <div className="invite-state"><span className="invite-state-icon"><ShieldCheck size={20} /></span><p className="muted">{t('loading')}</p></div>
  }

  if (checkError) {
    return (
      <div className="invite-state" role="alert">
        <span className="invite-state-icon"><ShieldCheck size={20} /></span>
        <div><b>{t('edgeUnreachable')}</b><p className="muted">{t('invitationRetryHint')}</p></div>
      </div>
    )
  }

  if (!invitation) {
    return (
      <div className="invite-state">
        <span className="invite-state-icon"><ShieldCheck size={20} /></span>
        <div>
          <b>{t('noLiveInvitation')}</b>
          <p className="muted">{t('invitationSignInHint')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="invite-card">
      <div className="invite-card-head">
        <span className="invite-seal"><ShieldCheck size={21} /></span>
        <div className="grow">
          <span className="eyebrow">{t('pendingInvitation')}</span>
          <h3>{t(invitation.role)}</h3>
        </div>
        <span className="pill warning">{t('pending')}</span>
      </div>
      <dl className="invite-meta">
        <div>
          <dt>{t('institution')}</dt>
          <dd>{invitation.institution_name || '—'}</dd>
        </div>
        <div>
          <dt>{t('email')}</dt>
          <dd dir="ltr">{invitation.invited_email || '—'}</dd>
        </div>
        <div>
          <dt>{t('expiresAt')}</dt>
          <dd>{invitation.expires_at ? formatDateTime(invitation.expires_at) : '—'}</dd>
        </div>
      </dl>
      <p className="muted">{t('invitationAcceptHint')}</p>
      <button className="primary full" onClick={() => { void accept() }} disabled={accepting}>
        {accepting ? t('acceptingInvitation') : t('acceptInvitationAction')}
      </button>
      <small className="secure-note"><ShieldCheck size={14} /> {t('invitationNoActivation')}</small>
    </div>
  )
}

function GateScreen({ state, t, onRetry, onSignOut, onAccepted, notice }: {
  state: GateState
  t: T
  onRetry: () => void
  onSignOut: () => void
  onAccepted: () => void
  notice?: string
}) {
  const canAccept = state === 'pending' || state === 'missing'
  return (
    <div className="login-wrap">
      <div className="login-stage gate-stage">
        <section className="login-card gate-card">
          <div className="login-brand">
            <img src="/icons/brand-emblem.png" alt="THE TRAINERS" className="brand-mark big" />
            <h1 className="app-name">
              <span className="arabic">{t('app')}</span>
              <span className="latin">{t('subtitle')}</span>
            </h1>
          </div>
          <h2>{t(gateTitleKey(state))}</h2>
          <p className="muted">{t(gateBodyKey(state))}</p>
          {notice && <div className="error-box" role="alert">{notice}</div>}
          {canAccept && <EmailInvitationPanel key={state} t={t} onAccepted={onAccepted} />}
          {gateAllowsRetry(state) && (
            <button className="primary full" onClick={onRetry}>{t('retry')}</button>
          )}
          <button className="secondary full" onClick={onSignOut}>{t('logout')}</button>
        </section>
      </div>
    </div>
  )
}

function AcceptInvitation({ t, profile, onAccepted }: {
  t: T
  profile: Profile
  onAccepted: () => void
}) {
  return (
    <>
      <Heading title={t('acceptInvitationTitle')} subtitle={t('acceptInvitationHint')} />
      <section className="panel invite-page">
        <div className="invite-signed-in">
          <span className="eyebrow">{t('signedInAs')}</span>
          <b dir="ltr">{profile.email}</b>
        </div>
        <EmailInvitationPanel t={t} onAccepted={onAccepted} />
      </section>
    </>
  )
}

function Heading({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="page-heading">
      <div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>
      {action}
    </div>
  )
}

function Empty({ t }: { t: T }) {
  return <div className="empty"><div className="empty-icon"><Activity /></div><p>{t('noData')}</p></div>
}

function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-icon"><Icon size={20} /></div>
      <div><strong>{value}</strong><small>{label}</small></div>
    </div>
  )
}

function Denied({ t }: { t: T }) {
  return <section className="panel"><ShieldCheck /><h2>{t('noPermission')}</h2></section>
}

function NotFound({ t }: { t: T }) {
  const nav = useNavigate()
  return (
    <section className="panel">
      <h2>{t('notFoundTitle')}</h2>
      <p className="muted">{t('notFoundBody')}</p>
      <button className="primary" onClick={() => nav('/')}>{t('backHome')}</button>
    </section>
  )
}
function Dashboard({ profile, t }: { profile: Profile; t: T }) {
  const navigate = useNavigate()
  const [stats, setStats] = useState({ students: 0, reports: 0, notices: 0, team: 0 })
  const [recent, setRecent] = useState<ReportRow[]>([])
  const [errorKey, setErrorKey] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    async function run() {
      if (!isConfigured) { setLoading(false); return }
      if (profile.role === 'owner') {
        const [institutionsRes, activeAccountsRes, pendingAccountsRes] = await Promise.all([
          supabase.from('institutions').select('id', { count: 'exact', head: true }),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('account_status', 'active'),
          supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('account_status', 'pending'),
        ])
        if (!alive) return
        if (institutionsRes.error || activeAccountsRes.error || pendingAccountsRes.error) setErrorKey('loadingError')
        else setErrorKey('')
        setStats({ students: institutionsRes.count ?? 0, reports: activeAccountsRes.count ?? 0, notices: pendingAccountsRes.count ?? 0, team: 0 })
        setRecent([])
        setLoading(false)
        return
      }
      const scoped = <Q,>(query: Q): Q => {
        if (!profile.institution_id) return query
        return (query as unknown as { eq: (column: string, value: string) => Q }).eq('institution_id', profile.institution_id)
      }
      const [studentsRes, reportsRes, noticesRes, teamRes] = await Promise.all([
        scoped(supabase.from('students').select('id', { count: 'exact', head: true })),
        scoped(supabase.from('daily_reports').select('id', { count: 'exact', head: true })),
        scoped(supabase.from('admin_notices').select('id', { count: 'exact', head: true })),
        scoped(supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('account_status', 'active')),
      ])
      if (!alive) return
      if (studentsRes.error || reportsRes.error || noticesRes.error || teamRes.error) {
        setErrorKey('loadingError')
      } else {
        setErrorKey('')
      }
      setStats({
        students: studentsRes.count ?? 0,
        reports: reportsRes.count ?? 0,
        notices: noticesRes.count ?? 0,
        team: teamRes.count ?? 0,
      })
      let recentQuery = supabase.from('daily_reports').select('*').order('created_at', { ascending: false }).limit(5)
      if (profile.role === 'coach') recentQuery = recentQuery.eq('coach_id', profile.id)
      if (profile.institution_id) recentQuery = recentQuery.eq('institution_id', profile.institution_id)
      const { data } = await recentQuery
      if (alive) setRecent((data ?? []) as ReportRow[])
      setLoading(false)
    }
    void run()
    return () => { alive = false }
  }, [profile.id, profile.role, profile.institution_id])



  return (
    <>
      <section className="hero-panel">
        <div className="hero-emblem"><img src="/icons/brand-emblem.png" alt="" /></div>
        <div className="hero-copy">
          <span className="eyebrow">{t('subtitle')}</span>
          <h1>{t('welcome')}{profile.full_name ? `، ${profile.full_name}` : ''}</h1>
          <p className="hero-body">{t(profile.role === 'owner' ? 'ownerHeroBody' : 'heroBody')}</p>
        </div>
        <div className="hero-tags">
          <span className="pill success">{roleLabel(profile.role, t)}</span>
          <span className={`pill ${profile.account_status === 'active' ? 'success' : 'warning'}`}>
            {t(profile.account_status || 'pending')}
          </span>
        </div>
      </section>
      {profile.role !== 'owner' && <PendingInvitationNotice t={t} />}
      {errorKey && <div className="error-box">{t(errorKey)}</div>}
      {profile.role !== 'owner' && <section className="quick-links" aria-label={t('home')}>
        <button className="quick-link" onClick={() => navigate('/attendance')}><CalendarDays size={18}/><span>{t('attendance')}</span></button>
        <button className="quick-link" onClick={() => navigate('/daily-status')}><Activity size={18}/><span>{t('dailyStatus')}</span></button>
        <button className="quick-link" onClick={() => navigate('/reports')}><ClipboardList size={18}/><span>{t('reports')}</span></button>
        <button className="quick-link" onClick={() => navigate('/students')}><Users size={18}/><span>{t('students')}</span></button>
        <button className="quick-link" onClick={() => navigate('/management-reports')}><FileText size={18}/><span>{t('managementReports')}</span></button>
        <button className="quick-link" onClick={() => navigate('/notices')}><Bell size={18}/><span>{t('notices')}</span></button>
      </section>}
      <div className="stats-grid">
        {profile.role === 'owner' ? <>
          <Stat icon={Building2} label={t('statsInstitutions')} value={stats.students} />
          <Stat icon={Users} label={t('statsActiveAccounts')} value={stats.reports} />
          <Stat icon={UserPlus} label={t('statsPendingAccounts')} value={stats.notices} />
        </> : <>
          <Stat icon={Users} label={t('statsStudents')} value={stats.students} />
          <Stat icon={ClipboardList} label={t('statsReports')} value={stats.reports} />
          <Stat icon={Bell} label={t('statsNotices')} value={stats.notices} />
          {profile.role !== 'coach' && <Stat icon={UserPlus} label={t('statsTeam')} value={stats.team} />}
        </>}
      </div>
      {profile.role === 'coach' && <ShiftCard profile={profile} t={t} />}
      {profile.role !== 'owner' && <section className="panel">
        <div className="panel-head"><h3>{t('reports')}</h3><span className="muted">{t('today')}</span></div>
        {loading ? <Empty t={t} /> : recent.length === 0 ? <Empty t={t} /> : (
          <div className="report-list">
            {recent.map((r) => (
              <div className="report-row" key={r.id}>
                <div className="report-icon"><ClipboardList size={18} /></div>
                <div className="grow"><b>{r.coach_name_snapshot}</b><small>{r.report_date}</small></div>
                <span className={`pill ${r.status === 'reviewed' ? 'success' : r.is_finalized ? 'success' : 'warning'}`}>
                  {r.status === 'reviewed' ? t('reviewed') : r.is_finalized ? t('finalized') : t('draft')}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>}
    </>
  )
}

/** A quiet dashboard banner when the signed-in person still has a live invitation. */
function PendingInvitationNotice({ t }: { t: T }) {
  const [invitation, setInvitation] = useState<PendingInvitation | null>(null)

  useEffect(() => {
    if (!isConfigured) return
    let alive = true
    supabase.rpc('my_pending_invitation').then(({ data }) => {
      if (alive) setInvitation((data as PendingInvitation | null) ?? null)
    })
    return () => { alive = false }
  }, [])

  if (!invitation) return null

  return (
    <NavLink className="pending-invite-banner" to="/accept-invitation">
      <span className="pending-invite-icon"><ShieldCheck size={20} /></span>
      <span className="grow">
        <b>{t('pendingInvitationNotice')}</b>
        <small>{t(invitation.role)}{invitation.institution_name ? ` · ${invitation.institution_name}` : ''}</small>
      </span>
      <span className="pill warning">{t('reviewPendingInvitation')}</span>
      <ChevronLeft size={18} className="nav-arrow" />
    </NavLink>
  )
}

function ShiftCard({ profile, t }: { profile: Profile; t: T }) {
  const [active, setActive] = useState<{ id: string; started_at: string } | null>(null)
  const [loading, setLoading] = useState(false)

  async function refresh() {
    if (!isConfigured) return
    const { data } = await supabase
      .from('coach_shifts')
      .select('id,started_at')
      .eq('coach_id', profile.id)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    setActive((data as { id: string; started_at: string } | null) ?? null)
  }

  useEffect(() => { void refresh() }, [profile.id])

  async function toggle() {
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!active && !profile.institution_id) { notify(t('noPermission')); return }
    setLoading(true)
    const result = active
      ? await supabase.from('coach_shifts').update({ ended_at: new Date().toISOString() }).eq('id', active.id)
      : await supabase.from('coach_shifts').insert({ coach_id: profile.id, institution_id: profile.institution_id })
    if (result.error) notify(result.error.message)
    else notify(t('savedOk'))
    await refresh()
    setLoading(false)
  }

  return (
    <section className="shift-card">
      <div>
        <span className="eyebrow">{active ? t('shiftActive') : t('shiftInactive')}</span>
        <h3>{active ? formatTime(active.started_at) : t('shiftInactive')}</h3>
      </div>
      <button className={active ? 'danger' : 'primary'} disabled={loading} onClick={toggle}>
        {active ? t('finish') : t('start')}
      </button>
    </section>
  )
}
type StudentNote = {
  id: string
  body: string
  note_type: string
  created_at: string
  author_id: string
  follow_up_status?: string
}

function Students({ profile, t }: { profile: Profile; t: T }) {
  const [items, setItems] = useState<Student[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [editing, setEditing] = useState<Student | null>(null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [birth, setBirth] = useState('')
  const [classId, setClassId] = useState('')
  const [classes, setClasses] = useState<{ id: string; name: string; academic_year: string | null }[]>([])
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkFileName, setBulkFileName] = useState('')
  const [bulkReadStatus, setBulkReadStatus] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [busy, setBusy] = useState(false)
  const [noteStudent, setNoteStudent] = useState<Student | null>(null)
  const [noteItems, setNoteItems] = useState<StudentNote[]>([])
  const [note, setNote] = useState('')
  const canManage = ['owner', 'manager', 'admin'].includes(profile.role) && Boolean(profile.institution_id)

  async function load() {
    setLoading(true)
    if (!isConfigured) { setLoading(false); return }
    let query = supabase
      .from('students')
      .select('id,student_code,full_name,is_active,class_id,date_of_birth')
      .order('full_name')
    if (profile.institution_id) query = query.eq('institution_id', profile.institution_id)
    const [studentsRes, classRes] = await Promise.all([
      query,
      profile.institution_id
        ? supabase.from('classes').select('id,name,academic_year').eq('institution_id', profile.institution_id).order('name')
        : Promise.resolve({ data: [], error: null }),
    ])
    if (studentsRes.error) notify(studentsRes.error.message)
    if (classRes.error) notify(classRes.error.message)
    setItems((studentsRes.data ?? []) as Student[])
    setClasses((classRes.data ?? []) as { id: string; name: string; academic_year: string | null }[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.id, profile.institution_id])

  const filtered = useMemo(
    () => items.filter((s) => `${s.full_name} ${s.student_code}`.toLowerCase().includes(search.toLowerCase())),
    [items, search],
  )
  const existingCodes = useMemo(() => new Set(items.map((s) => s.student_code.toLowerCase())), [items])
  const parsed = useMemo(() => parseStudentImportText(bulkText), [bulkText])
  const importPlan = useMemo(() => {
    const seen = new Set<string>()
    const valid: { student_code: string; full_name: string }[] = []
    let duplicates = 0
    for (const row of parsed) {
      const key = row.student_code.toLowerCase()
      if (!key || seen.has(key) || existingCodes.has(key)) { duplicates++; continue }
      seen.add(key)
      valid.push(row)
    }
    return { valid, duplicates }
  }, [parsed, existingCodes])

  function openAdd() {
    setEditing(null); setCode(''); setName(''); setBirth(''); setClassId(''); setShow(true)
  }

  function openEdit(student: Student) {
    setEditing(student)
    setCode(student.student_code)
    setName(student.full_name)
    setBirth(student.date_of_birth || '')
    setClassId(student.class_id || '')
    setShow(true)
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!canManage) { notify(t('noPermission')); return }
    const payload = {
      student_code: code.trim(),
      full_name: name.trim(),
      date_of_birth: birth || null,
      class_id: classId || null,
    }
    const result = editing
      ? await supabase.from('students').update(payload).eq('id', editing.id).eq('institution_id', profile.institution_id).select('id')
      : await supabase.from('students').insert({ ...payload, institution_id: profile.institution_id }).select('id')
    if (result.error) { notify(result.error.message); return }
    if (!affectedRows(result.data as { id: string }[] | null)) { notify(t('studentSaveFailed')); return }
    setShow(false)
    notify(t('savedOk'))
    await load()
  }

  async function toggleActive(student: Student) {
    if (!canManage) { notify(t('noPermission')); return }
    if (!window.confirm(t(student.is_active ? 'confirmDeactivateStudent' : 'confirmActivateStudent'))) return
    const { data, error } = await supabase.from('students').update({ is_active: !student.is_active }).eq('id', student.id).select('id')
    if (error) { notify(error.message); return }
    if (!affectedRows(data)) { notify(t('noPermission')); return }
    await load()
  }

  async function openNotes(student: Student) {
    setNoteStudent(student)
    setNote('')
    if (!isConfigured) { setNoteItems([]); return }
    const { data, error } = await supabase
      .from('student_notes')
      .select('id,body,note_type,created_at,author_id,follow_up_status')
      .eq('student_id', student.id)
      .order('created_at', { ascending: false })
    if (error) notify(error.message)
    setNoteItems((data ?? []) as StudentNote[])
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault()
    if (!noteStudent || !note.trim()) return
    const { error } = await supabase.from('student_notes').insert({
      institution_id: profile.institution_id,
      student_id: noteStudent.id,
      author_id: profile.id,
      body: note.trim(),
      note_type: 'general',
      follow_up_status: 'none',
    })
    if (error) { notify(error.message); return }
    notify(t('savedOk'))
    await openNotes(noteStudent)
  }

  async function updateNoteStatus(noteId: string, newStatus: string) {
    if (!isConfigured) { notify(t('configMissing')); return }
    setBusy(true)
    const { data, error } = await supabase
      .from('student_notes')
      .update({ follow_up_status: newStatus })
      .eq('id', noteId)
      .select('id')
    setBusy(false)
    if (error) { notify(error.message); return }
    if (!affectedRows(data)) { notify(t('noteUpdateFailed')); return }
    notify(t('savedOk'))
    if (noteStudent) await openNotes(noteStudent)
  }

  async function importBulk() {
    if (!importPlan.valid.length) {
      notify(t(parsed.length ? 'allCodesExist' : 'noValidRows'))
      return
    }
    if (!profile.institution_id) { notify(t('noPermission')); return }
    setBulkBusy(true)
    const rows = importPlan.valid.map((row) => ({ ...row, institution_id: profile.institution_id }))
    const { error } = await supabase.from('students').insert(rows)
    setBulkBusy(false)
    if (error) { notify(`${t('importFailed')}: ${error.message}`); return }
    notify(`${t('importDone')} (${rows.length})`)
    setBulkText('')
    setBulkOpen(false)
    await load()
  }

  async function readImportFile(file: File | null) {
    if (!file) return
    setBulkFileName(file.name)
    setBulkReadStatus(t('readingImportFile'))
    try {
      const name = file.name.toLowerCase()
      if (name.endsWith('.xlsx')) {
        // `read-excel-file` is a small, actively maintained parser. The previous
        // SheetJS build (xlsx@0.18.5) carried an unfixed prototype-pollution
        // advisory, so it was removed from the dependency set.
        const { readSheet } = await import('read-excel-file/browser')
        const rows = await readSheet(file)
        const text = rows.map((row) => row.map((cell) => {
          if (cell instanceof Date) return cell.toISOString().slice(0, 10)
          return String(cell ?? '')
        }).join('\t')).join('\n')
        setBulkText(text)
        setBulkReadStatus(parseStudentImportText(text).length ? t('importFileRead') : t('importFileNoRows'))
        return
      }
      if (name.endsWith('.xls')) {
        setBulkReadStatus(t('importXlsUnsupported'))
        notify(t('importXlsUnsupported'))
        return
      }
      const text = await file.text()
      setBulkText(text)
      setBulkReadStatus(parseStudentImportText(text).length ? t('importFileRead') : t('importFileNoRows'))
    } catch {
      setBulkReadStatus(t('importFailed'))
      notify(t('importFailed'))
    }
  }
  return (
    <>
      <Heading
        title={t('students')}
        action={canManage && (
          <div className="heading-actions">
            <button className="secondary action-btn" onClick={() => { setBulkFileName(''); setBulkReadStatus(''); setBulkText(''); setBulkOpen(true) }}>
              <FileUp size={17} /> {t('importExcel')}
            </button>
            <button className="primary action-btn" onClick={openAdd}>
              <Plus size={18} /> {t('add')}
            </button>
          </div>
        )}
      />
      <div className="searchbar">
        <Search size={18} />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')} />
      </div>
      {loading ? <Empty t={t} /> : filtered.length === 0 ? <Empty t={t} /> : (
        <section className="panel student-list">
          {filtered.map((student) => (
            <div className="student-row" key={student.id}>
              <div className="avatar student-avatar"><GraduationCap size={19} /></div>
              <div className="grow"><b>{student.full_name}</b><small>#{student.student_code}{student.class_id ? ` · ${classes.find((item) => item.id === student.class_id)?.name ?? ''}` : ''}</small></div>
              <span className={`pill ${student.is_active ? 'success' : 'warning'}`}>
                {student.is_active ? t('active') : t('inactive')}
              </span>
              <button className="icon-btn row-action" title={t('studentNotes')} onClick={() => openNotes(student)}>
                <NotebookPen size={16} />
              </button>
              {canManage && (
                <>
                  <button className="icon-btn row-action" title={t('edit')} onClick={() => openEdit(student)}>
                    <Pencil size={16} />
                  </button>
                  <button className="icon-btn row-action" title={student.is_active ? t('archive') : t('activate')} onClick={() => toggleActive(student)}>
                    <Archive size={16} />
                  </button>
                </>
              )}
            </div>
          ))}
        </section>
      )}

      {show && (
        <Modal title={editing ? t('students') : t('studentAdd')} close={() => setShow(false)} closeLabel={t('close')}>
          <form onSubmit={save}>
            <label>{t('code')}<input required value={code} onChange={(e) => setCode(e.target.value)} /></label>
            <label>{t('name')}<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label>{t('date')}<input type="date" value={birth} onChange={(e) => setBirth(e.target.value)} /></label>
            <label>{t('class')}
              <select value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">—</option>
                {classes.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}{item.academic_year ? ` · ${item.academic_year}` : ''}</option>
                ))}
              </select>
            </label>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setShow(false)}>{t('cancel')}</button>
              <button className="primary">{t('save')}</button>
            </div>
          </form>
        </Modal>
      )}

      {bulkOpen && (
        <Modal title={t('importTitle')} close={() => setBulkOpen(false)} closeLabel={t('close')}>
          <p className="muted">{t('importHint')}</p>
          <label>{t('importExcel')}
            <input type="file" accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/octet-stream,*/*"
              onChange={(e) => { const selected = e.currentTarget.files?.[0] ?? null; void readImportFile(selected); e.currentTarget.value = '' }} />
          </label>
          {bulkFileName && <div className="notice-box"><b>{bulkFileName}</b><div>{bulkReadStatus || t('readingImportFile')}</div></div>}
          <label>{t('importPreview')}
            <textarea rows={4} value={bulkText} onChange={(e) => setBulkText(e.target.value)}
              placeholder={'student_code,full_name\n001,محمد علي\n002,سارة أحمد'} />
          </label>
          <p className="muted">{t('importCodeTextHint')}</p>
          <div className="bulk-preview">
            <div className="import-preview-summary">
              <b>{t('previewValid')}: {importPlan.valid.length}</b>
              <span>{t('importDup')}: {importPlan.duplicates}</span>
            </div>
            {importPlan.valid.length > 0 && (
              <div className="table-wrap import-preview-table">
                <table>
                  <thead><tr><th>{t('code')}</th><th>{t('name')}</th></tr></thead>
                  <tbody>{importPlan.valid.map((row, index) => (
                    <tr key={`${row.student_code}-${index}`}><td>{row.student_code}</td><td>{row.full_name}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            )}
            {importPlan.valid.length === 0 && parsed.length > 0 && (
              <div className="muted">{importPlan.duplicates ? t('allCodesExist') : t('noValidRows')}</div>
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => setBulkOpen(false)}>{t('cancel')}</button>
            <button className="primary" disabled={bulkBusy || !importPlan.valid.length} onClick={importBulk}>
              {bulkBusy ? t('importing') : t('confirmImport')}
            </button>
          </div>
        </Modal>
      )}

      {noteStudent && (
        <Modal title={`${t('studentNotes')} · ${noteStudent.full_name}`} close={() => setNoteStudent(null)} closeLabel={t('close')}>
          <form onSubmit={saveNote}>
            <label>{t('notes')}
              <DictateButton t={t} onText={setNote} />
              <textarea required rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            <button className="primary">{t('addNote')}</button>
          </form>
          {noteItems.map((item) => (
            <article className="notice note-item" key={item.id}>
              <p>{item.body}</p>
              <small>
                {formatDateTime(item.created_at)} · {t(item.note_type)}
                {item.follow_up_status && (
                  <span className="pill">
                    {item.follow_up_status === 'done' ? t('markHandled') : item.follow_up_status === 'open' ? t('followUpOpen') : t('followUpNone')}
                  </span>
                )}
                {['manager', 'admin'].includes(profile.role) && (
                  <span className="action-btns">
                    <button type="button" className="secondary small" disabled={busy || item.follow_up_status === 'open'} onClick={() => { void updateNoteStatus(item.id, 'open') }}>{t('markFollowUpOpen')}</button>
                    <button type="button" className="secondary small" disabled={busy || item.follow_up_status === 'done'} onClick={() => { void updateNoteStatus(item.id, 'done') }}>{t('markFollowUpDone')}</button>
                    {item.follow_up_status !== 'none' && <button type="button" className="secondary small" disabled={busy} onClick={() => { void updateNoteStatus(item.id, 'none') }}>{t('followUpNone')}</button>}
                  </span>
                )}
              </small>
            </article>
          ))}
        </Modal>
      )}
    </>
  )
}
function Attendance({ profile, t }: { profile: Profile; t: T }) {
  const [students, setStudents] = useState<Student[]>([])
  const [status, setStatus] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [timings, setTimings] = useState<Record<string, { start_at: string; end_at: string; notified_at: string; actual_return_at: string; duty_completed_at: string }>>({})
  const [date, setDate] = useState(localDate())
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sessionKey, setSessionKey] = useState(NO_SESSION)
  const [coachId, setCoachId] = useState(profile.id)
  const [coaches, setCoaches] = useState<{ id: string; full_name: string; role: string }[]>([])
  const [sessionOptions, setSessionOptions] = useState<{ id: string; started_at: string; ended_at: string | null }[]>([])
  const [queuedCount, setQueuedCount] = useState(0)

  function toDateTimeInput(value?: string | null) {
    if (!value) return ''
    const d = new Date(value)
    if (Number.isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  async function refreshQueueCount() {
    if (!profile.institution_id) return setQueuedCount(0)
    try { setQueuedCount((await listQueuedAttendance(profile.institution_id)).length) } catch { setQueuedCount(0) }
  }

  async function syncQueuedAttendance() {
    if (!navigator.onLine || !profile.institution_id || !isConfigured) return
    let queued
    try { queued = await listQueuedAttendance(profile.institution_id) } catch { return }
    for (const entry of queued) {
      const result = await saveAttendance(entry.rows, entry.coach_id, entry.session_key)
      if (!result.error) await removeQueuedAttendance(entry.id)
      else await updateQueuedAttendanceError(entry.id, result.error)
    }
    await refreshQueueCount()
  }

  useEffect(() => {
    void refreshQueueCount()
    void syncQueuedAttendance()
    const onOnline = () => { void syncQueuedAttendance() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [profile.institution_id, profile.id])

  async function load() {
    setLoading(true)
    if (!isConfigured) { setLoading(false); return }
    const effectiveCoachId = coachId || profile.id
    let query = supabase.from('students').select('id,student_code,full_name').eq('is_active', true).order('student_code')
    if (profile.institution_id) query = query.eq('institution_id', profile.institution_id)
    const [studentsRes, attendance, coachRes, shiftsRes] = await Promise.all([
      query,
      loadAttendance(date, effectiveCoachId),
      profile.role !== 'coach' && profile.institution_id
        ? supabase
          .from('profiles')
          .select('id,full_name,role')
          .eq('institution_id', profile.institution_id)
          .eq('account_status', 'active')
          .in('role', ['coach', 'manager', 'admin'])
          .order('full_name')
        : Promise.resolve({ data: [], error: null }),
      navigator.onLine && profile.institution_id
        ? supabase.from('coach_shifts').select('id,started_at,ended_at').eq('coach_id', effectiveCoachId)
          .gte('started_at', new Date(`${date}T00:00:00`).toISOString())
          .lt('started_at', new Date(new Date(`${date}T00:00:00`).getTime() + 86400000).toISOString())
          .order('started_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])
    if (studentsRes.error && !navigator.onLine && profile.institution_id) {
      const cached = readAttendanceRoster(profile.institution_id)
      setStudents(cached.map(row => ({ ...row, is_active: true, institution_id: profile.institution_id! })))
    } else {
      if (studentsRes.error) notify(studentsRes.error.message)
      const roster = (studentsRes.data ?? []) as Student[]
      setStudents(roster)
      if (profile.institution_id) cacheAttendanceRoster(profile.institution_id, roster.map(row => ({ id: row.id, student_code: row.student_code, full_name: row.full_name })))
    }
    if (attendance.error && navigator.onLine) notify(attendance.error)
    if (coachRes.error && navigator.onLine) notify(coachRes.error.message)
    setCoaches(((coachRes.data ?? []) as { id: string; full_name: string; role: string }[]))
    const sessions = (shiftsRes.data ?? []) as { id: string; started_at: string; ended_at: string | null }[]
    setSessionOptions(sessions)
    const cachedSession = profile.institution_id ? readAttendanceSession(profile.institution_id, effectiveCoachId, date) : null
    const resolvedSession = !navigator.onLine && cachedSession ? cachedSession : attendance.sessionKey
    if (profile.institution_id && navigator.onLine) cacheAttendanceSession(profile.institution_id, effectiveCoachId, date, attendance.sessionKey)
    if (!navigator.onLine && cachedSession && cachedSession !== NO_SESSION && !sessions.some((item) => item.id === cachedSession)) {
      setSessionOptions([{ id: cachedSession, started_at: new Date().toISOString(), ended_at: null }])
    }
    const offlineKey = `${profile.institution_id || 'none'}:${effectiveCoachId}:${date}:${resolvedSession}`
    let next: Record<string, string> = {}
    let why: Record<string, string> = {}
    let nextTimings: typeof timings = {}
    if (!navigator.onLine && profile.institution_id) {
      const cached = readAttendanceSnapshot(offlineKey)
      if (cached) { next = cached.status; why = cached.reasons }
      try {
        const queued = await getQueuedAttendance(`${profile.institution_id}:${effectiveCoachId}:${date}:${resolvedSession}`)
        for (const row of queued?.rows ?? []) { next[row.student_id] = row.status; why[row.student_id] = row.reason || ''; nextTimings[row.student_id] = { start_at: toDateTimeInput(row.start_at), end_at: toDateTimeInput(row.end_at), notified_at: toDateTimeInput(row.notified_at), actual_return_at: toDateTimeInput(row.actual_return_at), duty_completed_at: toDateTimeInput(row.duty_completed_at) } }
      } catch { /* queued rows remain stored; do not discard offline data */ }
    } else {
      for (const record of attendance.records) {
        next[record.student_id] = record.status
        why[record.student_id] = record.reason || ''
        nextTimings[record.student_id] = { start_at: toDateTimeInput(record.start_at), end_at: toDateTimeInput(record.end_at), notified_at: toDateTimeInput(record.notified_at), actual_return_at: toDateTimeInput(record.actual_return_at), duty_completed_at: toDateTimeInput(record.duty_completed_at) }
      }
      cacheAttendanceSnapshot(offlineKey, next, why)
    }
    setStatus(next)
    setReasons(why)
    setTimings(nextTimings)
    setSessionKey(resolvedSession)
    setLoading(false)
  }

  useEffect(() => { void load() }, [date, profile.id, profile.institution_id, coachId, profile.role])

  async function chooseSession(nextSessionKey: string) {
    setSessionKey(nextSessionKey)
    const effectiveCoachId = coachId || profile.id
    if (profile.institution_id) cacheAttendanceSession(profile.institution_id, effectiveCoachId, date, nextSessionKey)
    const offlineKey = `${profile.institution_id || 'none'}:${effectiveCoachId}:${date}:${nextSessionKey}`
    if (!navigator.onLine) {
      const cached = readAttendanceSnapshot(offlineKey)
      setStatus(cached?.status ?? {})
      setReasons(cached?.reasons ?? {})
      return
    }
    const result = await loadAttendance(date, effectiveCoachId, nextSessionKey)
    if (result.error) { notify(result.error); return }
    const next: Record<string, string> = {}
    const why: Record<string, string> = {}
    const nextTimings: typeof timings = {}
    for (const record of result.records) { next[record.student_id] = record.status; why[record.student_id] = record.reason || ''; nextTimings[record.student_id] = { start_at: toDateTimeInput(record.start_at), end_at: toDateTimeInput(record.end_at), notified_at: toDateTimeInput(record.notified_at), actual_return_at: toDateTimeInput(record.actual_return_at), duty_completed_at: toDateTimeInput(record.duty_completed_at) } }
    setStatus(next)
    setReasons(why)
    setTimings(nextTimings)
    cacheAttendanceSnapshot(offlineKey, next, why)
  }

  function mark(id: string, value: string) {
    setStatus((current) => ({ ...current, [id]: value }))
    if (value) setTimings(current => current[id]?.start_at ? current : ({ ...current, [id]: { start_at: toDateTimeInput(new Date().toISOString()), end_at: '', notified_at: '', actual_return_at: '', duty_completed_at: '' } }))
  }

  function updateTiming(id: string, key: keyof (typeof timings)[string], value: string) {
    setTimings(current => ({ ...current, [id]: { start_at: '', end_at: '', notified_at: '', actual_return_at: '', duty_completed_at: '', ...(current[id] || {}), [key]: value } }))
  }

  function markAllPresent() {
    const next: Record<string, string> = {}
    const now = toDateTimeInput(new Date().toISOString())
    const nextTimes: typeof timings = {}
    for (const student of students) { next[student.id] = 'present'; nextTimes[student.id] = { start_at: now, end_at: '', notified_at: '', actual_return_at: '', duty_completed_at: '' } }
    setStatus(next)
    setTimings(nextTimes)
  }

  function clearAll() {
    setStatus({})
    setReasons({})
    setTimings({})
  }

  async function save() {
    if (!isConfigured) { notify(t('configMissing')); return }
    const effectiveCoachId = coachId || profile.id
    if (profile.role !== 'coach' && !coaches.some((coach) => coach.id === effectiveCoachId)) {
      notify(t('selectCoach'))
      return
    }
    const rows = buildAttendanceRows(students, status, reasons, {
      institution_id: profile.institution_id,
      coach_id: effectiveCoachId,
      session_date: date,
    }).map(row => ({ ...row, ...(timings[row.student_id] ? Object.fromEntries(Object.entries(timings[row.student_id]).map(([key, value]) => [key, value ? new Date(value).toISOString() : null])) : {}) }))
    if (!rows.length) { notify(t('nothingRecorded')); return }
    // Only a coach owns a shift. Managers/admins record attendance directly and
    // have no shift to start, so the coach-only prompt would be misleading.
    if (sessionKey === NO_SESSION && profile.role === 'coach' && !window.confirm(t('startShiftPrompt'))) return
    setBusy(true)
    if (!navigator.onLine) {
      try {
        await queueAttendance({
          id: `${profile.institution_id}:${effectiveCoachId}:${date}:${sessionKey}`,
          institution_id: profile.institution_id || '', coach_id: effectiveCoachId,
          session_key: sessionKey, session_date: date, rows,
          created_at: new Date().toISOString(), attempts: 0,
        })
        cacheAttendanceSnapshot(`${profile.institution_id || 'none'}:${effectiveCoachId}:${date}:${sessionKey}`, status, reasons)
        await refreshQueueCount()
        setBusy(false)
        notify(t('attendanceQueuedOffline'))
        return
      } catch (error) {
        setBusy(false)
        notify(error instanceof Error ? error.message : t('attendanceQueueFailed'))
        return
      }
    }
    const result = await saveAttendance(rows, effectiveCoachId, sessionKey)
    if (result.error && (!navigator.onLine || /fetch failed|network|offline|timeout|failed to fetch/i.test(result.error))) {
      try {
        await queueAttendance({ id: `${profile.institution_id}:${effectiveCoachId}:${date}:${sessionKey}`, institution_id: profile.institution_id || '', coach_id: effectiveCoachId, session_key: sessionKey, session_date: date, rows, created_at: new Date().toISOString(), attempts: 0, last_error: result.error })
        cacheAttendanceSnapshot(`${profile.institution_id || 'none'}:${effectiveCoachId}:${date}:${sessionKey}`, status, reasons)
        await refreshQueueCount()
        setBusy(false)
        notify(t('attendanceQueuedOffline'))
        return
      } catch { /* retain the original persistence error below */ }
    }
    setBusy(false)
    if (result.error) { notify(result.error); return }
    setSessionKey(result.sessionKey)
    cacheAttendanceSnapshot(`${profile.institution_id || 'none'}:${effectiveCoachId}:${date}:${result.sessionKey}`, status, reasons)
    notify(t('attendanceSaved'))
  }

  const counts = useMemo(() => {
    const totals: Record<string, number> = {}
    for (const value of Object.values(status)) totals[value] = (totals[value] || 0) + 1
    return totals
  }, [status])

  const summary: [string, string][] = [
    ['present', t('present')],
    ['absent', t('absent')],
    ['late', t('late')],
    ['excused', t('excused')],
    ['permission', t('permission')],
    ['medical_exemption', t('medicalExemption')],
    ['duty', t('duty')],
  ]

  return (
    <>
      <Heading title={t('attendance')} subtitle={t('attendanceSave')} />
      {profile.role !== 'coach' && <p className="muted">{t('adminAttendanceHint')}</p>}
      <section className="panel">
        <label>{t('date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        {profile.role !== 'coach' && (
          <label>{t('coach')}
            <select value={coachId} onChange={(e) => setCoachId(e.target.value)}>
              {coaches.map((coach) => (
                <option key={coach.id} value={coach.id}>
                  {coach.full_name || coach.id}{coach.id === profile.id ? ` · ${t('you')}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>{t('sessionScope')}
          <select value={sessionKey} onChange={(e) => { void chooseSession(e.target.value) }}>
            <option value={NO_SESSION}>{t('noSession')}</option>
            {sessionOptions.map((session) => <option key={session.id} value={session.id}>{formatDateTime(session.started_at)}{session.ended_at ? ` · ${formatDateTime(session.ended_at)}` : ` · ${t('active')}`}</option>)}
          </select>
        </label>
        {queuedCount > 0 && <p className="notice-box">{t('attendanceQueuedCount').replace('{n}', String(queuedCount))}</p>}
        <div className="attendance-summary">
          {summary.map(([key, label]) => <span key={key}>{label}: <b>{counts[key] || 0}</b></span>)}
          {sessionKey === NO_SESSION && <span className="pill warning">{t('noSession')}</span>}
        </div>
        <div className="attendance-bulk">
          <button type="button" className="secondary" disabled={!students.length} onClick={markAllPresent}>
            <Check size={16} /> {t('markAllPresent')}
          </button>
          <button type="button" className="secondary" disabled={!students.length} onClick={clearAll}>
            <X size={16} /> {t('clearAll')}
          </button>
        </div>
        {loading ? <Empty t={t} /> : students.length === 0 ? <Empty t={t} /> : (
          <div className="attendance-list">
            {students.map((student) => (
              <div className="attendance-row" key={student.id}>
                <div className="grow"><b>{student.student_code} · {student.full_name}</b></div>
                <select aria-label={student.full_name} value={status[student.id] || ''} onChange={(e) => mark(student.id, e.target.value)}>
                  <option value="">—</option>
                  <option value="present">{t('present')}</option>
                  <option value="absent">{t('absent')}</option>
                  <option value="late">{t('late')}</option>
                  <option value="excused">{t('excused')}</option>
                  <option value="permission">{t('permission')}</option>
                  <option value="medical_exemption">{t('medicalExemption')}</option>
                  <option value="duty">{t('duty')}</option>
                </select>
                {status[student.id] && status[student.id] !== 'present' && (
                  <input className="attendance-reason" value={reasons[student.id] || ''}
                    onChange={(e) => setReasons((current) => ({ ...current, [student.id]: e.target.value }))}
                    placeholder={t('reason')} />
                )}
                {status[student.id] && <details className="attendance-time-details"><summary>{t('recordTimes')}</summary>
                  <div className="attendance-time-grid">
                    <label>{t('recordStart')}<input type="datetime-local" value={timings[student.id]?.start_at || ''} onChange={e => updateTiming(student.id,'start_at',e.target.value)} /></label>
                    <label>{t('recordEnd')}<input type="datetime-local" value={timings[student.id]?.end_at || ''} onChange={e => updateTiming(student.id,'end_at',e.target.value)} /></label>
                    {status[student.id] !== 'present' && <label>{t('recordNotified')}<input type="datetime-local" value={timings[student.id]?.notified_at || ''} onChange={e => updateTiming(student.id,'notified_at',e.target.value)} /></label>}
                    {['absent','permission','excused','medical_exemption'].includes(status[student.id]) && <label>{t('recordReturn')}<input type="datetime-local" value={timings[student.id]?.actual_return_at || ''} onChange={e => updateTiming(student.id,'actual_return_at',e.target.value)} /></label>}
                    {status[student.id] === 'duty' && <label>{t('dutyCompleted')}<input type="datetime-local" value={timings[student.id]?.duty_completed_at || ''} onChange={e => updateTiming(student.id,'duty_completed_at',e.target.value)} /></label>}
                  </div>
                </details>}
              </div>
            ))}
          </div>
        )}
        <button className="primary full" disabled={busy || !Object.keys(status).length} onClick={save}>
          {t('attendanceSave')}
        </button>
      </section>
    </>
  )
}
function Reports({ profile, t }: { profile: Profile; t: T }) {
  const [items, setItems] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [notes, setNotes] = useState('')
  const [counts, setCounts] = useState<ReportCounts>(emptyCounts)
  const [reportDate, setReportDate] = useState(localDate())
  const [draftId, setDraftId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [students, setStudents] = useState<{ id: string; full_name: string }[]>([])
  const [details, setDetails] = useState<{ student_id: string; student_name: string; observation: string; notes: string }[]>([])
  const [detailStudent, setDetailStudent] = useState('')
  const [detailObs, setDetailObs] = useState('')
  const [detailNotes, setDetailNotes] = useState('')
  const [reportPeriodStart, setReportPeriodStart] = useState('')
  const [reportPeriodEnd, setReportPeriodEnd] = useState('')
  const [issueDate, setIssueDate] = useState('')
  const admin = ['manager', 'admin'].includes(profile.role)

  async function load() {
    setLoading(true)
    if (!isConfigured) { setLoading(false); return }
    let query = supabase.from('daily_reports').select('*').order('created_at', { ascending: false })
    if (profile.role === 'coach') query = query.eq('coach_id', profile.id)
    if (profile.institution_id) query = query.eq('institution_id', profile.institution_id)
    // Administration never sees drafts: only submitted (finalized) reports are listed.
    if (profile.role !== 'coach') query = query.neq('status', 'draft')
    const { data, error } = await query
    if (error) notify(error.message)
    setItems((data ?? []) as ReportRow[])
    setLoading(false)
  }

  async function loadStudents() {
    if (!isConfigured || !profile.institution_id) return
    const { data } = await supabase.from('students').select('id,full_name').eq('institution_id', profile.institution_id).order('full_name')
    setStudents((data ?? []) as { id: string; full_name: string }[])
  }
  useEffect(() => { void load(); void loadStudents() }, [profile.id, profile.role, profile.institution_id])

  useEffect(() => {
    if (!show) return
    const timer = window.setTimeout(() => {
      saveReportDraft(profile.id, { counts, notes, draftId })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [show, counts, notes, draftId, profile.id])

  function countsFromStatuses(rows: { status: string }[]): ReportCounts {
    return {
      present_count: rows.filter((x) => x.status === 'present').length,
      absent_count: rows.filter((x) => x.status === 'absent').length,
      late_count: rows.filter((x) => x.status === 'late').length,
      injured_count: rows.filter((x) => x.status === 'medical_exemption').length,
      excused_count: rows.filter((x) => ['excused', 'permission', 'duty'].includes(x.status)).length,
    }
  }

  const [viewing, setViewing] = useState<ReportRow | null>(null)
  const [viewingDetails, setViewingDetails] = useState<{ student_id: string; student_name_snapshot: string; observation: string; notes: string }[]>([])
  const [viewingInstitution, setViewingInstitution] = useState('')
  const [viewingReviewedBy, setViewingReviewedBy] = useState('')

  async function openReportView(row: ReportRow) {
    setViewing(row)
    setViewingDetails([])
    setViewingInstitution('')
    setViewingReviewedBy('')
    const { data: detailsData, error: detailsError } = await supabase
      .from('report_details')
      .select('student_id,student_name_snapshot,observation,notes')
      .eq('report_id', row.id)
    if (detailsError) notify(detailsError.message)
    setViewingDetails((detailsData ?? []) as { student_id: string; student_name_snapshot: string; observation: string; notes: string }[])
    let institutionName = ''
    if (row.institution_id) {
      const { data: inst } = await supabase.from('institutions').select('name').eq('id', row.institution_id).maybeSingle()
      institutionName = (inst as { name?: string } | null)?.name ?? ''
    }
    let reviewedBy = ''
    if (row.reviewed_by) {
      const { data: reviewer } = await supabase.from('profiles').select('full_name').eq('id', row.reviewed_by).maybeSingle()
      reviewedBy = (reviewer as { full_name?: string } | null)?.full_name ?? ''
    }
    setViewingInstitution(institutionName)
    setViewingReviewedBy(reviewedBy)
  }

  async function deleteReport(row: ReportRow) {
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!canDeleteReport({ id: profile.id, role: profile.role }, row)) {
      notify(t('noPermission'))
      return
    }
    // `.select('id')` makes PostgREST return the affected rows. A delete that
    // matched no row (missing report, RLS refusal, lost permission) is then a
    // visible failure instead of a false success toast.
    const { data, error } = await supabase
      .from('daily_reports')
      .delete()
      .eq('id', row.id)
      .eq('coach_id', row.coach_id)
      .eq('is_finalized', row.is_finalized)
      .eq('status', row.status)
      .select('id')
    if (error) { notify(error.message); return }
    if (!affectedRows(data)) {
      notify(t('reportDeleteFailed'))
      await load()
      return
    }
    notify(t('deleted'))
    setViewing(null)
    await load()
  }

  async function openReport() {
    if (!isConfigured) { notify(t('configMissing')); return }
    const today = localDate()
    setReportDate(today)
    setDraftId(null)
    setNotes('')
    setDetails([])
    setCounts(emptyCounts())
    setReportPeriodStart('')
    setReportPeriodEnd('')
    setIssueDate('')
    let query = supabase.from('attendance_records').select('status').eq('session_date', today).eq('coach_id', profile.id)
    if (profile.institution_id) query = query.eq('institution_id', profile.institution_id)
    const { data, error } = await query
    if (error) notify(error.message)
    setCounts(countsFromStatuses((data ?? []) as { status: string }[]))
    const draft = loadReportDraft(profile.id)
    if (draft && hasDraftContent(draft)) {
      setCounts(draft.counts)
      setNotes(draft.notes)
      setDraftId(draft.draftId)
      notify(t('draftRestored'))
    }
    setShow(true)
  }

  // "Cancel" must really discard an unsent draft: the local snapshot AND the draft
  // row saved in the database (a coach may delete only his own unsent drafts).
  async function cancelReport() {
    const hasContent = Boolean(draftId) || notes.trim().length > 0 || Object.values(counts as Record<string, number>).some((n) => n > 0)
    if (!hasContent || !window.confirm(t('discardDraftConfirm'))) { setShow(false); return }
    setBusy(true)
    if (draftId) {
      const removed = await supabase
        .from('daily_reports')
        .delete()
        .eq('id', draftId)
        .eq('coach_id', profile.id)
        .eq('is_finalized', false)
        .eq('status', 'draft')
        .select('id')
      if (removed.error) { setBusy(false); notify(removed.error.message); return }
      if (!affectedRows(removed.data)) {
        setBusy(false)
        notify(t('reportDeleteFailed'))
        await load()
        return
      }
    }
    clearReportDraft(profile.id)
    setDraftId(null)
    setNotes('')
    setDetails([])
    setCounts(emptyCounts())
    setBusy(false)
    notify(t('draftDiscarded'))
    setShow(false)
    await load()
  }

  function continueDraft(row: ReportRow) {
    setDraftId(row.id)
    setReportDate(row.report_date)
    setNotes(row.notes || '')
    setCounts({
      present_count: row.present_count,
      absent_count: row.absent_count,
      late_count: row.late_count,
      injured_count: row.injured_count,
      excused_count: row.excused_count,
    })
    setReportPeriodStart(row.reporting_period_start ?? '')
    setReportPeriodEnd(row.reporting_period_end ?? '')
    setIssueDate(row.issue_date ?? '')
    setDetails([])
    if (isConfigured) {
      void supabase.from('report_details').select('student_id,student_name_snapshot,observation,notes')
        .eq('report_id', row.id).then(({ data }) => {
          if (data) setDetails((data as { student_id: string; student_name_snapshot: string; observation: string; notes: string }[]).map(d => ({
            student_id: d.student_id || '',
            student_name: d.student_name_snapshot || '',
            observation: d.observation || '',
            notes: d.notes || '',
          })))
        })
    }
    setShow(true)
  }

  function addDetail() {
    if (!detailStudent) return
    const st = students.find(s => s.id === detailStudent)
    const next: DetailDraft = {
      student_id: detailStudent,
      student_name: st?.full_name || '',
      observation: detailObs,
      notes: detailNotes,
    }
    setDetails(prev => upsertDetailDraft(prev, next))
    setDetailStudent(''); setDetailObs(''); setDetailNotes('')
  }
  function removeDetail(idx: number) { setDetails(prev => prev.filter((_, i) => i !== idx)) }

  async function latestShift() {
    if (!isConfigured) return null
    const { data } = await supabase
      .from('coach_shifts')
      .select('id,started_at,ended_at')
      .eq('coach_id', profile.id)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return (data as { id: string; started_at: string; ended_at: string | null } | null) ?? null
  }

  async function saveDraft() {
    if (!isConfigured) { notify(t('configMissing')); return }
    setBusy(true)
    const shift = await latestShift()
    const payload = {
      ...counts,
      notes: notes.trim() || null,
      coach_id: profile.id,
      institution_id: profile.institution_id,
      coach_name_snapshot: profile.full_name,
      shift_id: shift?.id ?? null,
      report_date: reportDate,
      status: 'draft',
      is_finalized: false,
      finalized_at: null,
      shift_start: shift?.started_at ?? null,
      shift_end: shift?.ended_at ?? null,
      reporting_period_start: reportPeriodStart || null,
      reporting_period_end: reportPeriodEnd || null,
      issue_date: issueDate || null,
      submitted_at: null,
    }
    let error: { message: string } | null = null
    let savedId = draftId
    if (draftId) {
      const result = await supabase
        .from('daily_reports')
        .update(withoutReportIdentity(payload))
        .eq('id', draftId)
        .eq('coach_id', profile.id)
        .eq('is_finalized', false)
        .select('id')
      error = result.error
      // The draft may have been removed or finalized in another tab. Recreate it
      // instead of silently writing nothing.
      if (!result.error && !affectedRows(result.data)) savedId = null
    }
    if (!savedId) {
      const result = await supabase.from('daily_reports').insert(payload).select('id').single()
      error = result.error
      const saved = result.data as { id?: string } | null
      if (saved?.id) setDraftId(saved.id)
    }
    setBusy(false)
    if (error) { notify(error.message); return }
    clearReportDraft(profile.id)
    notify(t('draftSaved'))
    setShow(false)
    await load()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured) { notify(t('configMissing')); return }
    if (draftId) {
      const { data: existingDraft, error: draftLookupError } = await supabase
        .from('daily_reports')
        .select('id,status,is_finalized')
        .eq('id', draftId)
        .eq('coach_id', profile.id)
        .maybeSingle()
      if (draftLookupError) { notify(draftLookupError.message); return }
      const existing = (existingDraft ?? null) as ReportLifecycleState | null
      if (existing && !canSubmitReport(existing)) {
        notify(t('reportAlreadyFinalized'))
        await load()
        return
      }
    }
    setBusy(true)
    const shift = await latestShift()
    const content = {
      ...counts,
      notes: notes.trim() || null,
      coach_id: profile.id,
      institution_id: profile.institution_id,
      coach_name_snapshot: profile.full_name,
      shift_id: shift?.id ?? null,
      report_date: reportDate,
      shift_start: shift?.started_at ?? null,
      reporting_period_start: reportPeriodStart || null,
      reporting_period_end: reportPeriodEnd || null,
      issue_date: issueDate || null,
    }

    // Step 1 — persist the editable draft. Details can only be written while
    // the report is not finalized (migration 0004 policy), so the report must
    // exist as a draft before the final transition.
    let savedId = draftId
    let stepError: { message: string } | null = null
    if (savedId) {
      const draftUpdate = await supabase
        .from('daily_reports')
        .update({ ...withoutReportIdentity(content), status: 'draft', is_finalized: false, finalized_at: null, submitted_at: null })
        .eq('id', savedId)
        .eq('coach_id', profile.id)
        .eq('is_finalized', false)
        .select('id')
      stepError = draftUpdate.error
      if (!stepError && !affectedRows(draftUpdate.data)) savedId = null
    }
    if (!savedId && !stepError) {
      const draftInsert = await supabase
        .from('daily_reports')
        .insert({ ...content, status: 'draft', is_finalized: false, finalized_at: null, submitted_at: null })
        .select('id')
        .single()
      stepError = draftInsert.error
      savedId = (draftInsert.data as { id?: string } | null)?.id ?? null
      if (!stepError && !savedId) stepError = { message: t('reportSaveFailed') }
    }
    if (stepError || !savedId) {
      setBusy(false)
      notify(stepError?.message || t('reportSaveFailed'))
      return
    }
    setDraftId(savedId)

    // Step 2 — replace student details while the report is still editable.
    // Existing rows are kept until the new batch is successfully inserted, so a
    // failed insert never destroys the notes the coach already entered.
    const planned = buildReportDetailRows(savedId, profile.institution_id, details, profile.id)
    const existingDetails = await supabase
      .from('report_details')
      .select('id')
      .eq('report_id', savedId)
    if (existingDetails.error) {
      setBusy(false)
      notify(existingDetails.error.message)
      return
    }
    if (planned.length) {
      const inserted = await supabase
        .from('report_details')
        .insert(planned)
        .select('id')
      if (inserted.error || !detailsInsertedCompletely(planned.length, affectedRows(inserted.data))) {
        setBusy(false)
        notify(inserted.error?.message || t('reportDetailsFailed'))
        return
      }
    }
    const staleIds = ((existingDetails.data ?? []) as { id: string }[]).map((row) => row.id)
    if (staleIds.length) {
      const removed = await supabase.from('report_details').delete().in('id', staleIds)
      if (removed.error) {
        setBusy(false)
        notify(removed.error.message)
        return
      }
    }

    // Step 3 — finalize via the secure RPC. The RPC verifies ownership and
    // state server-side, assigns submitted_at/finalized_at from DB time, and
    // prevents double-submission. The browser only requests the transition.
    if (shift?.ended_at) {
      await supabase
        .from('daily_reports')
        .update({ shift_end: shift.ended_at })
        .eq('id', savedId)
        .eq('coach_id', profile.id)
        .eq('is_finalized', false)
    }
    const finalize = await supabase
      .rpc('submit_daily_report', { p_report_id: savedId })
    setBusy(false)
    if (finalize.error) { notify(finalize.error.message); return }
    const result = finalize.data as { id?: string; ok?: boolean; error?: string } | null
    if (!result || (result.ok === false) || (!result.id && !result.ok)) {
      notify(t('reportAlreadyFinalized'))
      await load()
      return
    }
    clearReportDraft(profile.id)
    notify(t('savedOk'))
    setShow(false)
    await load()
  }

  async function review(row: ReportRow) {
    if (!canReviewReport({ id: profile.id, role: profile.role }, row)) {
      notify(t('noPermission'))
      return
    }
    const { data, error } = await supabase
      .from('daily_reports')
      .update({ status: 'reviewed', reviewed_by: profile.id })
      .eq('id', row.id)
      .eq('is_finalized', true)
      .eq('status', 'submitted')
      .select('id')
    if (error) { notify(error.message); return }
    if (!affectedRows(data)) { notify(t('reportReviewFailed')); await load(); return }
    notify(t('savedOk'))
    await load()
  }

  async function currentTemplate() {
    if (!profile.institution_id || !isConfigured) return null
    const { data, error } = await supabase
      .from('report_templates')
      .select('file_path,file_name')
      .eq('institution_id', profile.institution_id)
      .eq('is_current', true)
      .eq('is_archived', false)
      .maybeSingle()
    if (error || !data?.file_path) return null
    const { data: signed } = await supabase.storage
      .from('trainer-report-templates')
      .createSignedUrl(data.file_path as string, 120)
    if (!signed?.signedUrl) return null
    const response = await fetch(signed.signedUrl)
    if (!response.ok) return null
    return { bytes: await response.arrayBuffer(), name: data.file_name as string }
  }

  async function exportWord(row: ReportRow) {
    if (!isConfigured) { notify(t('configMissing')); return }
    try {
      if (!row.is_finalized) { notify(t('noPermission')); return }
      if (profile.role === 'coach' && row.coach_id !== profile.id) { notify(t('noPermission')); return }
      if (profile.role === 'owner') { notify(t('noPermission')); return }
      const countPayload = {
        present_count: row.present_count,
        absent_count: row.absent_count,
        late_count: row.late_count,
        injured_count: row.injured_count,
        excused_count: row.excused_count,
      }
      let institutionName = ''
      if (row.institution_id) {
        const { data: inst } = await supabase.from('institutions').select('name').eq('id', row.institution_id).maybeSingle()
        institutionName = (inst as { name?: string } | null)?.name ?? ''
      }
      const detailRows = await supabase
        .from('report_details')
        .select('student_name_snapshot,attendance_status,observation,incident,injury_details,notes')
        .eq('report_id', row.id)
        .then(({ data }) => (data ?? []) as { student_name_snapshot: string; attendance_status: string | null; observation: string | null; incident: string | null; injury_details: string | null; notes: string | null }[])
      let reviewerName = ''
      if (row.reviewed_by) {
        const { data: reviewer } = await supabase.from('profiles').select('full_name').eq('id', row.reviewed_by).maybeSingle()
        reviewerName = (reviewer as { full_name?: string } | null)?.full_name ?? ''
      }
      const exportedStudents = detailRows.map((detail) => ({
        name: detail.student_name_snapshot || '—',
        status: detail.attendance_status || '—',
        observation: detail.observation || '',
        incident: detail.incident || '',
        injuryDetails: detail.injury_details || '',
        notes: detail.notes || '',
      }))

      const templateInput: TemplateReportInput = {
        institutionName,
        coachName: row.coach_name_snapshot || '—',
        reportDate: row.report_date,
        counts: countPayload,
        notes: row.notes ?? null,
        reportingPeriodStart: row.reporting_period_start ?? null,
        reportingPeriodEnd: row.reporting_period_end ?? null,
        issueDate: row.issue_date ?? null,
        submittedAt: row.submitted_at ?? null,
        reviewedAt: row.reviewed_at ?? null,
        reviewedBy: reviewerName,
        students: exportedStudents,
      }

      // Use the institution's active Word template when one exists. The built-in
      // document remains the fallback so an invalid upload can never block the
      // export of an official report.
      let blob: Blob | null = null
      let fileName = templateExportFileName(row.coach_name_snapshot || 'report', row.report_date)
      const template = await currentTemplate()
      if (template) {
        try {
          const { renderReportTemplate } = await import('./lib/report-template-render')
          blob = await renderReportTemplate(template.bytes, templateInput)
        } catch {
          notify(t('templateExportFailed'))
          blob = null
        }
      }
      if (!blob) {
        blob = await buildReportDocument({
          reportDate: row.report_date,
          coachName: row.coach_name_snapshot || '—',
          counts: countPayload,
          notes: row.notes ?? null,
          shiftStart: row.shift_start ?? null,
          shiftEnd: row.shift_end ?? null,
          reportingPeriodStart: row.reporting_period_start ?? null,
          reportingPeriodEnd: row.reporting_period_end ?? null,
          issueDate: row.issue_date ?? null,
          submittedAt: row.submitted_at ?? null,
          reviewedAt: row.reviewed_at ?? null,
          reviewedBy: reviewerName,
          students: exportedStudents,
        })
        fileName = reportFileName({
          reportDate: row.report_date,
          coachName: row.coach_name_snapshot || 'report',
          counts: countPayload,
          notes: row.notes ?? null,
        })
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      // log export (best-effort, non-blocking)
      if (profile.institution_id) {
        void supabase.from('report_exports').insert({
          institution_id: profile.institution_id,
          report_id: row.id,
          exported_by: profile.id,
          export_type: 'single',
          file_name: fileName,
        })
      }
      notify(t('exportedWord'))
    } catch {
      notify(t('errorGeneric'))
    }
  }
  return (
    <>
      <Heading
        title={t('reports')}
        action={profile.role === 'coach' && (
          <button className="primary action-btn" onClick={openReport}><Plus size={18} /> {t('newReport')}</button>
        )}
      />
      {loading ? <Empty t={t} /> : items.length === 0 ? <Empty t={t} /> : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('name')}</th>
                  <th>{t('date')}</th>
                  <th>{t('present')}</th>
                  <th>{t('absent')}</th>
                  <th>{t('late')}</th>
                  <th>{t('injured')}</th>
                  <th>{t('excused')}</th>
                  <th>{t('status')}</th>
                  <th>{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>{row.coach_name_snapshot}</td>
                    <td>{row.report_date}</td>
                    <td>{row.present_count}</td>
                    <td>{row.absent_count}</td>
                    <td>{row.late_count}</td>
                    <td>{row.injured_count}</td>
                    <td>{row.excused_count}</td>
                    <td>
                      <span className={`pill ${row.status === 'reviewed' ? 'success' : row.is_finalized ? 'success' : 'warning'}`}>
                        {row.status === 'reviewed' ? t('reviewed') : row.is_finalized ? t('finalized') : t('draft')}
                      </span>
                    </td>
                    <td>
                      {profile.role === 'coach' && !row.is_finalized && (
                        <button className="secondary" onClick={() => continueDraft(row)}>{t('continueDraft')}</button>
                      )}
                      {admin && canReviewReport({ id: profile.id, role: profile.role }, row) && (
                        <button className="secondary" onClick={() => { void review(row) }}>{t('approveReport')}</button>
                      )}
                      {row.is_finalized && (
                        <button className="secondary" onClick={() => { void exportWord(row) }}>{t('exportWord')}</button>
                      )}
                      {row.is_finalized && (
                        <button className="secondary" onClick={() => { void openReportView(row) }}>{t('viewReport')}</button>
                      )}
                      {canDeleteReport({ id: profile.id, role: profile.role }, row) && (
                        <button className="danger" onClick={() => { if (window.confirm(t('deleteReportConfirm'))) void deleteReport(row) }}>{t('deleteReport')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {viewing && (
        <Modal title={t('viewReport')} close={() => setViewing(null)} closeLabel={t('close')}>
          <div style={{ display: 'grid', gap: 10 }}>
            <h3>{viewing.coach_name_snapshot}</h3>
            <p className="muted">{t('date')}: {viewing.report_date}</p>
            <p><b>{t('status')}:</b> {viewing.status}</p>
            <p><b>{t('institution')}:</b> {viewingInstitution || '—'}</p>
            <p><b>{t('periodStart')}:</b> {viewing.reporting_period_start ?? '—'}</p>
            <p><b>{t('periodEnd')}:</b> {viewing.reporting_period_end ?? '—'}</p>
            <p><b>{t('issueDate')}:</b> {viewing.issue_date ?? '—'}</p>
            <p><b>{t('submittedAt')}:</b> {viewing.submitted_at ?? '—'}</p>
            <p><b>{t('finalizedAt')}:</b> {viewing.finalized_at ?? '—'}</p>
            <p><b>{t('reviewedBy')}:</b> {viewingReviewedBy || '—'}</p>
            <div className="counter-grid">
              {(['present_count', 'absent_count', 'late_count', 'injured_count', 'excused_count'] as const).map((key) => (
                <div className="counter" key={key}>
                  <span>{t(key.replace('_count', ''))}</span>
                  <b>{viewing[key]}</b>
                </div>
              ))}
            </div>
            <label>{t('notes')}
              <div>{viewing.notes || '—'}</div>
            </label>
            <h4>{t('reportDetails')}</h4>
            {viewingDetails.length === 0 ? (
              <p className="muted">{t('noData')}</p>
            ) : (
              viewingDetails.map((d, i) => (
                <div key={i} className="student-row">
                  <div className="grow"><b>{d.student_name_snapshot}</b><small>{d.observation}</small><small>{d.notes}</small></div>
                </div>
              ))
            )}
          </div>
          <div className="modal-actions">
            <button type="button" className="secondary" onClick={() => setViewing(null)}>{t('close')}</button>
          </div>
        </Modal>
      )}

      {show && (
        <Modal title={t('newReport')} close={() => setShow(false)} closeLabel={t('close')}>
          <form onSubmit={submit}>
            <p className="muted">{t('countsAuto')}</p>
            <label>{t('date')}
              <input type="date" value={reportDate} onChange={(e) => setReportDate(e.target.value)} />
            </label>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
              <label>{t('periodStart')}
                <input type="date" value={reportPeriodStart} onChange={(e) => setReportPeriodStart(e.target.value)} />
              </label>
              <label>{t('periodEnd')}
                <input type="date" value={reportPeriodEnd} onChange={(e) => setReportPeriodEnd(e.target.value)} />
              </label>
            </div>
            <label>{t('issueDate')}
              <input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </label>
            <div className="counter-grid">
              {(['present_count', 'absent_count', 'late_count', 'injured_count', 'excused_count'] as const).map((key) => (
                <label className="counter" key={key}>
                  <span>{t(key.replace('_count', ''))}</span>
                  <input type="number" min="0" value={counts[key]}
                    onChange={(e) => setCounts((current) => ({ ...current, [key]: Math.max(0, Number(e.target.value) || 0) }))} />
                </label>
              ))}
            </div>
            <label>{t('notes')}
              <DictateButton t={t} onText={setNotes} />
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <small className="muted">{t('reportLocked')}</small>
            <label>{t('studentNotes')}
              <div style={{display:'grid',gap:6,marginTop:6}}>
                <select value={detailStudent} onChange={e => setDetailStudent(e.target.value)}>
                  <option value="">—</option>
                  {students.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </select>
                <input placeholder={t('notes')} value={detailObs} onChange={e => setDetailObs(e.target.value)} />
                <textarea rows={2} placeholder={t('notes')} value={detailNotes} onChange={e => setDetailNotes(e.target.value)} />
                <button type="button" className="secondary" onClick={addDetail} disabled={!detailStudent}>{t('addNote')}</button>
              </div>
            </label>
            {details.length > 0 && (
              <div className="member-list">
                {details.map((d, i) => (
                  <div className="student-row" key={i}>
                    <div className="grow"><b>{d.student_name}</b><small>{d.observation}</small><small>{d.notes}</small></div>
                    <button className="danger" type="button" onClick={() => removeDetail(i)}><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" disabled={busy} onClick={cancelReport}>{t('cancel')}</button>
              <button type="button" className="secondary" disabled={busy} onClick={saveDraft}>
                {t('saveDraft')}
              </button>
              <button className="primary" disabled={busy}>{t('send')}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
function Notebook({ profile, t }: { profile: Profile; t: T }) {
  const [items, setItems] = useState<{ id: string; title: string; body: string; entry_date: string }[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    if (!isConfigured) { setLoading(false); return }
    const { data, error } = await supabase
      .from('coach_notebooks')
      .select('id,title,body,entry_date')
      .eq('coach_id', profile.id)
      .order('entry_date', { ascending: false })
    if (error) notify(error.message)
    setItems((data ?? []) as { id: string; title: string; body: string; entry_date: string }[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.id])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!title.trim() || !body.trim()) return
    setBusy(true)
    const { error } = await supabase.from('coach_notebooks').insert({
      institution_id: profile.institution_id,
      coach_id: profile.id,
      title: title.trim(),
      body: body.trim(),
      entry_date: localDate(),
    })
    setBusy(false)
    if (error) { notify(error.message); return }
    setTitle('')
    setBody('')
    notify(t('savedOk'))
    await load()
  }

  return (
    <>
      <Heading title={t('notebook')} subtitle={t('privateNote')} />
      <section className="panel">
        <form onSubmit={add}>
          <label>{t('title')}<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>{t('notes')}
            <DictateButton t={t} onText={setBody} />
            <textarea required rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <button className="primary" disabled={busy}>{t('add')}</button>
        </form>
      </section>
      {loading ? <Empty t={t} /> : items.length === 0 ? <Empty t={t} /> : items.map((item) => (
        <article className="panel notice" key={item.id}>
          <h3>{item.title}</h3>
          <p>{item.body}</p>
          <small>{item.entry_date}</small>
        </article>
      ))}
    </>
  )
}

function Notices({ profile, t }: { profile: Profile; t: T }) {
  const [items, setItems] = useState<{ id: string; title: string; body: string; created_at: string }[]>([])
  const [show, setShow] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [readers, setReaders] = useState<{ id: string; full_name: string; role: string; read_at: string }[]>([])
  const [nonReaders, setNonReaders] = useState<{ id: string; full_name: string; role: string }[]>([])
  const [readersNoticeId, setReadersNoticeId] = useState<string | null>(null)
  const [readersLoading, setReadersLoading] = useState(false)
  const canPublish = ['manager', 'admin'].includes(profile.role)
  const canDelete = ['manager', 'admin'].includes(profile.role)

  async function load() {
    setLoading(true)
    if (!isConfigured) { setLoading(false); return }
    let query = supabase.from('admin_notices').select('id,title,body,created_at').order('created_at', { ascending: false })
    if (profile.institution_id) query = query.eq('institution_id', profile.institution_id)
    const { data, error } = await query
    if (error) notify(error.message)
    setItems((data ?? []) as { id: string; title: string; body: string; created_at: string }[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.institution_id])

  async function markNoticeRead(noticeId: string) {
    if (!isConfigured) return
    try {
      await supabase.from('notice_reads').insert({ notice_id: noticeId, reader_id: profile.id })
    } catch {
      // Already read or RLS denied — ignore
    }
  }

  async function openNotice(notice: { id: string; title: string; body: string; created_at: string }) {
    void markNoticeRead(notice.id)
  }

  async function loadReaders(noticeId: string) {
    setReadersLoading(true)
    setReadersNoticeId(noticeId)
    if (!isConfigured) { setReadersLoading(false); return }
    const [readsRes, membersRes] = await Promise.all([
      supabase
        .from('notice_reads')
        .select('reader_id, read_at')
        .eq('notice_id', noticeId),
      supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('institution_id', profile.institution_id)
        .eq('account_status', 'active')
        .order('full_name'),
    ])
    if (readsRes.error || membersRes.error) {
      notify((readsRes.error || membersRes.error)?.message || t('errorGeneric'))
      setReadersLoading(false)
      return
    }
    const readRows = (readsRes.data ?? []) as { reader_id: string; read_at: string }[]
    const members = (membersRes.data ?? []) as { id: string; full_name: string; role: string }[]
    const memberMap = new Map(members.map((member) => [member.id, member]))
    const readIds = new Set(readRows.map((row) => row.reader_id))
    setReaders(readRows.flatMap((row) => {
      const member = memberMap.get(row.reader_id)
      return member ? [{ id: member.id, full_name: member.full_name, role: member.role, read_at: row.read_at }] : []
    }))
    setNonReaders(members.filter((member) => !readIds.has(member.id)))
    setReadersLoading(false)
  }

  async function deleteNotice(noticeId: string) {
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!window.confirm(t('deleteNoticeConfirm'))) return
    setBusy(true)
    const { error } = await supabase.from('admin_notices').delete().eq('id', noticeId).eq('institution_id', profile.institution_id)
    setBusy(false)
    if (error) { notify(t('noticeDeleteFailed')); return }
    // Audit log entry
    try {
      await supabase.from('audit_logs').insert({
        institution_id: profile.institution_id,
        actor_id: profile.id,
        action: 'DELETE_NOTICE',
        table_name: 'admin_notices',
        record_id: noticeId,
        old_data: null,
        new_data: { deleted_by: profile.full_name, deleted_at: new Date().toISOString() },
      })
    } catch { /* best effort */ }
    notify(t('noticeDeleted'))
    setReadersNoticeId(null)
    await load()
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured) { notify(t('configMissing')); return }
    setBusy(true)
    const { error } = await supabase.from('admin_notices').insert({
      title: title.trim(),
      body: body.trim(),
      author_id: profile.id,
      institution_id: profile.institution_id,
      is_published: true,
      published_at: new Date().toISOString(),
    })
    setBusy(false)
    if (error) { notify(error.message); return }
    setShow(false)
    setTitle('')
    setBody('')
    notify(t('savedOk'))
    await load()
  }

  return (
    <>
      <Heading
        title={t('notices')}
        action={canPublish && (
          <button className="primary action-btn" onClick={() => setShow(true)}><Plus size={18} /> {t('newNotice')}</button>
        )}
      />
      {loading ? <Empty t={t} /> : items.length === 0 ? <Empty t={t} /> : items.map((notice) => (
        <article className="panel notice" key={notice.id} onClick={() => { void openNotice(notice) }}>
          <div className="notice-head"><Bell size={18} /><small>{formatDateTime(notice.created_at)}</small></div>
          <h3>{notice.title}</h3>
          <p>{notice.body}</p>
          {canPublish && (
            <div className="heading-actions" style={{ marginTop: 8 }}>
              <button className="secondary action-btn" onClick={(e) => { e.stopPropagation(); void loadReaders(notice.id) }}>{t('noticeReaders')}</button>
              <button className="danger action-btn" onClick={(e) => { e.stopPropagation(); void deleteNotice(notice.id) }}>{t('deleteNotice')}</button>
            </div>
          )}
        </article>
      ))}
      {readersNoticeId && (
        <Modal title={t('noticeReaders')} close={() => setReadersNoticeId(null)} closeLabel={t('close')}>
          {readersLoading ? <Empty t={t} /> : (
            <>
              <section className="panel">
                <h3>{t('whoRead')} ({readers.length})</h3>
                {readers.length === 0 ? <p className="muted">{t('noData')}</p> : readers.map((r) => (
                  <div className="student-row" key={r.id}>
                    <div className="grow"><b>{r.full_name}</b><small>{r.role}</small></div>
                    <small>{formatDateTime(r.read_at)}</small>
                  </div>
                ))}
              </section>
              <section className="panel">
                <h3>{t('whoNotRead')} ({nonReaders.length})</h3>
                {nonReaders.length === 0 ? <p className="muted">{t('noData')}</p> : nonReaders.map((member) => (
                  <div className="student-row" key={member.id}>
                    <div className="grow"><b>{member.full_name}</b><small>{member.role}</small></div>
                  </div>
                ))}
              </section>
            </>
          )}
        </Modal>
      )}
      {show && (
        <Modal title={t('newNotice')} close={() => setShow(false)} closeLabel={t('close')}>
          <form onSubmit={save}>
            <label>{t('title')}<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>{t('body')}<textarea required rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></label>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setShow(false)}>{t('cancel')}</button>
              <button className="primary" disabled={busy}>{t('save')}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
function Notifications({ profile, t }: { profile: Profile; t: T }) {
  const [items, setItems] = useState<{
    id: string; title: string; body: string; notification_type: string; read_at: string | null; created_at: string
  }[]>([])
  const [loading, setLoading] = useState(true)
  const [permission, setPermission] = useState<PushPermission>(() => pushEnv().permission)
  const nav = useNavigate()

  async function load() {
    setLoading(true)
    if (!isConfigured) { setLoading(false); return }
    const { data, error } = await supabase
      .from('notifications')
      .select('id,title,body,notification_type,read_at,created_at')
      .eq('recipient_id', profile.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) notify(error.message)
    setItems((data ?? []) as typeof items)
    setLoading(false)
  }

  useEffect(() => {
    void load()
    if (!isConfigured) return
    const channel = supabase
      .channel(`tt-notifications-${profile.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'notifications', filter: `recipient_id=eq.${profile.id}`,
      }, () => { void load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [profile.id])

  async function markRead(id: string) {
    const { error } = await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
    if (error) { notify(error.message); return }
    await load()
  }

  async function markAllRead() {
    const { error } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('recipient_id', profile.id)
      .is('read_at', null)
    if (error) { notify(error.message); return }
    notify(t('savedOk'))
    await load()
  }

  async function enableNotifications() {
    const result = await requestPushPermission()
    setPermission(result)
    notify(result === 'granted' ? t('notificationsOn') : t('notificationsBlocked'))
  }

  async function open(item: typeof items[number]) {
    if (!item.read_at) {
      await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', item.id)
    }
    const kind = item.notification_type || ''
    if (kind.includes('message')) nav('/messages')
    else if (kind.includes('notice')) nav('/notices')
    else if (kind.includes('report')) nav('/reports')
    else await load()
  }

  const env = pushEnv()
  const unreadCount = items.filter((x) => !x.read_at).length

  return (
    <>
      <Heading
        title={t('notifications')}
        action={(
          <div className="heading-actions">
            {env.supported && permission === 'default' && (
              <button className="secondary action-btn" onClick={enableNotifications}>{t('enableNotifications')}</button>
            )}
            {permission === 'granted' && <span className="pill success">{t('notificationsOn')}</span>}
            {(permission === 'denied' || !env.supported || permission === 'unsupported') && (
              <span className="pill warning">{t('notificationsBlocked')}</span>
            )}
            {unreadCount > 0 && <button className="secondary action-btn" onClick={markAllRead}>{t('markRead')}</button>}
          </div>
        )}
      />
      <p className="muted">{t('browserNotificationsHint')}</p>
      {loading ? <Empty t={t} /> : items.length === 0 ? <Empty t={t} /> : (
        <section className="panel">
          {items.map((item) => (
            <button className="student-row" key={item.id} onClick={() => { void open(item) }}
              style={{ width: '100%', background: 'transparent', textAlign: 'start' }}>
              <div className="report-icon"><Bell size={18} /></div>
              <div className="grow">
                <b>{item.title}</b>
                <small>{item.body}</small>
                <small>{formatDateTime(item.created_at)}</small>
              </div>
              {!item.read_at && <span className="unread-badge">{t('unread')}</span>}
            </button>
          ))}
        </section>
      )}
    </>
  )
}
type ConversationRow = {
  id: string
  title: string | null
  conversation_type: string
  created_by: string
  created_at: string
}

function Messages({ profile, t }: { profile: Profile; t: T }) {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [current, setCurrent] = useState<Conversation | null>(null)
  const [items, setItems] = useState<ChatMessage[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [unread, setUnread] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [memberPick, setMemberPick] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [olderBusy, setOlderBusy] = useState(false)
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({})
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)

  async function loadPeople() {
    if (!isConfigured || !profile.institution_id) { setPeople([]); return }
    const { data } = await supabase
      .from('profiles')
      .select('id,full_name,email,role')
      .eq('institution_id', profile.institution_id)
      .eq('account_status', 'active')
      .neq('id', profile.id)
      .order('full_name')
    setPeople((data ?? []) as Person[])
  }

  async function loadConversations() {
    setLoading(true)
    if (!isConfigured) { setLoading(false); return }
    const { data: mine, error: mineError } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('profile_id', profile.id)
    if (mineError) { notify(mineError.message); setLoading(false); return }
    const ids = (mine ?? []).map((row: { conversation_id: string }) => row.conversation_id)
    if (!ids.length) {
      setConversations([])
      setUnread({})
      setCurrent(null)
      setLoading(false)
      return
    }
    const [conversationRes, memberRes, unreadRes] = await Promise.all([
      supabase.from('conversations').select('*').in('id', ids).order('created_at', { ascending: false }),
      supabase.from('conversation_members').select('conversation_id,profile_id').in('conversation_id', ids),
      supabase.rpc('unread_counts'),
    ])
    if (conversationRes.error || memberRes.error) {
      notify((conversationRes.error || memberRes.error)?.message || t('errorGeneric'))
      setLoading(false)
      return
    }
    const memberRows = (memberRes.data ?? []) as { conversation_id: string; profile_id: string }[]
    const profileIds = [...new Set(memberRows.map((row) => row.profile_id))]
    let profiles: Person[] = []
    if (profileIds.length) {
      const { data } = await supabase.from('profiles').select('id,full_name,email,role').in('id', profileIds)
      profiles = (data ?? []) as Person[]
    }
    const mapped = ((conversationRes.data ?? []) as ConversationRow[]).map((conversation) => {
      const members = memberRows
        .filter((row) => row.conversation_id === conversation.id)
        .flatMap((row) => {
          const person = profiles.find((p) => p.id === row.profile_id)
          return person ? [person] : []
        })
      const others = members.filter((person) => person.id !== profile.id)
      const names = members.map((person) => person.full_name || person.email).join(' · ')
      const label = conversation.title
        || (conversation.conversation_type === 'direct'
          ? (others[0]?.full_name || others[0]?.email || t('directConversation'))
          : (names || t('groupConversation')))
      return { ...conversation, label, people: members }
    })
    setConversations(mapped)
    const counts: Record<string, number> = {}
    if (!unreadRes.error) {
      for (const row of (unreadRes.data ?? []) as { conversation_id: string; unread: number | string }[]) {
        counts[row.conversation_id] = Number(row.unread) || 0
      }
    }
    setUnread(counts)
    setCurrent((prev) => {
      if (prev) {
        const found = mapped.find((conversation) => conversation.id === prev.id)
        if (found) return found
      }
      return mapped[0] ?? null
    })
    setLoading(false)
  }

  async function loadMessages(id: string, older = false) {
    if (!isConfigured) return
    let query = supabase
      .from('messages')
      .select('id,body,sender_id,created_at,message_type,media_path,profiles:profiles!messages_sender_id_fkey(full_name)')
      .eq('conversation_id',id)
      .order('created_at', { ascending: false })
      .limit(50)
    if (older && items.length) query = query.lt('created_at', items[0].created_at)
    const { data, error } = await query
    if (error) { notify(error.message); return }
    const rows = ((data ?? []) as ChatMessage[]).slice().reverse()
    const ownMessageIds = rows.filter((row) => row.sender_id === profile.id).map((row) => row.id)
    const receiptsByMessage = new Map<string, { id: string; full_name: string; read_at: string }[]>()
    if (ownMessageIds.length) {
      const { data: receiptRows, error: receiptError } = await supabase
        .from('message_reads')
        .select('message_id,reader_id,read_at')
        .in('message_id', ownMessageIds)
      if (receiptError) notify(receiptError.message)
      const receipts = (receiptRows ?? []) as { message_id: string; reader_id: string; read_at: string }[]
      const readerIds = [...new Set(receipts.map((receipt) => receipt.reader_id))]
      let readerNames = new Map<string, string>()
      if (readerIds.length) {
        const { data: readerProfiles, error: readerError } = await supabase
          .from('profiles')
          .select('id,full_name')
          .in('id', readerIds)
        if (readerError) notify(readerError.message)
        readerNames = new Map(((readerProfiles ?? []) as { id: string; full_name: string }[]).map((person) => [person.id, person.full_name]))
      }
      for (const receipt of receipts) {
        const list = receiptsByMessage.get(receipt.message_id) ?? []
        list.push({ id: receipt.reader_id, full_name: readerNames.get(receipt.reader_id) || t('coach'), read_at: receipt.read_at })
        receiptsByMessage.set(receipt.message_id, list)
      }
    }
    const hydratedRows = rows.map((row) => ({ ...row, readBy: receiptsByMessage.get(row.id) ?? [] }))
    const nextUrls = { ...mediaUrls }
    await Promise.all(rows.filter((row) => row.media_path).map(async (row) => {
      const { data: link } = await supabase.storage.from('trainer-media').createSignedUrl(row.media_path as string, 3600)
      if (link?.signedUrl) nextUrls[row.id] = link.signedUrl
    }))
    setMediaUrls(nextUrls)
    if (older) setItems((prev) => [...hydratedRows, ...prev])
    else setItems(hydratedRows)
    setHasMore(rows.length === 50)
  }

  useEffect(() => {
    void loadPeople()
    void loadConversations()
  }, [profile.id, profile.institution_id])

  useEffect(() => {
    if (!current) return
    void loadMessages(current.id)
    if (!isConfigured) return
    const channel = supabase
      .channel(`tt-chat-${current.id}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${current.id}`,
      }, () => {
        void loadMessages(current.id)
        // The conversation is on screen, so a new message is already read. When
        // the tab is hidden leave it unread so the badge is truthful on return.
        if (document.visibilityState === 'visible') void markConversationRead(current.id)
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'message_reads',
      }, () => { void loadMessages(current.id) })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [current?.id])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [items, current?.id])

  async function markConversationRead(id: string) {
    if (!isConfigured) return
    const { error } = await supabase.rpc('mark_conversation_read', { p_conversation_id: id })
    if (!error) setUnread((prev) => ({ ...prev, [id]: 0 }))
  }

  async function openConversation(conversation: Conversation) {
    setCurrent(conversation)
    setItems([])
    await markConversationRead(conversation.id)
  }

  async function loadOlder() {
    if (!current || !hasMore || olderBusy) return
    setOlderBusy(true)
    await loadMessages(current.id, true)
    setOlderBusy(false)
  }
  async function createConversation(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!selected.length) { notify(t('selectAtLeastOne')); return }
    setBusy(true)
    const { error } = await supabase.rpc('create_conversation', {
      p_title: title.trim() || null,
      p_member_ids: selected,
    })
    setBusy(false)
    if (error) { notify(error.message); return }
    setCreateOpen(false)
    setSelected([])
    setTitle('')
    await loadConversations()
  }

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!current || (!body.trim() && !file)) return
    if (!isConfigured) { notify(t('configMissing')); return }
    setBusy(true)
    let media_path: string | null = null
    let message_type = 'text'
    if (file) {
      const extension = file.name.split('.').pop() || 'bin'
      media_path = `${profile.institution_id}/${current.id}/${profile.id}/${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage.from('trainer-media').upload(media_path, file, { upsert: false, contentType: file.type })
      if (uploadError) { notify(uploadError.message); setBusy(false); return }
      message_type = file.type.startsWith('image/') ? 'image' : file.type.startsWith('audio/') ? 'audio' : 'file'
    }
    const { error } = await supabase.from('messages').insert({
      sender_id: profile.id,
      institution_id: profile.institution_id,
      conversation_id:current.id,
      body: body.trim() || null,
      message_type,
      media_path,
    })
    setBusy(false)
    if (error) { notify(error.message); return }
    setBody('')
    setFile(null)
    await loadMessages(current.id)
  }

  async function startRecording() {
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      notify(t('micDenied'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const rec = new MediaRecorder(stream)
      recorder.current = rec
      chunks.current = []
      rec.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data) }
      rec.onstop = () => {
        if (!chunks.current.length) notify(t('nothingRecorded'))
        else {
          const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
          setFile(new File([blob], `voice-${Date.now()}.webm`, { type: blob.type }))
        }
        stream.getTracks().forEach((track) => track.stop())
      }
      rec.start()
      setRecording(true)
    } catch {
      notify(t('micDenied'))
    }
  }

  function stopRecording() {
    recorder.current?.stop()
    setRecording(false)
  }

  async function addMember() {
    if (!current || !memberPick) return
    if (!canManageMembers) { notify(t('noPermission')); return }
    const { error } = await supabase.from('conversation_members').insert({
      conversation_id: current.id,
      profile_id: memberPick,
    })
    if (error) { notify(error.message); return }
    notify(t('savedOk'))
    setMemberPick('')
    await loadConversations()
  }

  async function leaveConversation() {
    if (!current) return
    if (!window.confirm(t('leaveConfirm'))) return
    const leavingId = current.id
    const { error } = await supabase.from('conversation_members')
      .delete().eq('conversation_id', leavingId).eq('profile_id', profile.id)
    if (error) { notify(error.message); return }
    setCurrent(null)
    setItems([])
    setMembersOpen(false)
    notify(t('youLeft'))
    await loadConversations()
  }

  async function removeMember(profileId: string) {
    if (!current) return
    if (!canManageMembers) { notify(t('noPermission')); return }
    if (!window.confirm(t('removeMemberConfirm'))) return
    const { error } = await supabase.from('conversation_members')
      .delete()
      .eq('conversation_id', current.id)
      .eq('profile_id', profileId)
    if (error) { notify(error.message); return }
    notify(t('savedOk'))
    await loadConversations()
  }
  const memberCandidates = current
    ? people.filter((person) => !(current.people ?? []).some((member) => member.id === person.id))
    : []
  const canManageMembers = Boolean(current)
    && (current?.created_by === profile.id || ['owner', 'manager', 'admin'].includes(profile.role))

  return (
    <>
      <Heading
        title={t('messages')}
        action={(
          <div className="heading-actions">
            <button className="primary action-btn" onClick={() => setCreateOpen(true)}>
              <MessageCircle size={17} /> {t('newConversation')}
            </button>
          </div>
        )}
      />
      <section className="panel chat-workspace">
        <aside className="conversation-list">
          {loading ? <p className="muted">{t('loading')}</p> : conversations.length === 0 ? (
            <p className="muted">{t('noConversations')}</p>
          ) : conversations.map((conversation) => (
            <button key={conversation.id} className={`conversation-item ${current?.id === conversation.id ? 'selected' : ''}`}
              onClick={() => { void openConversation(conversation) }}>
              <span className="avatar"><Users size={17} /></span>
              <span className="grow">
                <b>{conversation.label}</b>
                <small>{conversation.conversation_type === 'direct' ? t('directConversation') : t('groupConversation')}</small>
              </span>
              {(unread[conversation.id] || 0) > 0 && <span className="unread-badge">{unread[conversation.id]}</span>}
            </button>
          ))}
        </aside>
        <div className="chat-panel-inner">
          {current ? (
            <>
              <div className="chat-title">
                <div className="grow">
                  <b>{current.label}</b>
                  <small>{current.conversation_type === 'direct' ? t('directConversation') : t('groupConversation')}</small>
                </div>
                <div className="heading-actions">
                  {current.conversation_type === 'group' && (
                    <button className="secondary members-btn" onClick={() => setMembersOpen(true)}>
                      <Users size={15} /> {t('groupMembers')}
                    </button>
                  )}
                  <button className="secondary members-btn" onClick={() => { void leaveConversation() }}>{t('leaveConversation')}</button>
                </div>
              </div>
              <div className="chat-messages" ref={scrollRef}>
                {hasMore && (
                  <button className="secondary load-older" disabled={olderBusy} onClick={() => { void loadOlder() }}>
                    {olderBusy ? t('loading') : t('loadOlder')}
                  </button>
                )}
                {items.length === 0 ? <p className="muted empty-chat">{t('noMessages')}</p> : items.map((message) => {
                  const url = mediaUrls[message.id] || message.media_url
                  return (
                    <div className={`chat-bubble ${message.sender_id === profile.id ? 'mine' : ''}`} key={message.id}>
                      <b>{message.profiles?.full_name || t('coach')}</b>
                      {message.body && <p>{message.body}</p>}
                      {url && (message.message_type === 'image'
                        ? <img className="chat-image" src={url} alt={t('attachment')} />
                        : message.message_type === 'audio'
                          ? <audio controls src={url} />
                          : <a href={url} target="_blank" rel="noreferrer">{t('openAttachment')}</a>)}
                      <small>
                        {formatTime(message.created_at)}
                        {message.sender_id === profile.id && (
                          message.readBy?.length
                            ? ` · ${t('messageReadBy')}: ${message.readBy.map((reader) => reader.full_name).join('، ')}`
                            : ` · ${t('messageNotRead')}`
                        )}
                      </small>
                    </div>
                  )
                })}
              </div>
              <form className="chat-compose" onSubmit={send}>
                <label className="attach-btn" title={t('attach')}>
                  <Paperclip size={19} />
                  <input type="file" accept="image/jpeg,image/png,image/webp,audio/webm,audio/mp4,application/pdf"
                    onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
                </label>
                <button type="button" className={`icon-btn ${recording ? 'recording' : ''}`}
                  onClick={recording ? stopRecording : () => { void startRecording() }}
                  title={recording ? t('stopRecording') : t('recordVoice')}
                  aria-label={recording ? t('stopRecording') : t('recordVoice')}>
                  {recording ? <Square size={18} /> : <Mic size={18} />}
                </button>
                <input value={body} onChange={(e) => setBody(e.target.value)}
                  placeholder={file ? file.name : t('typeMessage')} />
                <button className="primary icon-send" disabled={busy || (!body.trim() && !file)} aria-label={t('send')}>
                  <Send size={18} />
                </button>
              </form>
            </>
          ) : <div className="empty-chat">{t('pickConversation')}</div>}
        </div>
      </section>

      {createOpen && (
        <Modal title={t('createConversationTitle')} close={() => setCreateOpen(false)} closeLabel={t('close')}>
          <form onSubmit={createConversation}>
            <p className="notice-box">{t('participantsHelp')}</p>
            <label>{t('groupNameOptional')}
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('groupNamePlaceholder')} />
            </label>
            <label>{t('selectParticipants')}
              <select multiple size={Math.min(6, Math.max(3, people.length))} value={selected}
                onChange={(e) => setSelected(Array.from(e.target.selectedOptions, (option) => option.value))}>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.full_name || person.email} — {t(person.role || 'coach')}
                  </option>
                ))}
              </select>
            </label>
            <small className="muted">{t('selectOneCoach')}</small>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => setCreateOpen(false)}>{t('cancel')}</button>
              <button className="primary" disabled={busy || !selected.length}>{busy ? t('creating') : t('createConversation')}</button>
            </div>
          </form>
        </Modal>
      )}

      {membersOpen && current && (
        <Modal title={t('groupMembers')} close={() => setMembersOpen(false)} closeLabel={t('close')}>
          <p className="muted">{canManageMembers ? t('membersHelp') : t('membersManageHint')}</p>
          <div className="member-list">
            {(current.people ?? []).map((person) => (
              <div className="student-row" key={person.id}>
                <div className="avatar">{(person.full_name || person.email || '?').slice(0, 1)}</div>
                <div className="grow"><b>{person.full_name || person.email}</b><small>{person.email}</small></div>
                {canManageMembers && person.id !== profile.id && (
                  <button className="danger" onClick={() => { void removeMember(person.id) }}>
                    <Trash2 size={15} /> {t('removeMember')}
                  </button>
                )}
              </div>
            ))}
          </div>
          {canManageMembers && memberCandidates.length > 0 && (
            <div>
              <label>{t('addMember')}
                <select value={memberPick} onChange={(e) => setMemberPick(e.target.value)}>
                  <option value="">—</option>
                  {memberCandidates.map((person) => (
                    <option key={person.id} value={person.id}>{person.full_name || person.email}</option>
                  ))}
                </select>
              </label>
              <button className="primary" disabled={!memberPick} onClick={() => { void addMember() }}>
                <UserPlus size={16} /> {t('addMember')}
              </button>
            </div>
          )}
        </Modal>
      )}
    </>
  )
}
function invitationStatusLabel(status: string, t: T): string {
  if (status === 'accepted') return t('invitationAccepted')
  if (status === 'expired') return t('invitationExpired')
  if (status === 'revoked') return t('invitationRevoked')
  return t('pending')
}

function InvitationList({ items, t, institutionNames }: {
  items: InvitationRow[]
  t: T
  institutionNames?: Record<string, string>
}) {
  const pendingCount = items.filter((item) => item.status === 'pending').length
  return (
    <section className="panel invitations-panel">
      <div className="panel-head">
        <h3>{t('invitations')}</h3>
        <span className="pill warning">{pendingCount} · {t('pendingInvitations')}</span>
      </div>
      <p className="muted">{t('invitationEmailOnlyHint')}</p>
      {items.length === 0 ? <Empty t={t} /> : items.map((item) => (
        <div className="invitation-row" key={item.id}>
          <div className="avatar">{(item.invited_name || item.invited_email || '?').slice(0, 1)}</div>
          <div className="grow">
            <b>{item.invited_name || item.invited_email || '—'}</b>
            <small dir="ltr">{item.invited_email || '—'}</small>
            <div className="invite-row-tags">
              <span className="tag">{t(item.role)}</span>
              {institutionNames?.[item.institution_id] && <span className="tag">{institutionNames[item.institution_id]}</span>}
              <span className="tag email"><ShieldCheck size={12} /> {t('emailOnlyBadge')}</span>
            </div>
          </div>
          <div className="invite-row-end">
            <span className={`pill ${item.status === 'accepted' ? 'success' : item.status === 'pending' ? 'warning' : 'danger'}`}>
              {invitationStatusLabel(item.status, t)}
            </span>
            {item.status === 'pending' && (
              <small className="muted">{t('expiresAt')} {formatDateTime(item.expires_at)}</small>
            )}
          </div>
        </div>
      ))}
    </section>
  )
}

/**
 * Owner-only account row. The owner may correct role/institution for every
 * non-owner account and approve/reject/suspend/reactivate it. The server-side
 * review_account() RPC repeats every check; these controls are only a
 * convenience and cannot grant more than the RPC allows.
 */
function OwnerAccountRow({ person, institutions, t, onChanged }: {
  person: AccountRow
  institutions: { id: string; name: string; is_active: boolean }[]
  t: T
  onChanged: () => void
}) {
  const initialRole: AccountRole = isAccountRole(person.role) ? person.role : 'coach'
  const [role, setRole] = useState<AccountRole>(initialRole)
  const [institutionId, setInstitutionId] = useState(person.institution_id ?? '')
  const [busy, setBusy] = useState(false)
  const [avatarPath, setAvatarPath] = useState(person.avatar_path || '')
  const [avatarUrl, setAvatarUrl] = useState('')
  const isOwnerAccount = person.role === 'owner'
  const status = person.account_status || 'pending'

  useEffect(() => {
    setRole(isAccountRole(person.role) ? person.role : 'coach')
    setInstitutionId(person.institution_id ?? '')
    setAvatarPath(person.avatar_path || '')
  }, [person.role, person.institution_id, person.avatar_path])

  useEffect(() => {
    let alive = true
    if (!isConfigured || !avatarPath) { setAvatarUrl(''); return }
    void supabase.storage.from('trainer-avatars').createSignedUrl(avatarPath, 3600).then(({ data }) => {
      if (alive) setAvatarUrl(data?.signedUrl || '')
    })
    return () => { alive = false }
  }, [avatarPath])

  async function run(action: 'approve' | 'reject' | 'suspend' | 'reactivate' | 'update') {
    if (busy || isOwnerAccount) return
    if ((action === 'approve' || action === 'update') && !institutionId) {
      notify(t('institutionRequired'))
      return
    }
    if (action === 'reject' && !window.confirm(t('rejectConfirm'))) return
    setBusy(true)
    const result = await reviewAccount(person.id, action, {
      role,
      institutionId: institutionId || null,
    })
    setBusy(false)
    if (!result?.ok) {
      notify(reviewErrorMessage(result?.error || '', t))
      return
    }
    notify(t('accountUpdated'))
    onChanged()
  }

  async function uploadAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!/image\/(png|jpe?g|webp)/.test(file.type)) { notify(t('invalidImage')); return }
    setBusy(true)
    const extension = file.name.split('.').pop() || 'png'
    const avatar_path = `${person.institution_id}/${person.id}/avatar-${Date.now()}.${extension}`
    const { error: uploadError } = await supabase.storage
      .from('trainer-avatars')
      .upload(avatar_path, file, { upsert: false, contentType: file.type })
    if (uploadError) { notify(uploadError.message); setBusy(false); return }
    setAvatarPath(avatar_path)
    const { error: updateError } = await supabase.from('profiles').update({ avatar_path }).eq('id', person.id)
    if (updateError) { notify(updateError.message); setBusy(false); return }
    notify(t('savedOk'))
    setBusy(false)
    e.target.value = ''
  }

  return (
    <div className="student-row">
      <div className="avatar">
        {avatarUrl ? (
          <img src={avatarUrl} alt={person.full_name || 'avatar'} className="avatar-img" />
        ) : (
          <span>{(person.full_name || person.email || '?').slice(0, 1)}</span>
        )}
        {person.institution_id && (
          <>
            <input
              id={`avatar-upload-${person.id}`}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              style={{ display: 'none' }}
              onChange={(e) => { void uploadAvatar(e) }}
            />
            <button type="button" className="avatar-upload-btn" disabled={busy} onClick={() => document.getElementById(`avatar-upload-${person.id}`)?.click()}>
              {t('changeAvatar')}
            </button>
          </>
        )}
      </div>
      <div className="grow">
        <b>{person.full_name || person.email || '—'}</b>
        <small>{person.email} · {t(person.role || 'coach')}</small>
        {!isOwnerAccount && (
          <div className="heading-actions" style={{ marginTop: 8 }}>
            <label>{t('role')}
              <select value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
                {ASSIGNABLE_ROLES.map((item) => <option key={item} value={item}>{t(item)}</option>)}
              </select>
            </label>
            <label>{t('institution')}
              <select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)}>
                <option value="">—</option>
                {institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <button className="secondary" disabled={busy} onClick={() => { void run('update') }}>
              {t('saveAccount')}
            </button>
          </div>
        )}
      </div>
      <span className={`pill ${status === 'active' ? 'success' : status === 'rejected' ? 'danger' : 'warning'}`}>
        {t(status)}
      </span>
      {isOwnerAccount ? (
        <small className="muted">{t('ownerAccountReadOnly')}</small>
      ) : (
        <>
          {(status === 'pending' || status === 'rejected') && (
            <button className="secondary" disabled={busy} onClick={() => { void run('approve') }}>{t('approve')}</button>
          )}
          {status === 'pending' && (
            <button className="danger" disabled={busy} onClick={() => { void run('reject') }}>{t('reject')}</button>
          )}
          {status === 'active' && (
            <button className="danger" disabled={busy} onClick={() => { void run('suspend') }}>{t('suspend')}</button>
          )}
          {status === 'suspended' && (
            <button className="secondary" disabled={busy} onClick={() => { void run('reactivate') }}>{t('reactivate')}</button>
          )}
        </>
      )}
    </div>
  )
}

function OwnerConsole({ profile, t }: { profile: Profile; t: T }) {
  const [institutions, setInstitutions] = useState<{ id: string; name: string; is_active: boolean }[]>([])
  const [accounts, setAccounts] = useState<AccountRow[]>([])
  const [invitations, setInvitations] = useState<InvitationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [institution, setInstitution] = useState('')
  const [role, setRole] = useState<AccountRole>('manager')
  const [busy, setBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)

  const institutionNames = Object.fromEntries(institutions.map((item) => [item.id, item.name])) as Record<string, string>
  const pending = accounts.filter((person) => person.account_status === 'pending')

  async function load() {
    setLoading(true)
    if (!isConfigured) { setLoading(false); return }
    const [institutionRes, accountRes, invitationRes] = await Promise.all([
      supabase.from('institutions').select('id,name,is_active').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(500),
      supabase.from('invitations')
        .select('id,invited_email,invited_name,role,institution_id,status,delivery_method,expires_at,created_at')
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    const firstError = institutionRes.error || accountRes.error || invitationRes.error
    if (firstError) notify(firstError.message)
    setInstitutions((institutionRes.data ?? []) as { id: string; name: string; is_active: boolean }[])
    setAccounts((accountRes.data ?? []) as AccountRow[])
    setInvitations((invitationRes.data ?? []) as InvitationRow[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function createInstitution(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured) { notify(t('configMissing')); return }
    setBusy(true)
    const { error } = await supabase.from('institutions').insert({ name: name.trim(), default_language: 'ar' })
    setBusy(false)
    if (error) { notify(error.message); return }
    setName('')
    notify(t('savedOk'))
    await load()
  }

  async function inviteMember(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!institution) { notify(t('institutionRequired')); return }
    if (!canInvite('owner', role)) { notify(t('noPermission')); return }
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: {
        email: email.trim(),
        full_name: fullName.trim(),
        role,
        institution_id: institution,
      },
    })
    setBusy(false)
    const payload = data as FunctionPayload | null
    const errorCode = payload?.error || await functionErrorCode(error)
    if (error || errorCode) { notify(inviteErrorMessage(errorCode, t)); return }
    notify(inviteSuccessMessage(payload, t))
    setEmail('')
    setFullName('')
    await load()
  }

  async function syncMissingProfiles() {
    if (!isConfigured) { notify(t('configMissing')); return }
    setSyncBusy(true)
    const { data, error } = await supabase.rpc('sync_missing_profiles')
    setSyncBusy(false)
    if (error) { notify(error.message); return }
    const result = data as { ok?: boolean; error?: string; inserted?: number; updated?: number } | null
    if (!result?.ok) {
      notify(reviewErrorMessage(result?.error || '', t))
      return
    }
    notify(t('profilesSynced')
      .replace('{inserted}', String(result.inserted ?? 0))
      .replace('{updated}', String(result.updated ?? 0)))
    await load()
  }

  async function setInstitutionActive(item: { id: string; name: string; is_active: boolean }, next: boolean) {
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!next && !window.confirm(t('deactivateInstitutionConfirm'))) return
    setBusy(true)
    const { error } = await supabase.from('institutions').update({ is_active: next }).eq('id', item.id)
    setBusy(false)
    if (error) { notify(error.message); return }
    notify(t('savedOk'))
    await load()
  }

  return (
    <>
      <Heading title={t('ownerConsole')} subtitle={t('platform')} />
      <section className="panel">
        <h3>{t('createInstitution')}</h3>
        <form onSubmit={createInstitution}>
          <label>{t('institution')}<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="primary" disabled={busy}>{t('save')}</button>
        </form>
      </section>
      <section className="panel">
        <h3>{t('invite')}</h3>
        <p className="muted">{t('inviteHint')}</p>
        <form className="invite-form" onSubmit={inviteMember}>
          <label>{t('institution')}
            <select required value={institution} onChange={(e) => setInstitution(e.target.value)}>
              <option value="">—</option>
              {institutions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <label>{t('name')}<input required value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
          <label>{t('email')}<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>{t('role')}
            <select value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
              {INVITE_MATRIX.owner.map((item) => <option key={item} value={item}>{t(item)}</option>)}
            </select>
          </label>
          <div className="form-note">
            <ShieldCheck size={15} />
            <span>{t('inviteEmailOnlyNote')}</span>
          </div>
          <button className="primary" disabled={busy}>{busy ? t('sendingInvite') : t('sendInvite')}</button>
        </form>
      </section>
      <section className="panel">
        <h3>{t('syncProfiles')}</h3>
        <p className="muted">{t('syncProfilesHint')}</p>
        <button className="secondary" disabled={syncBusy} onClick={() => { void syncMissingProfiles() }}>
          {syncBusy ? t('loading') : t('syncProfiles')}
        </button>
      </section>
      <section className="panel">
        <h3>{t('pendingAccounts')}</h3>
        {loading ? <Empty t={t} /> : pending.length === 0 ? <Empty t={t} /> : pending.map((person) => (
          <OwnerAccountRow
            key={person.id}
            person={person}
            institutions={institutions}
            t={t}
            onChanged={() => { void load() }}
          />
        ))}
      </section>
      <section className="panel">
        <h3>{t('allAccounts')}</h3>
        {loading ? <Empty t={t} /> : accounts.filter((person) => person.account_status !== 'pending').length === 0 ? <Empty t={t} /> : accounts.filter((person) => person.account_status !== 'pending').map((person) => (
          <OwnerAccountRow
            key={person.id}
            person={person}
            institutions={institutions}
            t={t}
            onChanged={() => { void load() }}
          />
        ))}
      </section>
      <InvitationList items={invitations} t={t} institutionNames={institutionNames} />
      <section className="panel">
        <h3>{t('institutions')}</h3>
        {institutions.length === 0 ? <Empty t={t} /> : institutions.map((item) => (
          <div className="student-row" key={item.id}>
            <div className="avatar"><Building2 size={18} /></div>
            <div className="grow"><b>{item.name}</b><small>{item.id}</small></div>
            <span className={`pill ${item.is_active ? 'success' : 'warning'}`}>{item.is_active ? t('active') : t('inactive')}</span>
            <button
              className={item.is_active ? 'danger' : 'secondary'}
              disabled={busy}
              onClick={() => { void setInstitutionActive(item, !item.is_active) }}
            >
              {item.is_active ? t('deactivateInstitution') : t('activateInstitution')}
            </button>
          </div>
        ))}
      </section>
    </>
  )
}

function Team({ profile, t }: { profile: Profile; t: T }) {
  const [items, setItems] = useState<AccountRow[]>([])
  const [invitations, setInvitations] = useState<InvitationRow[]>([])
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<AccountRole>('coach')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [reviewingId, setReviewingId] = useState('')
  const inviteRoles = INVITE_MATRIX[profile.role]
  const canInviteHere = inviteRoles.length > 0
  const canSeeInvitations = profile.role === 'manager' || profile.role === 'admin'

  // The server repeats every one of these checks inside review_account(); the
  // UI mirrors them so the Director never sees a button that would fail. The
  // Administration role reaches this page in read-only mode.
  const canReviewPerson = (person: AccountRow) => canReviewAccount(
    profile.role,
    isAccountRole(person.role) ? person.role : 'coach',
    person.institution_id === profile.institution_id,
    person.id === profile.id,
  )

  async function load() {
    setLoading(true)
    if (!isConfigured || !profile.institution_id) { setLoading(false); return }
    const [profileRes, invitationRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .eq('institution_id', profile.institution_id)
        .order('created_at', { ascending: false }),
      canSeeInvitations
        ? supabase
          .from('invitations')
          .select('id,invited_email,invited_name,role,institution_id,status,delivery_method,expires_at,created_at')
          .eq('institution_id', profile.institution_id)
          .order('created_at', { ascending: false })
          .limit(100)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (profileRes.error) notify(profileRes.error.message)
    if (invitationRes.error) notify(invitationRes.error.message)
    setItems((profileRes.data ?? []) as AccountRow[])
    setInvitations((invitationRes.data ?? []) as InvitationRow[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.institution_id, profile.role])

  async function invite(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!canInviteHere || !profile.institution_id) { notify(t('noPermission')); return }
    if (!canInvite(profile.role, role)) { notify(t('noPermission')); return }
    setBusy(true)
    const { data, error } = await supabase.functions.invoke('invite-user', {
      body: {
        email: email.trim(),
        full_name: fullName.trim(),
        role,
        institution_id: profile.institution_id,
      },
    })
    setBusy(false)
    const payload = data as FunctionPayload | null
    const errorCode = payload?.error || await functionErrorCode(error)
    if (error || errorCode) { notify(inviteErrorMessage(errorCode, t)); return }
    notify(inviteSuccessMessage(payload, t))
    setEmail('')
    setFullName('')
    await load()
  }

  async function review(person: AccountRow, action: 'approve' | 'reject' | 'suspend' | 'reactivate') {
    if (!canReviewPerson(person)) { notify(t('noPermission')); return }
    if (action === 'reject' && !window.confirm(t('rejectConfirm'))) return
    setReviewingId(person.id)
    const result = await reviewAccount(person.id, action)
    setReviewingId('')
    if (!result?.ok) { notify(reviewErrorMessage(result?.error || '', t)); return }
    notify(t('accountUpdated'))
    await load()
  }

  const canReviewAny = profile.role === 'manager'

  return (
    <>
      <Heading
        title={t('team')}
        subtitle={canInviteHere ? t('institutionConsole') : t('readOnlyAccounts')}
      />
      {canInviteHere ? (
        <section className="panel">
          <div className="panel-head">
            <h3>{t('invite')}</h3>
            <span className="pill success">{t('emailOnlyBadge')}</span>
          </div>
          <p className="muted">{profile.role === 'admin' ? t('adminInviteHint') : t('inviteHint')}</p>
          <form className="invite-form" onSubmit={invite}>
            <label>{t('name')}<input required value={fullName} onChange={(e) => setFullName(e.target.value)} /></label>
            <label>{t('email')}<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>{t('role')}
              <select value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
                {inviteRoles.map((item) => <option key={item} value={item}>{t(item)}</option>)}
              </select>
            </label>
            <div className="form-note">
              <ShieldCheck size={15} />
              <span>{t('inviteEmailOnlyNote')}</span>
            </div>
            <button className="primary" disabled={busy}>{busy ? t('sendingInvite') : t('sendInvite')}</button>
          </form>
        </section>
      ) : (
        <section className="panel">
          <h3>{t('manageAccounts')}</h3>
          <p className="muted">{t('readOnlyAccounts')}</p>
        </section>
      )}
      <section className="panel">
        <div className="panel-head">
          <h3>{t('manageAccounts')}</h3>
          <span className="muted">{items.length}</span>
        </div>
        <p className="muted">{canReviewAny ? t('reviewAccountsHint') : t('adminReviewHint')}</p>
        {loading ? <Empty t={t} /> : items.length === 0 ? <Empty t={t} /> : items.map((person) => {
          const status = person.account_status || 'pending'
          const canReview = canReviewPerson(person)
          const rowBusy = reviewingId === person.id
          return (
            <div className="student-row" key={person.id}>
              <div className="avatar">{(person.full_name || person.email || '?').slice(0, 1)}</div>
              <div className="grow">
                <b>{person.full_name || person.email || '—'}</b>
                <small>{person.email} · {t(isAccountRole(person.role) ? person.role : 'coach')}</small>
              </div>
              <span className={`pill ${status === 'active' ? 'success' : status === 'rejected' ? 'danger' : 'warning'}`}>
                {t(status)}
              </span>
              {canReview && status === 'pending' && (
                <>
                  <button className="secondary" disabled={rowBusy} onClick={() => { void review(person, 'approve') }}>{t('approve')}</button>
                  <button className="danger" disabled={rowBusy} onClick={() => { void review(person, 'reject') }}>{t('reject')}</button>
                </>
              )}
              {canReview && status === 'rejected' && (
                <button className="secondary" disabled={rowBusy} onClick={() => { void review(person, 'approve') }}>{t('approve')}</button>
              )}
              {canReview && status === 'active' && (
                <button className="danger" disabled={rowBusy} onClick={() => { void review(person, 'suspend') }}>{t('suspend')}</button>
              )}
              {canReview && status === 'suspended' && (
                <button className="secondary" disabled={rowBusy} onClick={() => { void review(person, 'reactivate') }}>{t('reactivate')}</button>
              )}
            </div>
          )
        })}
      </section>
      {canSeeInvitations && <InvitationList items={invitations} t={t} />}
    </>
  )
}
function Medical({ profile, t }: { profile: Profile; t: T }) {
  const [students, setStudents] = useState<{ id: string; student_code: string; full_name: string }[]>([])
  const [records, setRecords] = useState<MedicalRecord[]>([])
  const [studentId, setStudentId] = useState('')
  const [kind, setKind] = useState('medical')
  const [details, setDetails] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [notifiedAt, setNotifiedAt] = useState('')
  const [actualReturnAt, setActualReturnAt] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const typeLabels: Record<string, string> = {
    medical: t('medical'),
    injury: t('injured'),
    exemption: t('medicalExemption'),
    permission: t('permission'),
    other: t('other'),
  }

  async function load() {
    setLoading(true)
    if (!isConfigured || !profile.institution_id) { setLoading(false); return }
    const [studentRes, recordRes] = await Promise.all([
      supabase.from('students').select('id,student_code,full_name').eq('institution_id', profile.institution_id).order('full_name'),
      supabase.from('student_medical_records').select('*').eq('institution_id', profile.institution_id).order('created_at', { ascending: false }),
    ])
    if (studentRes.error || recordRes.error) notify((studentRes.error || recordRes.error)?.message || t('errorGeneric'))
    setStudents((studentRes.data ?? []) as { id: string; student_code: string; full_name: string }[])
    const mapped = await Promise.all(((recordRes.data ?? []) as MedicalRecord[]).map(async (record) => {
      if (!record.attachment_path) return record
      const { data } = await supabase.storage.from('trainer-medical').createSignedUrl(record.attachment_path, 3600)
      return { ...record, attachment_url: data?.signedUrl || '' }
    }))
    setRecords(mapped)
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.institution_id])

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured) { notify(t('configMissing')); return }
    if (!profile.institution_id || !studentId) { notify(t('noPermission')); return }
    setBusy(true)
    let attachment_path: string | null = null
    if (file) {
      const extension = file.name.split('.').pop() || 'bin'
      attachment_path = `${profile.institution_id}/${profile.id}/${crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await supabase.storage
        .from('trainer-medical')
        .upload(attachment_path, file, { upsert: false, contentType: file.type })
      if (uploadError) { notify(uploadError.message); setBusy(false); return }
    }
    const { error } = await supabase.from('student_medical_records').insert({
      institution_id: profile.institution_id,
      student_id: studentId,
      record_type: kind,
      details: details.trim(),
      start_date: startDate || null,
      end_date: endDate || null,
      start_at: startTime ? new Date(startTime).toISOString() : null,
      end_at: endTime ? new Date(endTime).toISOString() : null,
      notified_at: notifiedAt ? new Date(notifiedAt).toISOString() : null,
      actual_return_at: actualReturnAt ? new Date(actualReturnAt).toISOString() : null,
      created_by: profile.id,
      attachment_path,
    })
    setBusy(false)
    if (error) { notify(error.message); return }
    notify(t('savedOk'))
    setStudentId('')
    setDetails('')
    setStartDate('')
    setEndDate('')
    setStartTime('')
    setEndTime('')
    setNotifiedAt('')
    setActualReturnAt('')
    setFile(null)
    await load()
  }

  return (
    <>
      <Heading title={t('medical')} subtitle={t('records')} />
      <section className="panel">
        <form onSubmit={add}>
          <label>{t('students')}
            <select required value={studentId} onChange={(e) => setStudentId(e.target.value)}>
              <option value="">—</option>
              {students.map((student) => (
                <option key={student.id} value={student.id}>{student.student_code} · {student.full_name}</option>
              ))}
            </select>
          </label>
          <label>{t('records')}
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>{t('notes')}
            <DictateButton t={t} onText={setDetails} />
            <textarea required rows={3} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          <label>{t('fromDate')}<input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></label>
          <label>{t('toDate')}<input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
          <label>{t('recordStart')}<input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} /></label>
          <label>{t('recordEnd')}<input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} /></label>
          <label>{t('recordNotified')}<input type="datetime-local" value={notifiedAt} onChange={e => setNotifiedAt(e.target.value)} /></label>
          <label>{t('recordReturn')}<input type="datetime-local" value={actualReturnAt} onChange={e => setActualReturnAt(e.target.value)} /></label>
          <label>{t('medicalFile')}
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = '' }} />
          </label>
          <button className="primary" disabled={busy}>{t('save')}</button>
        </form>
      </section>
      {loading ? <Empty t={t} /> : records.length === 0 ? <Empty t={t} /> : records.map((record) => {
        const student = students.find((item) => item.id === record.student_id)
        return (
          <article className="panel notice" key={record.id}>
            <div className="notice-head">
              <b>{student ? `${student.student_code} · ${student.full_name}` : t('students')}</b>
              <span className="pill warning">{typeLabels[record.record_type] || t(record.record_type)}</span>
            </div>
            <p>{record.details}</p>
            {(record.start_date || record.end_date) && (
              <small>{record.start_date || '—'} → {record.end_date || '—'}</small>
            )}
            {(record.start_at || record.end_at || record.notified_at || record.actual_return_at) && <small className="record-timeline">{[record.start_at && `${t('recordStart')}: ${formatDateTime(record.start_at)}`, record.end_at && `${t('recordEnd')}: ${formatDateTime(record.end_at)}`, record.notified_at && `${t('recordNotified')}: ${formatDateTime(record.notified_at)}`, record.actual_return_at && `${t('recordReturn')}: ${formatDateTime(record.actual_return_at)}`].filter(Boolean).join(' · ')}</small>}
            {record.attachment_url && (
              <a href={record.attachment_url} target="_blank" rel="noreferrer">{t('openAttachment')}</a>
            )}
            <small>{formatDateTime(record.created_at)}</small>
          </article>
        )
      })}
    </>
  )
}
function ClassManagement({ profile, t }: { profile: Profile; t: T }) {
  type ClassRow = { id: string; name: string; academic_year: string | null; description: string | null }
  const [classes, setClasses] = useState<ClassRow[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [academicYear, setAcademicYear] = useState('')
  const [description, setDescription] = useState('')
  const [editingClass, setEditingClass] = useState<ClassRow | null>(null)
  const [editName, setEditName] = useState('')
  const [editYear, setEditYear] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const canManage = profile.role === 'manager' || profile.role === 'admin'

  async function load() {
    setLoading(true)
    if (!isConfigured || !profile.institution_id) { setLoading(false); return }
    const [classRes, studentRes] = await Promise.all([
      supabase.from('classes').select('id,name,academic_year,description').eq('institution_id', profile.institution_id).order('name'),
      supabase.from('students').select('id,student_code,full_name,is_active,class_id,date_of_birth').eq('institution_id', profile.institution_id).order('full_name'),
    ])
    if (classRes.error) notify(classRes.error.message)
    if (studentRes.error) notify(studentRes.error.message)
    setClasses((classRes.data ?? []) as ClassRow[])
    setStudents((studentRes.data ?? []) as Student[])
    setLoading(false)
  }
  useEffect(() => { void load() }, [profile.institution_id, profile.id])

  async function create(e: FormEvent) {
    e.preventDefault()
    if (!canManage || !profile.institution_id) { notify(t('noPermission')); return }
    setBusy(true)
    const { error } = await supabase.from('classes').insert({ name: name.trim(), academic_year: academicYear.trim(), description: description.trim() || null, institution_id: profile.institution_id })
    setBusy(false)
    if (error) { notify(error.message); return }
    notify(t('savedOk')); setName(''); setAcademicYear(''); setDescription(''); await load()
  }
  async function update(e: FormEvent, classId: string) {
    e.preventDefault()
    if (!canManage || !profile.institution_id || !editName.trim()) return
    setBusy(true)
    const { data, error } = await supabase.from('classes').update({ name: editName.trim(), academic_year: editYear.trim() || null, description: editDescription.trim() || null }).eq('id', classId).eq('institution_id', profile.institution_id).select('id')
    setBusy(false)
    if (error) { notify(error.message); return }
    if (!affectedRows(data)) { notify(t('classUpdateFailed')); return }
    setEditingClass(null); await load()
  }
  function startEdit(c: ClassRow) { setEditingClass(c); setEditName(c.name); setEditYear(c.academic_year || ''); setEditDescription(c.description || '') }
  async function remove(classId: string) {
    if (!canManage || !window.confirm(t('deleteClassConfirm'))) return
    setBusy(true)
    const { data, error } = await supabase.from('classes').delete().eq('id', classId).eq('institution_id', profile.institution_id).select('id')
    setBusy(false)
    if (error) { notify(error.message); return }
    if (!affectedRows(data)) { notify(t('classDeleteFailed')); return }
    if (selected === classId) setSelected(null)
    notify(t('deleted')); await load()
  }
  const selectedClass = classes.find(c => c.id === selected) || null
  const members = selected ? students.filter(s => s.class_id === selected) : []
  const unassigned = students.filter(s => !s.class_id || !classes.some(c => c.id === s.class_id))

  return <>
    <Heading title={t('classes')} subtitle={canManage ? undefined : t('classesReadOnlyHint')} />
    {canManage && <section className="panel"><h3>{t('addClass')}</h3><form onSubmit={create}>
      <label>{t('className')}<input required value={name} onChange={e => setName(e.target.value)} /></label>
      <label>{t('academicYear')}<input required value={academicYear} onChange={e => setAcademicYear(e.target.value)} /></label>
      <label>{t('description')}<textarea value={description} onChange={e => setDescription(e.target.value)} /></label>
      <button className="primary" disabled={busy}>{t('save')}</button>
    </form></section>}
    <section className="panel"><h3>{t('manageClasses')}</h3>
      {loading ? <Empty t={t} /> : classes.length === 0 ? <p>{t('noClassesYet')}</p> : classes.map(c => {
        const count = students.filter(s => s.class_id === c.id).length
        return <div key={c.id} className="student-row">
          <button className="secondary" onClick={() => setSelected(selected === c.id ? null : c.id)}>{selected === c.id ? t('hideStudents') : t('viewStudents')}</button>
          <div className="grow"><b>{c.name}</b><small>{c.academic_year || '—'} · {count} {t('studentsCount')}</small></div>
          {canManage && <div className="actions"><button className="secondary small" onClick={() => startEdit(c)}>{t('classEdit')}</button><button className="danger small" onClick={() => void remove(c.id)} disabled={busy}>{t('deleteClass')}</button></div>}
        </div>
      })}
    </section>
    {selectedClass && <section className="panel"><div className="panel-head"><h3>{selectedClass.name} — {t('students')}</h3><span className="pill success">{members.length}</span></div>
      {members.length ? members.map(st => <div className="student-row" key={st.id}><div className="grow"><b>{st.full_name}</b><small>#{st.student_code}</small></div><span className={'pill ' + (st.is_active ? 'success' : 'warning')}>{st.is_active ? t('active') : t('inactive')}</span></div>) : <p className="muted">{t('noStudentsInClass')}</p>}
    </section>}
    <section className="panel"><h3>{t('unassignedStudents')}</h3>{unassigned.length ? unassigned.map(st => <div className="student-row" key={st.id}><div className="grow"><b>{st.full_name}</b><small>#{st.student_code}</small></div></div>) : <p className="muted">{t('none')}</p>}</section>
    {editingClass && canManage && <section className="panel"><h3>{t('classEdit')}</h3><form onSubmit={e => void update(e, editingClass.id)}>
      <label>{t('className')}<input required value={editName} onChange={e => setEditName(e.target.value)} /></label><label>{t('academicYear')}<input value={editYear} onChange={e => setEditYear(e.target.value)} /></label><label>{t('description')}<textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} /></label>
      <button className="primary" disabled={busy}>{t('save')}</button><button type="button" className="secondary" onClick={() => setEditingClass(null)}>{t('cancel')}</button>
    </form></section>}
  </>
}

function DailyStatus({ profile, t }: { profile: Profile; t: T }) {
  type AttendanceStatusRow = { id: string; student_id: string; status: string; session_date: string; start_at?: string | null; end_at?: string | null; notified_at?: string | null; actual_return_at?: string | null; duty_completed_at?: string | null }
  type RestrictionRow = { student_id: string; student_code: string; full_name: string; record_type: string; start_date: string | null; end_date: string | null }
  const [date, setDate] = useState(localDate())
  const [attendanceRows, setAttendanceRows] = useState<AttendanceStatusRow[]>([])
  const [restrictions, setRestrictions] = useState<RestrictionRow[]>([])
  const [roster, setRoster] = useState<Record<string, { student_code: string; full_name: string }>>({})
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    if (!isConfigured || !profile.institution_id || profile.role === 'owner') { setLoading(false); return }
    const [studentsRes, attendanceRes, restrictionRes] = await Promise.all([
      supabase.from('students').select('id,student_code,full_name').eq('institution_id', profile.institution_id),
      supabase.from('attendance_records').select('id,student_id,status,session_date,start_at,end_at,notified_at,actual_return_at,duty_completed_at')
        .eq('institution_id', profile.institution_id).eq('session_date', date)
        .neq('status', 'present').order('status'),
      supabase.rpc('get_active_student_restrictions', { p_on_date: date }),
    ])
    if (studentsRes.error) notify(studentsRes.error.message)
    if (attendanceRes.error) notify(attendanceRes.error.message)
    if (restrictionRes.error) notify(restrictionRes.error.message)
    const nextRoster: Record<string, { student_code: string; full_name: string }> = {}
    for (const student of (studentsRes.data ?? []) as { id: string; student_code: string; full_name: string }[]) {
      nextRoster[student.id] = { student_code: student.student_code, full_name: student.full_name }
    }
    setRoster(nextRoster)
    setAttendanceRows((attendanceRes.data ?? []) as AttendanceStatusRow[])
    setRestrictions((restrictionRes.data ?? []) as RestrictionRow[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.id, profile.institution_id, profile.role, date])

  const statusLabel = (status: string) => status === 'medical_exemption' ? t('medicalExemption') : t(status)
  const restrictionLabel = (kind: string) => kind === 'exemption' ? t('medicalExemption') : kind === 'permission' ? t('permission') : t('other')

  return (
    <>
      <Heading title={t('dailyStatus')} subtitle={t('dailyStatusHint')} />
      <section className="panel">
        <label>{t('date')}<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <div className="status-count-row">
          <span>{t('dailyAttendanceStatuses')}: <b>{attendanceRows.length}</b></span>
          <span>{t('activePermissionsExemptions')}: <b>{restrictions.length}</b></span>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>{t('dailyAttendanceStatuses')}</h3><span className="muted">{date}</span></div>
        {loading ? <Empty t={t} /> : attendanceRows.length === 0 ? <p className="muted">{t('noDailyStatuses')}</p> : (
          <div className="report-list">
            {attendanceRows.map((row) => {
              const student = roster[row.student_id]
              return <div className="report-row" key={row.id}>
                <div className="report-icon"><Activity size={17} /></div>
                <div className="grow"><b>{student ? `${student.student_code} · ${student.full_name}` : t('students')}</b><small>{row.session_date}{row.start_at ? ` · ${t('recordStart')}: ${formatDateTime(row.start_at)}` : ''}{row.end_at ? ` · ${t('recordEnd')}: ${formatDateTime(row.end_at)}` : ''}{row.notified_at ? ` · ${t('recordNotified')}: ${formatDateTime(row.notified_at)}` : ''}{row.actual_return_at ? ` · ${t('recordReturn')}: ${formatDateTime(row.actual_return_at)}` : ''}{row.duty_completed_at ? ` · ${t('dutyCompleted')}: ${formatDateTime(row.duty_completed_at)}` : ''}</small></div>
                <span className={`pill ${row.status === 'absent' ? 'warning' : 'success'}`}>{statusLabel(row.status)}</span>
              </div>
            })}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-head"><h3>{t('activePermissionsExemptions')}</h3><span className="muted">{t('autoExpiryHint')}</span></div>
        {loading ? <Empty t={t} /> : restrictions.length === 0 ? <p className="muted">{t('noActiveRestrictions')}</p> : (
          <div className="report-list">
            {restrictions.map((row, index) => <div className="report-row" key={`${row.student_id}-${row.record_type}-${index}`}>
              <div className="report-icon"><HeartPulse size={17} /></div>
              <div className="grow"><b>{row.student_code} · {row.full_name}</b><small>{row.start_date || '—'} → {row.end_date || '—'}</small></div>
              <span className="pill warning">{restrictionLabel(row.record_type)}</span>
            </div>)}
          </div>
        )}
      </section>
    </>
  )
}

function FollowUpQueue({ profile, t }: { profile: Profile; t: T }) {
  type FollowUpRow = {
    id: string
    student_id: string
    absences: number
    status: 'awaiting_return' | 'active' | 'completed'
    streak_end: string
    return_date: string | null
    sessions_seen: number
    handled_at: string | null
    last_follow_up_at: string | null
  }
  type FollowUpItem = {
    id: string
    studentId: string
    streak: number
    state: 'open' | 'returned'
    sessionsSinceReturn: number
    lastSessionDate: string
    lastAbsentDate: string
    handled: boolean
    lastFollowUpAt: string | null
  }
  const [items, setItems] = useState<FollowUpItem[]>([])
  const [names, setNames] = useState<Record<string, { student_code: string; full_name: string }>>({})
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const canAccess = profile.role !== 'owner' && Boolean(profile.institution_id)

  async function load() {
    setLoading(true)
    if (!isConfigured || !profile.institution_id || !canAccess) { setLoading(false); return }
    const institutionId = profile.institution_id
    const [studentsRes, followRes] = await Promise.all([
      supabase
        .from('students')
        .select('id,student_code,full_name')
        .eq('institution_id', institutionId),
      supabase
        .from('absence_followups')
        .select('id,student_id,absences,status,streak_end,return_date,sessions_seen,handled_at,last_follow_up_at')
        .eq('institution_id', institutionId)
        .in('status', ['awaiting_return', 'active'])
        .order('streak_end', { ascending: false }),
    ])
    if (studentsRes.error) notify(studentsRes.error.message)
    if (followRes.error) notify(followRes.error.message)
    const roster: Record<string, { student_code: string; full_name: string }> = {}
    for (const student of (studentsRes.data ?? []) as { id: string; student_code: string; full_name: string }[]) {
      roster[student.id] = { student_code: student.student_code, full_name: student.full_name }
    }
    setNames(roster)
    const rows = (followRes.data ?? []) as FollowUpRow[]
    setItems(rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      streak: row.absences,
      state: row.status === 'awaiting_return' ? 'open' : 'returned',
      sessionsSinceReturn: row.sessions_seen ?? 0,
      lastSessionDate: row.return_date ?? row.streak_end,
      lastAbsentDate: row.streak_end,
      handled: Boolean(row.handled_at),
      lastFollowUpAt: row.handled_at ?? row.last_follow_up_at,
    })))
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.institution_id, profile.id])

  async function markHandled(item: FollowUpItem) {
    if (!isConfigured || !profile.institution_id) { notify(t('configMissing')); return }
    setUpdating(item.id)
    const { error } = await supabase.rpc('mark_followup_handled', { p_id: item.id })
    setUpdating(null)
    if (error) { notify(error.message); return }
    await load()
    notify(t('savedOk'))
  }

  if (!canAccess) return <Denied t={t} />

  return (
    <>
      {loading ? <Empty t={t} /> : items.length === 0 ? (
        <p>{t('noFollowups')}</p>
      ) : (
        <section className="panel">
          <p className="muted">{t('followUpComputedHint')}</p>
          <div className="attendance-summary">
            {items.map((item) => {
              const student = names[item.studentId]
              return (
                <div key={item.id} className="attendance-row">
                  <div className="grow">
                    <b>{student?.full_name || item.studentId}</b>
                    <small>#{student?.student_code || '—'} · {item.streak} {t('absences')}</small>
                    {item.state === 'returned' && (
                      <small>{t('absenceReturned').replace('{n}', String(item.sessionsSinceReturn))}</small>
                    )}
                  </div>
                  <span className={`pill ${item.state === 'open' ? 'danger' : 'success'}`}>
                    {item.state === 'open' ? t('followUpOpen') : t('absenceReturnedShort')}
                  </span>
                  <span className={`pill ${item.handled ? 'success' : 'warning'}`}>
                    {item.handled ? t('markHandled') : t('followUpNone')}
                  </span>
                  <small>{t('lastFollowUp')}: {item.lastFollowUpAt ? formatDateTime(item.lastFollowUpAt) : t('never')}</small>
                  {!item.handled && (
                    <div className="action-btns">
                      <button className="secondary small" disabled={updating === item.id} onClick={() => { void markHandled(item) }}>{t('markFollowUpDone')}</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </>
  )
}

function InstitutionSettings({ profile, t }: { profile: Profile; t: T }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [language, setLanguage] = useState<Lang>('ar')
  const [logo, setLogo] = useState<File | null>(null)
  const [logoUrl, setLogoUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const director = profile.role === 'manager'
  const [confirmText, setConfirmText] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    if (!isConfigured || !profile.institution_id) { setLoading(false); return }
    const { data, error } = await supabase
      .from('institutions')
      .select('*')
      .eq('id', profile.institution_id)
      .maybeSingle()
    if (error) { notify(error.message); setLoading(false); return }
    const row = data as {
      name?: string; phone?: string; email?: string; address?: string
      default_language?: Lang; logo_path?: string | null
    } | null
    if (row) {
      setName(row.name || '')
      setPhone(row.phone || '')
      setEmail(row.email || '')
      setAddress(row.address || '')
      setLanguage(row.default_language || 'ar')
      if (row.logo_path) {
        const { data: link } = await supabase.storage.from('trainer-avatars').createSignedUrl(row.logo_path, 3600)
        setLogoUrl(link?.signedUrl || '')
      }
    }
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.institution_id])

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured || !profile.institution_id) { notify(t('configMissing')); return }
    setBusy(true)
    let logo_path: string | undefined
    if (logo) {
      const extension = logo.name.split('.').pop() || 'png'
      logo_path = `${profile.institution_id}/${profile.id}/institution-logo-${Date.now()}.${extension}`
      const { error: uploadError } = await supabase.storage
        .from('trainer-avatars')
        .upload(logo_path, logo, { contentType: logo.type, upsert: false })
      if (uploadError) { notify(uploadError.message); setBusy(false); return }
    }
    const payload: Record<string, string> = {
      name: name.trim(),
      phone,
      email,
      address,
      default_language: language,
    }
    if (logo_path) payload.logo_path = logo_path
    const { error } = await supabase.from('institutions').update(payload).eq('id', profile.institution_id)
    setBusy(false)
    if (error) { notify(error.message); return }
    notify(t('savedOk'))
    setLogo(null)
    await load()
  }

  // Manager-only deletion is confirmed by exact institution name and handled
  // transactionally by the production RPC. Former accounts are detached and
  // rejected; auth identities and audit history are retained.
  const deletionAvailable = Boolean(profile.institution_id && director)

  async function deleteInstitutionNow() {
    if (!deletionAvailable || !profile.institution_id || confirmText.trim() !== name.trim()) return
    setDeleting(true)
    const { data, error } = await supabase.functions.invoke('delete-institution', {
      body: { institution_id: profile.institution_id, confirmation_name: confirmText.trim() },
    })
    setDeleting(false)
    if (error || !(data as { deleted?: boolean } | null)?.deleted) {
      notify(error?.message || t('institutionDeleteFailed'))
      return
    }
    notify(t('institutionDeleteSuccess'))
    await supabase.auth.signOut()
    window.location.assign('/')
  }

  if (loading) return <Empty t={t} />

  return (
    <>
      <Heading title={t('settings')} />
      <section className="panel">
        <form onSubmit={save}>
          <label>{t('institution')}<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>{t('phone')}<input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label>{t('contactEmail')}<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>{t('address')}<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
          <label>{t('defaultLanguage')}
            <select value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
              <option value="ar">العربية</option>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          {logoUrl && <img className="institution-logo" src={logoUrl} alt={t('logo')} />}
          <label>{t('logo')}
            <input type="file" accept="image/png,image/jpeg,image/webp"
              onChange={(e) => { setLogo(e.target.files?.[0] ?? null); e.target.value = '' }} />
          </label>
          <button className="primary" disabled={busy}>{t('save')}</button>
        </form>
      </section>
      {director && (
        <section className="panel">
          <h3>{t('institutionDeleteTitle')}</h3>
          <p className="muted">{t('institutionDeleteWarning')}</p>
          <label>{t('institutionDeleteTyped')}<input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} disabled={!deletionAvailable} /></label>
          <button type="button" className="danger" disabled={!deletionAvailable || deleting || confirmText.trim() !== name.trim()} onClick={() => setConfirmOpen(true)}>{t('institutionDeleteButton')}</button>
          {confirmOpen && (
            <div className="panel">
              <p className="error-box">{t('institutionDeleteConfirm')}</p>
              <p className="muted">{t('institutionDeleteWarning')}</p>
              <button type="button" className="danger" disabled={deleting || confirmText.trim() !== name.trim()} onClick={() => { void deleteInstitutionNow() }}>{deleting ? t('loading') : t('institutionDeleteButton')}</button>
              <button type="button" className="secondary" disabled={deleting} onClick={() => setConfirmOpen(false)}>{t('cancel')}</button>
            </div>
          )}
        </section>
      )}
    </>
  )
}
function AcademicYears({ profile, t }: { profile: Profile; t: T }) {
  const isInstitutionAdmin = ['manager', 'admin'].includes(profile.role)
  const [years, setYears] = useState<{ id: string; institution_id: string; name: string; start_date: string | null; end_date: string | null; is_current: boolean; is_archived: boolean }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [enrolled, setEnrolled] = useState<{ student_id: string; student_code: string; full_name: string }[]>([])
  const [roster, setRoster] = useState<{ id: string; student_code: string; full_name: string }[]>([])
  const [yearName, setYearName] = useState('')
  const [yearStart, setYearStart] = useState('')
  const [yearEnd, setYearEnd] = useState('')

  async function load() {
    setLoading(true)
    if (!isConfigured || !profile.institution_id) { setLoading(false); return }
    const institutionId = profile.institution_id
    const { data, error } = await supabase
      .from('academic_years')
      .select('id,institution_id,name,start_date,end_date,is_current,is_archived')
      .eq('institution_id', institutionId)
      .order('start_date', { ascending: false, nullsFirst: false })
    if (error) notify(error.message)
    const list = (data ?? []) as { id: string; institution_id: string; name: string; start_date: string | null; end_date: string | null; is_current: boolean; is_archived: boolean }[]
    setYears(list)
    const current = list.find((y) => y.is_current) ?? null
    setSelectedId(current ? current.id : (list[0] ? list[0].id : null))
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.institution_id])

  async function loadEnrolled(yearId: string | null) {
    if (!yearId) { setEnrolled([]); return }
    const { data, error } = await supabase
      .from('student_academic_enrollments')
      .select('student_id,students(student_code,full_name)')
      .eq('academic_year_id', yearId)
      .order('student_id')
    if (error) notify(error.message)
    const rows = (data ?? []) as { student_id: string; students: unknown }[]
    setEnrolled(
      rows.map((r) => {
        const ref = Array.isArray(r.students) ? r.students[0] : (r.students as { student_code?: string; full_name?: string } | null)
        const code = ref?.student_code ?? ''
        const name = ref?.full_name ?? ''
        return { student_id: r.student_id, student_code: code, full_name: name }
      }),
    )
  }

  useEffect(() => { void loadEnrolled(selectedId) }, [selectedId])

  async function loadRoster() {
    if (!isConfigured || !profile.institution_id) return
    const institutionId = profile.institution_id
    const { data } = await supabase.from('students').select('id,student_code,full_name').eq('institution_id', institutionId).order('full_name')
    setRoster(((data ?? []) as { id: string; student_code: string; full_name: string }[]))
  }

  useEffect(() => { void loadRoster() }, [profile.institution_id])

  async function createYear(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured || !profile.institution_id) { notify(t('configMissing')); return }
    const institutionId = profile.institution_id
    if (!yearName.trim()) return
    setBusy(true)
    const { error: archiveError } = await supabase
      .from('academic_years')
      .update({ is_current: false, is_archived: true })
      .eq('institution_id', institutionId)
      .eq('is_current', true)
    if (archiveError) { setBusy(false); notify(archiveError.message); return }
    const { error } = await supabase.from('academic_years').insert({
      institution_id: institutionId,
      name: yearName.trim(),
      start_date: yearStart || null,
      end_date: yearEnd || null,
      is_current: true,
      is_archived: false,
    })
    setBusy(false)
    if (error) { notify(error.message); return }
    setYearName(''); setYearStart(''); setYearEnd('')
    await load()
  }

  async function archiveYear(id: string) {
    const { error } = await supabase.from('academic_years').update({ is_current: false, is_archived: true }).eq('id', id)
    if (error) { notify(error.message); return }
    await load()
  }

  async function enroll(studentId: string) {
    if (!selectedId || !profile.institution_id) return
    const institutionId = profile.institution_id
    const { error } = await supabase.from('student_academic_enrollments').insert({
      student_id: studentId,
      academic_year_id: selectedId,
      institution_id: institutionId,
    })
    if (error) { notify(error.message); return }
    await loadEnrolled(selectedId)
  }

  async function removeEnrollment(studentId: string) {
    if (!selectedId) return
    const { error } = await supabase.from('student_academic_enrollments').delete().eq('student_id', studentId).eq('academic_year_id', selectedId)
    if (error) { notify(error.message); return }
    await loadEnrolled(selectedId)
  }

  if (!isInstitutionAdmin) { return <Denied t={t} /> }

  return (
    <>
      <Heading title={t('academicYears')} subtitle={t('academicYearHint')} />
      <section className="panel">
        <h3>{t('createAcademicYear')}</h3>
        <form onSubmit={createYear}>
          <label>{t('academicYearName')}<input required value={yearName} onChange={(e) => setYearName(e.target.value)} /></label>
          <label>{t('academicYearStart')}<input type="date" value={yearStart} onChange={(e) => setYearStart(e.target.value)} /></label>
          <label>{t('academicYearEnd')}<input type="date" value={yearEnd} onChange={(e) => setYearEnd(e.target.value)} /></label>
          <button className="primary" disabled={busy}>{t('save')}</button>
        </form>
      </section>
      <section className="panel">
        <h3>{t('currentYear')}</h3>
        {loading ? <Empty t={t} /> : years.filter((y) => y.is_current).length === 0 ? <p className="muted">{t('noAcademicYears')}</p> : years.filter((y) => y.is_current).map((y) => (
          <div className="student-row" key={y.id}>
            <div className="grow"><b>{y.name}</b><small>{y.start_date ?? '-'} → {y.end_date ?? '-'}</small></div>
            <button className="secondary small" onClick={() => archiveYear(y.id)}>{t('archiveYear')}</button>
          </div>
        ))}
        <h3>{t('archivedYear')}</h3>
        {years.filter((y) => y.is_archived).length === 0 ? <p className="muted">{t('noAcademicYears')}</p> : years.filter((y) => y.is_archived).map((y) => (
          <div className="student-row" key={y.id}>
            <div className="grow"><b>{y.name}</b><small>{y.start_date ?? '-'} → {y.end_date ?? '-'}</small></div>
          </div>
        ))}
      </section>
      {selectedId && (
        <section className="panel">
          <h3>{t('enrolledStudents')}</h3>
          {enrolled.length === 0 ? <p className="muted">{t('noData')}</p> : enrolled.map((e) => (
            <div className="student-row" key={e.student_id}>
              <div className="grow"><b>{e.full_name}</b><small>{e.student_code}</small></div>
              <button className="danger small" onClick={() => removeEnrollment(e.student_id)}>{t('removeEnrollment')}</button>
            </div>
          ))}
          <h3>{t('addStudentToYear')}</h3>
          {roster.length === 0 ? <p className="muted">{t('noData')}</p> : roster.filter((r) => !enrolled.some((e) => e.student_id === r.id)).map((r) => (
            <div className="student-row" key={r.id}>
              <div className="grow"><b>{r.full_name}</b><small>{r.student_code}</small></div>
              <button className="secondary small" onClick={() => enroll(r.id)}>{t('addStudentToYear')}</button>
            </div>
          ))}
        </section>
      )}
    </>
  )
}

function Audit({ t }: { t: T }) {
  const [items, setItems] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState('')
  const [tableName, setTableName] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')

  async function load(filters?: { action: string; table: string; from: string; to: string }) {
    setLoading(true)
    if (!isConfigured) { setLoading(false); return }
    const actionValue = filters ? filters.action : action
    const tableValue = filters ? filters.table : tableName
    const fromValue = filters ? filters.from : fromDate
    const toValue = filters ? filters.to : toDate
    let query = supabase
      .from('audit_logs')
      .select('*,profiles(full_name)')
      .order('created_at', { ascending: false })
      .limit(100)
    if (actionValue.trim()) query = query.ilike('action', `%${actionValue.trim()}%`)
    if (tableValue.trim()) query = query.eq('table_name', tableValue.trim())
    if (fromValue) query = query.gte('created_at', `${fromValue}T00:00:00`)
    if (toValue) query = query.lte('created_at', `${toValue}T23:59:59`)
    const { data, error } = await query
    if (error) notify(error.message)
    setItems((data ?? []) as AuditRow[])
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  function clearFilters() {
    setAction('')
    setTableName('')
    setFromDate('')
    setToDate('')
    void load({ action: '', table: '', from: '', to: '' })
  }

  return (
    <>
      <Heading title={t('audit')} subtitle={t('activityLog')} />
      <section className="panel">
        <form onSubmit={(e) => { e.preventDefault(); void load() }}>
          <label>{t('action')}<input value={action} onChange={(e) => setAction(e.target.value)} placeholder={t('all')} /></label>
          <label>{t('entity')}<input value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder={t('all')} /></label>
          <label>{t('fromDate')}<input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} /></label>
          <label>{t('toDate')}<input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} /></label>
          <div className="heading-actions">
            <button className="primary" disabled={loading}>{t('filter')}</button>
            <button type="button" className="secondary" onClick={clearFilters}>{t('clear')}</button>
          </div>
        </form>
      </section>
      {loading ? <Empty t={t} /> : items.length === 0 ? <Empty t={t} /> : (
        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('actor')}</th>
                  <th>{t('entity')}</th>
                  <th>{t('action')}</th>
                  <th>{t('records')}</th>
                  <th>{t('previousValue')}</th>
                  <th>{t('newValue')}</th>
                  <th>{t('date')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <tr key={row.id}>
                    <td>{row.profiles?.full_name || row.actor_id || '—'}</td>
                    <td>{row.table_name}</td>
                    <td>{row.action}</td>
                    <td>{row.record_id || '—'}</td>
                    <td title={row.old_data ? JSON.stringify(row.old_data) : ''}>
                      {row.old_data ? JSON.stringify(row.old_data).slice(0, 60) : '—'}
                    </td>
                    <td title={row.new_data ? JSON.stringify(row.new_data) : ''}>
                      {row.new_data ? JSON.stringify(row.new_data).slice(0, 60) : '—'}
                    </td>
                    <td>{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  )
}
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  maxAlternatives: number
  onresult: (event: { results?: { [index: number]: { [index: number]: { transcript?: string } } } }) => void
  onerror: () => void
  start: () => void
}

function DictateButton({ onText, t }: { onText: (text: string) => void; t: T }) {
  function start() {
    const scope = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }
    const Recognition = scope.SpeechRecognition || scope.webkitSpeechRecognition
    if (!Recognition) { notify(t('errorGeneric')); return }
    try {
      const recognition = new Recognition()
      recognition.lang = document.documentElement.lang === 'ar'
        ? 'ar-TN'
        : document.documentElement.lang === 'fr' ? 'fr-FR' : 'en-US'
      recognition.interimResults = false
      recognition.maxAlternatives = 1
      recognition.onresult = (event) => {
        const text = event.results?.[0]?.[0]?.transcript
        if (text) onText(text)
      }
      recognition.onerror = () => notify(t('micError'))
      recognition.start()
    } catch {
      notify(t('micError'))
    }
  }
  return (
    <button type="button" className="secondary dictation-btn" onClick={start}>
      <Mic size={15} /> {t('recordVoice')}
    </button>
  )
}

function Modal({ title, close, children, closeLabel }: {
  title: string
  close: () => void
  children: ReactNode
  closeLabel?: string
}) {
  const dialogRef = useRef<HTMLElement | null>(null)
  const closeRef = useRef(close)
  closeRef.current = close

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialogRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="modal-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) closeRef.current()
    }}>
      <section className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={dialogRef}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label={closeLabel || 'Close'} onClick={() => closeRef.current()}>
            <X />
          </button>
        </div>
        {children}
      </section>
    </div>
  )
}


function ManagementReports({ profile, t }: { profile: Profile; t: T }) {
  type Template = { id: string; name: string | null; file_name: string; file_path: string; version: number; form_fields: WordInputField[]; instructions: string | null }
  type Report = { id: string; template_name_snapshot: string; template_file_path_snapshot: string; template_file_name_snapshot: string; coach_name_snapshot: string; report_date: string; status: string; responses: Record<string,string>; form_fields_snapshot: WordInputField[]; created_at: string }
  const isCoach = profile.role === 'coach'
  const [template, setTemplate] = useState<Template | null>(null)
  const [reports, setReports] = useState<Report[]>([])
  const [responses, setResponses] = useState<Record<string,string>>({})
  const [editorFields, setEditorFields] = useState<WordInputField[]>([])
  const [previewHtml, setPreviewHtml] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewReportHtml, setPreviewReportHtml] = useState('')
  const [reportDate, setReportDate] = useState(localDate())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  async function load() {
    setLoading(true)
    if (!isConfigured || !profile.institution_id) { setLoading(false); return }
    if (isCoach) {
      const [templateRes, reportsRes] = await Promise.all([
        supabase.from('report_templates').select('id,name,file_name,file_path,version,form_fields,instructions').eq('institution_id', profile.institution_id).eq('is_current', true).eq('is_archived', false).maybeSingle(),
        supabase.from('template_reports').select('id,template_name_snapshot,template_file_path_snapshot,template_file_name_snapshot,coach_name_snapshot,report_date,status,responses,form_fields_snapshot,created_at').eq('coach_id', profile.id).order('created_at', { ascending: false }),
      ])
      if (templateRes.error) notify(templateRes.error.message)
      if (reportsRes.error) notify(reportsRes.error.message)
      setTemplate(templateRes.data as Template | null)
      setReports((reportsRes.data ?? []) as Report[])
    } else {
      const { data, error } = await supabase.from('template_reports').select('id,template_name_snapshot,template_file_path_snapshot,template_file_name_snapshot,coach_name_snapshot,report_date,status,responses,form_fields_snapshot,created_at').eq('institution_id', profile.institution_id).order('created_at', { ascending: false })
      if (error) notify(error.message)
      setReports((data ?? []) as Report[])
    }
    setLoading(false)
  }
  useEffect(() => { void load() }, [profile.id, profile.institution_id, profile.role])

  async function openDraft(row?: Report) {
    const sourcePath = row?.template_file_path_snapshot || template?.file_path
    if (!sourcePath) { notify(t('noActiveManagementTemplate')); return }
    setBusy(true)
    const { data, error } = await supabase.storage.from('trainer-report-templates').download(sourcePath)
    if (error || !data) { setBusy(false); notify(error?.message || t('errorGeneric')); return }
    try {
      const result = inspectWordTemplate(await data.arrayBuffer(), row?.responses || {}, true)
      const fields = row?.form_fields_snapshot?.length ? row.form_fields_snapshot : result.fields
      if (!fields.length) { setBusy(false); notify(t('templateFieldsNotConfigured')); return }
      setEditorFields(fields)
      setPreviewHtml(result.html)
      setEditingId(row?.id || null)
      setResponses(row?.responses || {})
      setReportDate(row?.report_date || localDate())
      setFormOpen(true)
    } catch (error) {
      notify(error instanceof Error ? error.message : t('errorGeneric'))
    }
    setBusy(false)
  }

  function collectEditorValues() {
    if (editorRef.current) setResponses(readWordFieldValues(editorRef.current))
    return editorRef.current ? readWordFieldValues(editorRef.current) : responses
  }

  async function saveDraft() {
    const currentResponses = collectEditorValues()
    if (!profile.institution_id || !isCoach || (!template && !editingId)) return
    const missing = missingRequiredWordFields(editorFields, currentResponses)
    if (missing.length) { notify(`${t('requiredWordFieldsMissing')}: ${missing.map((field) => field.label).join('، ')}`); return }
    setBusy(true)
    const payload = { institution_id: profile.institution_id, template_id: template?.id, template_version: template?.version || 1,
      template_name_snapshot: template?.name || template?.file_name || reports.find((item) => item.id === editingId)?.template_name_snapshot || t('managementReports'),
      template_file_path_snapshot: template?.file_path || reports.find((item) => item.id === editingId)?.template_file_path_snapshot,
      template_file_name_snapshot: template?.file_name || reports.find((item) => item.id === editingId)?.template_file_name_snapshot,
      form_fields_snapshot: editorFields, coach_id: profile.id, coach_name_snapshot: profile.full_name,
      report_date: reportDate, responses: currentResponses, status: 'draft', is_finalized: false }
    const result = editingId
      ? await supabase.from('template_reports').update({ responses: currentResponses, report_date: reportDate }).eq('id', editingId).eq('status', 'draft').select('id')
      : await supabase.from('template_reports').insert(payload).select('id')
    setBusy(false)
    if (result.error) { notify(result.error.message); return }
    const savedId = (result.data as { id: string }[] | null)?.[0]?.id
    if (!savedId) { notify(t('noPermission')); return }
    setEditingId(savedId)
    notify(t('draftSaved')); await load()
  }

  async function submitDraft() {
    const currentResponses = collectEditorValues()
    if (!profile.institution_id || (!template && !editingId)) return
    const missing = missingRequiredWordFields(editorFields, currentResponses)
    if (missing.length) { notify(`${t('requiredWordFieldsMissing')}: ${missing.map((field) => field.label).join('، ')}`); return }
    setBusy(true)
    let reportId = editingId
    if (reportId) {
      const saved = await supabase.from('template_reports').update({ responses: currentResponses, report_date: reportDate }).eq('id', reportId).eq('status', 'draft').select('id')
      if (saved.error || !affectedRows(saved.data)) { setBusy(false); notify(saved.error?.message || t('noPermission')); return }
    } else {
      const payload = { institution_id: profile.institution_id, template_id: template!.id, template_version: template!.version,
        template_name_snapshot: template!.name || template!.file_name, template_file_path_snapshot: template!.file_path,
        template_file_name_snapshot: template!.file_name, form_fields_snapshot: editorFields, coach_id: profile.id,
        coach_name_snapshot: profile.full_name, report_date: reportDate, responses: currentResponses, status: 'draft', is_finalized: false }
      const created = await supabase.from('template_reports').insert(payload).select('id').single()
      if (created.error || !created.data) { setBusy(false); notify(created.error?.message || t('noPermission')); return }
      reportId = (created.data as { id: string }).id
    }
    const { error } = await supabase.rpc('submit_template_report', { p_report_id: reportId })
    setBusy(false)
    if (error) { notify(error.message); return }
    notify(t('reportSubmitted')); setEditingId(null); setFormOpen(false); setResponses({}); setPreviewHtml(''); await load()
  }

  async function getFilledDocument(row: Report): Promise<Blob | null> {
    const { data, error } = await supabase.storage.from('trainer-report-templates').download(row.template_file_path_snapshot)
    if (error || !data) { notify(error?.message || t('errorGeneric')); return null }
    try {
      const { renderReportTemplate } = await import('./lib/report-template-render')
      const input: TemplateReportInput = {
        coachName: row.coach_name_snapshot, reportDate: row.report_date,
        counts: { present_count: 0, absent_count: 0, late_count: 0, injured_count: 0, excused_count: 0 },
      }
      return await renderReportTemplate(await data.arrayBuffer(), input, row.responses || {})
    } catch (error) {
      notify(error instanceof Error ? error.message : t('errorGeneric'))
      return null
    }
  }

  async function downloadReport(row: Report) {
    setBusy(true)
    const blob = await getFilledDocument(row)
    setBusy(false)
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = templateExportFileName(row.coach_name_snapshot, row.report_date)
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function previewReport(row: Report) {
    setBusy(true)
    const { data, error } = await supabase.storage.from('trainer-report-templates').download(row.template_file_path_snapshot)
    if (error || !data) { setBusy(false); notify(error?.message || t('errorGeneric')); return }
    try {
      const result = inspectWordTemplate(await data.arrayBuffer(), row.responses || {}, false)
      setPreviewReportHtml(result.html)
      setPreviewOpen(true)
    } catch (error) { notify(error instanceof Error ? error.message : t('errorGeneric')) }
    setBusy(false)
  }

  async function review(row: Report) {
    if (!window.confirm(t('reviewReportConfirm'))) return
    setBusy(true)
    const { data, error } = await supabase.from('template_reports').update({ status: 'reviewed', reviewed_by: profile.id }).eq('id', row.id).eq('status', 'submitted').select('id')
    setBusy(false)
    if (error) { notify(error.message); return }
    if (!affectedRows(data)) { notify(t('noPermission')); return }
    await load()
  }

  const currentFields = template?.form_fields || []
  return <>
    <Heading title={t('managementReports')} subtitle={isCoach ? t('managementReportsCoachHint') : t('managementReportsAdminHint')} />
    {isCoach && <section className="panel">
      <h3>{template ? (template.name || template.file_name) : t('noActiveManagementTemplate')}</h3>
      {template?.instructions && <p className="muted">{template.instructions}</p>}
      {!template ? <p className="muted">{t('noActiveManagementTemplate')}</p> : currentFields.length === 0 ? <p className="muted">{t('templateFieldsNotConfigured')}</p> : <button className="primary" disabled={busy} onClick={() => { void openDraft() }}>{t('newManagementReport')}</button>}
      {formOpen && <section className="word-report-editor panel" style={{marginTop:14}}>
        <div className="panel-head"><h3>{template?.name || template?.file_name || t('managementReports')}</h3><span className="muted">{t('wordTemplateEditorHint')}</span></div>
        <label>{t('date')}<input type="date" value={reportDate} onChange={e => setReportDate(e.target.value)} /></label>
        <div ref={editorRef} className="word-document-preview" dir="auto" onInput={() => { collectEditorValues() }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        <div className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => void saveDraft()}>{t('saveDraft')}</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void submitDraft()}>{t('submitFinalReport')}</button>
          <button type="button" className="secondary" onClick={() => { setEditingId(null); setFormOpen(false); setResponses({}); setPreviewHtml('') }}>{t('cancel')}</button>
        </div>
      </section>}
    </section>}
    <section className="panel"><h3>{isCoach ? t('myManagementReports') : t('managementReportsInbox')}</h3>
      {loading ? <Empty t={t} /> : reports.length === 0 ? <p className="muted">{t('noManagementReports')}</p> : reports.map(row => <article className="student-row" key={row.id}>
        <div className="grow"><b>{row.template_name_snapshot}</b><small>{row.coach_name_snapshot} · {row.report_date}</small><small>{row.form_fields_snapshot.map(f => `${f.label}: ${row.responses?.[f.key] || '—'}`).join(' | ')}</small></div>
        <span className={'pill ' + (row.status === 'reviewed' ? 'success' : 'warning')}>{t(row.status)}</span>
        {isCoach && row.status === 'draft' && <button className="secondary small" disabled={busy} onClick={() => { void openDraft(row) }}>{t('continueDraft')}</button>}
        <button className="secondary small" disabled={busy} onClick={() => { void previewReport(row) }}>{t('previewWordReport')}</button>
        {row.status !== 'draft' && <button className="secondary small" disabled={busy} onClick={() => { void downloadReport(row) }}>{t('downloadWordReport')}</button>}
        {!isCoach && row.status === 'submitted' && <button className="primary small" disabled={busy} onClick={() => void review(row)}>{t('markReviewed')}</button>}
      </article>)}
    </section>
    {previewOpen && <Modal title={t('previewWordReport')} close={() => setPreviewOpen(false)} closeLabel={t('close')}>
      <div className="word-document-preview" dir="auto" dangerouslySetInnerHTML={{ __html: previewReportHtml }} />
    </Modal>}
  </>
}

function ReportTemplates({ profile, t }: { profile: Profile; t: T }) {
  const [items, setItems] = useState<{
    id: string; institution_id: string; name: string | null; file_name: string;
    file_path: string; version: number; is_current: boolean; is_archived: boolean;
    description: string | null; instructions: string | null; form_fields: { key: string; label: string; required: boolean }[]; created_at: string;
  }[]>([])
  const [loading, setLoading] = useState(true)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    if (!isConfigured || !profile.institution_id) { setLoading(false); return }
    const { data, error } = await supabase
      .from('report_templates')
      .select('id,institution_id,name,file_name,file_path,version,is_current,is_archived,description,instructions,form_fields,created_at')
      .eq('institution_id', profile.institution_id)
      .order('created_at', { ascending: false })
    if (error) notify(error.message)
    setItems((data ?? []) as typeof items)
    setLoading(false)
  }

  useEffect(() => { void load() }, [profile.institution_id])

  function reset() { setName(''); setDescription(''); setInstructions(''); setFile(null); setEditing(null) }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!isConfigured || !profile.institution_id) { notify(t('configMissing')); return }
    if (!name.trim()) { notify(t('templateName')); return }
    if (!file && !editing) { notify(t('selectDocx')); return }
    setBusy(true)
    const currentMax = items.reduce((m, x) => Math.max(m, x.version || 1), 0)
    const nextVersion = editing ? (items.find(x => x.id === editing)?.version || 1) : currentMax + 1
    let filePath: string | null = null
    let detectedFields: WordInputField[] | null = null
    let safeFileName = ''
    if (file) {
      const ext = (file.name.split('.').pop() || '').toLowerCase()
      if (ext !== 'docx') { notify(t('selectDocx')); setBusy(false); return }
      if (file.size > 10 * 1024 * 1024) { notify(t('fileTooLarge')); setBusy(false); return }
      safeFileName = file.name.replace(/[\\/\0-\x1f]/g, '_').replace(/\.\.+/g, '.')
      try {
        detectedFields = inspectWordTemplate(await file.arrayBuffer(), {}, false).fields
      } catch (error) {
        notify(error instanceof Error ? error.message : t('errorGeneric')); setBusy(false); return
      }
      if (!detectedFields.length) { notify(t('templateFieldsNotConfigured')); setBusy(false); return }
      const id = crypto.randomUUID()
      filePath = profile.institution_id + '/report-templates/' + id + '/v' + nextVersion + '/' + safeFileName
      const { error: upErr } = await supabase.storage.from('trainer-report-templates').upload(filePath, file, { upsert: false, contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      if (upErr) { notify(upErr.message); setBusy(false); return }
    }
    if (editing) {
      const { data, error } = await supabase.from('report_templates').update({
        name: name.trim(), description: description.trim() || null,
        instructions: instructions.trim() || null,
      }).eq('id', editing).eq('institution_id', profile.institution_id).select('id')
      setBusy(false)
      if (error) { notify(error.message); return }
      if (!affectedRows(data)) { notify(t('templateUpdateFailed')); return }
      notify(t('templateUpdated'))
    } else {
      // Insert inactive first, then move the "current" flag in a second step.
      // The partial unique index allows only one current template per
      // institution, so inserting as current while another one is active fails.
      const { data, error } = await supabase.from('report_templates').insert({
        institution_id: profile.institution_id,
        name: name.trim(),
        file_name: safeFileName,
        file_path: filePath!,
        version: nextVersion,
        is_current: false,
        description: description.trim() || null,
        instructions: instructions.trim() || null,
        form_fields: detectedFields || [],
        is_archived: false,
      }).select('id').single()
      if (error) {
        if (filePath) { try { await supabase.storage.from('trainer-report-templates').remove([filePath]) } catch { /* best-effort cleanup */ } }
        setBusy(false); notify(error.message); return
      }
      const newId = (data as { id?: string } | null)?.id
      const cleared = await supabase.from('report_templates')
        .update({ is_current: false })
        .eq('institution_id', profile.institution_id)
        .neq('id', newId ?? '')
      if (cleared.error) { setBusy(false); notify(cleared.error.message); return }
      const activated = newId
        ? await supabase.from('report_templates').update({ is_current: true }).eq('id', newId)
        : { error: { message: t('templateUploadFailed') } }
      setBusy(false)
      if (activated.error) { notify(activated.error.message); return }
      notify(t('templateUploaded'))
    }
    reset()
    setShow(false)
    await load()
  }

  async function toggleActive(row: typeof items[number]) {
    if (!isConfigured) return
    setBusy(true)
    if (!row.is_current) {
      const cleared = await supabase.from('report_templates').update({ is_current: false })
        .eq('institution_id', profile.institution_id)
      if (cleared.error) { setBusy(false); notify(cleared.error.message); return }
      const activated = await supabase.from('report_templates').update({ is_current: true }).eq('id', row.id).select('id')
      if (activated.error) { setBusy(false); notify(activated.error.message); return }
      if (!affectedRows(activated.data)) { setBusy(false); notify(t('templateUpdateFailed')); return }
    } else {
      const { error } = await supabase.from('report_templates').update({ is_current: false }).eq('id', row.id)
      if (error) { setBusy(false); notify(error.message); return }
    }
    setBusy(false)
    await load()
  }

  async function archive(row: typeof items[number]) {
    if (!window.confirm(t('archive'))) return
    setBusy(true)
    const { data, error } = await supabase
      .from('report_templates')
      .update({ is_archived: true, is_current: false })
      .eq('id', row.id)
      .select('id')
    setBusy(false)
    if (error) { notify(error.message); return }
    if (!affectedRows(data)) { notify(t('templateUpdateFailed')); return }
    notify(t('templateArchived'))
    await load()
  }

  function startEdit(row: typeof items[number]) {
    setEditing(row.id)
    setName(row.name || row.file_name)
    setDescription(row.description || '')
    setInstructions(row.instructions || '')
    setFile(null)
    setShow(true)
  }

  const active = items.filter(x => !x.is_archived)
  const archived = items.filter(x => x.is_archived)

  return (
    <>
      <Heading title={t('templates')} action={
        <button className="primary action-btn" onClick={() => { reset(); setShow(true) }}>
          <Plus size={18} /> {t('uploadTemplate')}
        </button>
      } />
      {loading ? <Empty t={t} /> : items.length === 0 ? <Empty t={t} /> : (
        <section className="panel">
          <h3>{t('templates')}</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('templateName')}</th>
                  <th>{t('templateVersion')}</th>
                  <th>{t('status')}</th>
                  <th>{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {active.map(row => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.name || row.file_name}</b>
                      {row.description && <small className="muted" style={{display:'block'}}>{row.description}</small>}
                      {row.instructions && <small className="muted" style={{display:'block'}}>{row.instructions}</small>}
                    </td>
                    <td>v{row.version}</td>
                    <td><span className={"pill " + (row.is_current ? 'success' : 'warning')}>{row.is_current ? t('active') : t('inactive')}</span></td>
                    <td>
                      <button className="secondary" onClick={() => startEdit(row)}>{t('edit')}</button>
                      <button className="secondary" onClick={() => { void toggleActive(row) }} disabled={busy}>
                        {row.is_current ? t('deactivateTemplate') : t('activateTemplate')}
                      </button>
                      <button className="danger" onClick={() => { void archive(row) }} disabled={busy}>{t('archiveTemplate')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {archived.length > 0 && (
            <>
              <h3 style={{marginTop:16}}>{t('versionHistory')}</h3>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>{t('templateName')}</th><th>{t('templateVersion')}</th><th>{t('status')}</th></tr></thead>
                  <tbody>
                    {archived.map(row => (
                      <tr key={row.id}>
                        <td>{row.name || row.file_name}</td>
                        <td>v{row.version}</td>
                        <td><span className="pill">{t('archived')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}

      {show && (
        <Modal title={t('uploadTemplate')} close={() => { setShow(false); reset() }} closeLabel={t('close')}>
          <form onSubmit={save}>
            <label>{t('templateName')}
              <input required value={name} onChange={e => setName(e.target.value)} />
            </label>
            <label>{t('templateDescription')}
              <textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} />
            </label>
            <label>{t('templateInstructions')}
              <textarea rows={3} value={instructions} onChange={e => setInstructions(e.target.value)} />
            </label>
            <div className="notice-box">
              <b>{t('wordTemplateEditorHint')}</b>
              <p>{t('wordTemplateFieldsHint')}</p>
              <div className="template-tags">
                <code>{'{input_notes}'}</code>
                <code>{'{input_required_observations}'}</code>
              </div>
              <small className="muted">{t('templateExportHint')}</small>
            </div>
            {!editing && (
              <label>{t('selectDocx')}
                <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/octet-stream,*/*" onChange={e => { const selected = e.currentTarget.files?.[0] ?? null; setFile(selected); e.currentTarget.value = '' }} />
                {file && <div className="notice-box selected-upload-file"><b>{file.name}</b><small>{(file.size / 1024).toFixed(1)} KB · DOCX</small></div>}
                {!file && <small className="muted">{t('selectDocx')}</small>}
              </label>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={() => { setShow(false); reset() }}>{t('cancel')}</button>
              <button className="primary" disabled={busy}>{busy ? t('loading') : t('save')}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}
