-- Actor-bound private original-audio staging and retained content-free correspondence proof.
CREATE TABLE manual_presentation_video_pairs (
 id UUID PRIMARY KEY,
 request_id UUID NOT NULL,
 actor_profile_id INTEGER NOT NULL REFERENCES user_profiles(id),
 source_id UUID NOT NULL,
 audio_sha256 TEXT NOT NULL CHECK(audio_sha256 ~ '^[a-f0-9]{64}$'),
 audio_bytes BIGINT NOT NULL CHECK(audio_bytes BETWEEN 1 AND 209715200),
 audio_duration_ms BIGINT NOT NULL CHECK(audio_duration_ms > 0),
 recording_id UUID NOT NULL,
 drive_id TEXT NOT NULL,
 item_id TEXT NOT NULL,
 video_size BIGINT NOT NULL CHECK(video_size>0),
 video_quickxor_hash TEXT NOT NULL CHECK(length(video_quickxor_hash) BETWEEN 1 AND 100),
 state TEXT NOT NULL DEFAULT 'awaiting_audio' CHECK(state IN ('awaiting_audio','ready','attached','verified','rejected')),
 audio_pathname TEXT UNIQUE,
 content_type TEXT NOT NULL CHECK(content_type IN ('audio/mpeg','audio/mp4','audio/x-m4a')),
 upload_expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '15 minutes',
 expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW()+INTERVAL '24 hours',
 pcm_sha256 TEXT CHECK(pcm_sha256 ~ '^[a-f0-9]{64}$'),
 pcm_samples BIGINT CHECK(pcm_samples>0),
 cleaned_at TIMESTAMPTZ,
 next_cleanup_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK((state='verified')=(pcm_sha256 IS NOT NULL AND pcm_samples IS NOT NULL))
);
ALTER TABLE presentation_video_splits ALTER COLUMN source_copy_id DROP NOT NULL;
ALTER TABLE presentation_video_splits ADD COLUMN manual_pairing_id UUID REFERENCES manual_presentation_video_pairs(id);
ALTER TABLE presentation_video_splits ADD CONSTRAINT presentation_video_source_kind CHECK((source_copy_id IS NOT NULL) <> (manual_pairing_id IS NOT NULL));
CREATE INDEX manual_presentation_video_pairs_request ON manual_presentation_video_pairs(request_id,created_at DESC);
CREATE INDEX manual_presentation_video_pairs_cleanup ON manual_presentation_video_pairs(expires_at) WHERE cleaned_at IS NULL;

CREATE INDEX presentation_video_splits_manual_pair ON presentation_video_splits(manual_pairing_id) WHERE manual_pairing_id IS NOT NULL;
