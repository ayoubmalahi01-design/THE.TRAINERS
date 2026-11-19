-- Applied to production project rxkyryaplszuklagvidi on 2026-11-19.
-- Per-message read receipts are scoped to members of the conversation.

DROP POLICY IF EXISTS message_reads_select ON public.message_reads;
CREATE POLICY message_reads_select
ON public.message_reads FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_reads.message_id
      AND public.is_conversation_member(m.conversation_id)
      AND (message_reads.reader_id = auth.uid() OR m.sender_id = auth.uid())
  )
);

DROP POLICY IF EXISTS message_reads_insert_own ON public.message_reads;
CREATE POLICY message_reads_insert_own
ON public.message_reads FOR INSERT TO authenticated
WITH CHECK (
  reader_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_reads.message_id
      AND public.is_conversation_member(m.conversation_id)
  )
);

DROP POLICY IF EXISTS message_reads_update_own ON public.message_reads;

CREATE OR REPLACE FUNCTION public.mark_conversation_read(p_conversation_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT public.is_conversation_member(p_conversation_id) THEN
    RAISE EXCEPTION 'Not a conversation member';
  END IF;
  INSERT INTO public.message_reads (message_id, reader_id, read_at)
  SELECT m.id, auth.uid(), now()
  FROM public.messages m
  WHERE m.conversation_id = p_conversation_id AND m.sender_id <> auth.uid()
  ON CONFLICT (message_id, reader_id) DO NOTHING;
  UPDATE public.conversation_members SET last_read_at = now()
  WHERE conversation_id = p_conversation_id AND profile_id = auth.uid();
END;
$function$;

CREATE OR REPLACE FUNCTION public.unread_counts()
RETURNS TABLE(conversation_id uuid, unread bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT m.conversation_id, count(*)::bigint
  FROM public.messages m
  JOIN public.conversation_members cm
    ON cm.conversation_id = m.conversation_id AND cm.profile_id = auth.uid()
  WHERE auth.uid() IS NOT NULL
    AND m.sender_id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.message_reads mr
      WHERE mr.message_id = m.id AND mr.reader_id = auth.uid()
    )
  GROUP BY m.conversation_id;
$function$;

REVOKE ALL ON FUNCTION public.mark_conversation_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_conversation_read(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.unread_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unread_counts() TO authenticated;

DO $publication$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
  END IF;
END;
$publication$;
