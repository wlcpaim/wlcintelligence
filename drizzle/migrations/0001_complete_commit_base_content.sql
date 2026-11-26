-- Corrige complete_project_commit: base_content deve sempre sincronizar após commit
-- bem-sucedido, senão o contador de "alterações pendentes" nunca zera.

CREATE OR REPLACE FUNCTION public.complete_project_commit(
  p_project_id uuid,
  p_lease_id uuid,
  p_sha text,
  p_files jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE f jsonb;
BEGIN
  PERFORM 1 FROM public.project_commit_leases
    WHERE project_id = p_project_id
      AND lease_id = p_lease_id
      AND user_id = auth.uid()
      AND expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reserva de commit inválida ou expirada';
  END IF;
  IF p_sha IS NULL OR length(p_sha) NOT BETWEEN 7 AND 64 OR jsonb_typeof(p_files) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Resultado de commit inválido';
  END IF;

  FOR f IN SELECT value FROM jsonb_array_elements(p_files) LOOP
    IF COALESCE((f->>'deleted')::boolean, false) THEN
      -- Remove arquivo marcado como deletado (sem depender de precisão de updated_at)
      DELETE FROM public.code_files
       WHERE id = (f->>'id')::uuid
         AND project_id = p_project_id
         AND user_id = auth.uid();
    ELSE
      -- Marca o conteúdo commitado como nova baseline (zera "pendente")
      UPDATE public.code_files
         SET base_content = f->>'content',
             deleted = false
       WHERE id = (f->>'id')::uuid
         AND project_id = p_project_id
         AND user_id = auth.uid();
    END IF;
  END LOOP;

  UPDATE public.code_projects
     SET base_sha = p_sha, updated_at = now()
   WHERE id = p_project_id AND user_id = auth.uid();

  DELETE FROM public.project_commit_leases
   WHERE project_id = p_project_id
     AND lease_id = p_lease_id
     AND user_id = auth.uid();
END $$;

REVOKE ALL ON FUNCTION public.complete_project_commit(uuid,uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_project_commit(uuid,uuid,text,jsonb) TO authenticated;
