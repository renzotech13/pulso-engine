-- Automatic cleanup of raw footage once a project no longer needs it: once
-- EVERY video a project's guion describes has rendered successfully, the
-- worker deletes the raw takes (video_assets) and the music track from
-- video-editor-assets — nothing downstream reads them again once every
-- video is "listo" (transcription/EDL/subtitles are already saved as JSONB
-- on video_project_videos). This column records that it happened, so the
-- dashboard can stop offering "Re-renderizar con otro preset" (which
-- re-downloads those same files) and explain why instead of failing.
alter table public.video_projects
  add column raw_assets_cleaned_at timestamptz;
