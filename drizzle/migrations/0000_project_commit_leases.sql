CREATE TABLE public.project_commit_leases (
 project_id uuid PRIMARY KEY REFERENCES public.code_projects(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,
 lease_id uuid NOT NULL DEFAULT gen_random_uuid(),
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes')
);
GRANT ALL ON public.project_commit_leases TO service_role;
ALTER TABLE public.project_commit_leases ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.begin_project_commit(p_project_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_owner uuid; v_lease uuid;
BEGIN
 SELECT user_id INTO v_owner FROM public.code_projects WHERE id = p_project_id FOR UPDATE;
 IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Projeto não autorizado'; END IF;
 IF EXISTS(SELECT 1 FROM public.project_commit_leases WHERE project_id = p_project_id AND expires_at > now()) THEN RAISE EXCEPTION 'Commit em andamento; aguarde a conclusão'; END IF;
 DELETE FROM public.project_commit_leases WHERE project_id = p_project_id AND expires_at <= now();
 INSERT INTO public.project_commit_leases(project_id,user_id) VALUES(p_project_id,v_owner) RETURNING lease_id INTO v_lease;
 RETURN v_lease;
END $$;
REVOKE ALL ON FUNCTION public.begin_project_commit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_project_commit(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_project_commit(p_project_id uuid,p_lease_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$ BEGIN
 DELETE FROM public.project_commit_leases WHERE project_id = p_project_id AND lease_id = p_lease_id AND user_id = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.release_project_commit(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_project_commit(uuid,uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_project_commit(p_project_id uuid,p_lease_id uuid,p_sha text,p_files jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE f jsonb;
BEGIN
 PERFORM 1 FROM public.project_commit_leases WHERE project_id = p_project_id AND lease_id = p_lease_id AND user_id = auth.uid() AND expires_at > now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Reserva de commit inválida ou expirada'; END IF;
 IF p_sha IS NULL OR length(p_sha) NOT BETWEEN 7 AND 64 OR jsonb_typeof(p_files) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Resultado de commit inválido'; END IF;
 FOR f IN SELECT value FROM jsonb_array_elements(p_files) LOOP
   IF (f->>'deleted')::boolean THEN
     DELETE FROM public.code_files WHERE id = (f->>'id')::uuid AND project_id = p_project_id AND user_id = auth.uid() AND deleted = true AND updated_at = (f->>'updated_at')::timestamptz;
     UPDATE public.code_files SET base_content = NULL WHERE id = (f->>'id')::uuid AND project_id = p_project_id AND user_id = auth.uid();
   ELSE
     UPDATE public.code_files SET base_content = f->>'content' WHERE id = (f->>'id')::uuid AND project_id = p_project_id AND user_id = auth.uid();
   END IF;
 END LOOP;
 UPDATE public.code_projects SET base_sha = p_sha, updated_at = now() WHERE id = p_project_id AND user_id = auth.uid();
 DELETE FROM public.project_commit_leases WHERE project_id = p_project_id AND lease_id = p_lease_id AND user_id = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.complete_project_commit(uuid,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_project_commit(uuid,uuid,text,jsonb) TO authenticated;