-- Sprint P4a: Help Center tables
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/gunkzxyefspmvytiwcwy/sql

CREATE TABLE IF NOT EXISTS public.help_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.help_topics (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES public.help_categories(id) ON DELETE RESTRICT,
  title       text NOT NULL,
  slug        text NOT NULL UNIQUE,
  content     text NOT NULL DEFAULT '',
  position    integer NOT NULL DEFAULT 0,
  published   boolean NOT NULL DEFAULT false,
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.help_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.help_topics     TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.help_categories TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.help_topics     TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- RLS
ALTER TABLE public.help_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.help_topics     ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read
CREATE POLICY "help_categories_select" ON public.help_categories
  FOR SELECT TO authenticated USING (true);

-- Admin-only write
CREATE POLICY "help_categories_admin_insert" ON public.help_categories
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin = true));

CREATE POLICY "help_categories_admin_update" ON public.help_categories
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin = true));

CREATE POLICY "help_categories_admin_delete" ON public.help_categories
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin = true));

-- All authenticated users can read topics
CREATE POLICY "help_topics_select" ON public.help_topics
  FOR SELECT TO authenticated USING (true);

-- Admin-only write
CREATE POLICY "help_topics_admin_insert" ON public.help_topics
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin = true));

CREATE POLICY "help_topics_admin_update" ON public.help_topics
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin = true));

CREATE POLICY "help_topics_admin_delete" ON public.help_topics
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_admin = true));
